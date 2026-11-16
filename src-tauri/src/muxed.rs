//! Fetching a page's media streams in parallel, then merging them.
//!
//! The third engine, and the reason the app is fast on the sites people
//! actually use.
//!
//! yt-dlp is two things at once: an extractor that knows a thousand sites, and
//! a downloader that fetches what it found on a single connection. The first
//! half is irreplaceable and the second half is the bottleneck. Measured
//! against YouTube on a domestic line, one connection moved 40 MiB in 15.7s
//! while eight ranged connections moved the same 40 MiB in 10.2s -- and on a
//! cold connection that the CDN had decided to rate-limit, 20 MiB took 54.7s on
//! one socket against 5.7s on eight. The gap is never negative and it is
//! occasionally an order of magnitude.
//!
//! So this module keeps the half that is irreplaceable and drops the half that
//! is slow: yt-dlp resolves the page to real media URLs with `-J`, and
//! `direct`'s segmented downloader -- already written, already tested, already
//! resumable -- moves the bytes. ffmpeg merges the two streams the way yt-dlp
//! would have.
//!
//! It is deliberately narrow. `triage` takes the fast path only for plain
//! `https` streams of known size, which is what YouTube, Vimeo, Aparat and most
//! of the rest serve for a normal video. Anything fragmented (HLS, DASH
//! manifests), live, or of unknown length is declined and the caller runs
//! yt-dlp exactly as before. Declining is cheap and being wrong is not, so the
//! rule errs towards declining.

use std::path::{Path, PathBuf};

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::Deserialize;
use tauri::AppHandle;

use crate::binaries::{self, Tool};
use crate::direct;
use crate::error::{AppError, AppResult};
use crate::jobs::{CancelSignal, Emitters, JobKind, JobProgress, Jobs, Stage};
use crate::paths;
use crate::process;

/// Streams a single video is allowed to be split into.
///
/// yt-dlp's `requested_formats` is a video and an audio track, or absent for a
/// source that is already one file. Anything else is a shape this module was
/// not written for.
const MAX_STREAMS: usize = 2;

/// What yt-dlp says one chosen format is.
///
/// Only the fields the decision and the transfer need. `serde` ignores the
/// hundred others, which is what keeps this from breaking every time yt-dlp
/// adds one.
#[derive(Debug, Deserialize)]
struct Format {
    /// Optional because this struct is also flattened over the top-level entry,
    /// which has no `url` of its own when yt-dlp chose two formats to merge.
    /// A stream without one is not fetchable, which `usable` says out loud.
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    protocol: Option<String>,
    #[serde(default)]
    ext: Option<String>,
    /// The exact length, and the only one this engine will build byte ranges
    /// from. yt-dlp also reports `filesize_approx`, which is deliberately not
    /// read: it is off by enough to make the final range run past the end of
    /// the file, and a range past the end is a 416 rather than a short read.
    #[serde(default)]
    filesize: Option<u64>,
    /// Present on HLS and DASH formats, which are fetched segment by segment
    /// and have no single URL to range over.
    #[serde(default)]
    fragments: Option<serde_json::Value>,
    /// The headers this URL was signed for. googlevideo answers a request
    /// without them with a 403, or worse, with a deliberately slow stream.
    #[serde(default)]
    http_headers: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    vcodec: Option<String>,
    #[serde(default)]
    acodec: Option<String>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct Extracted {
    #[serde(default)]
    title: Option<String>,
    /// Who made it, for the file's artist tag: a music track names its
    /// artist, everything else at least its channel.
    #[serde(default)]
    artist: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    channel: Option<String>,
    /// The page's picture, for cover art.
    #[serde(default)]
    thumbnail: Option<String>,
    /// The video and audio yt-dlp picked, when it picked two.
    #[serde(default)]
    requested_formats: Option<Vec<Format>>,
    /// The whole entry doubles as the format when there is only one.
    #[serde(flatten)]
    single: Format,
    #[serde(default)]
    is_live: Option<bool>,
    #[serde(default)]
    live_status: Option<String>,
    /// A playlist page. `--no-playlist` means this should never appear, but a
    /// URL that is *only* a playlist still resolves to one, and its entries are
    /// not something to download in parallel.
    #[serde(default)]
    entries: Option<serde_json::Value>,
}

/// One stream to fetch: a URL, the headers it was signed for, and its exact
/// length.
pub struct Stream {
    url: String,
    headers: HeaderMap,
    size_bytes: u64,
    ext: String,
    /// yt-dlp's own name for the audio codec in this stream, or `None` when it
    /// carries no audio. Read only by `Target::AudioCopy`, to pick the container
    /// the packets belong in.
    acodec: Option<String>,
    /// The short side of the picture, for the job card's "1080p" -- what was
    /// fetched, not what was asked for.
    short_side: Option<u32>,
    /// Whether this stream carries pictures. A page asked for as video can turn
    /// out to have none -- a SoundCloud track, a podcast -- and the job card
    /// should say "audio" about that before the file exists to say it.
    has_video: bool,
}

/// A page resolved into something this engine can fetch.
pub struct Plan {
    /// yt-dlp's own title, already sanitized into a file stem.
    pub title: String,
    /// The same title as the page wrote it, for the file's title tag.
    display_title: Option<String>,
    artist: Option<String>,
    thumbnail: Option<String>,
    /// One stream, or a video and an audio to be merged.
    streams: Vec<Stream>,
}

impl Plan {
    pub fn total_bytes(&self) -> u64 {
        self.streams.iter().map(|stream| stream.size_bytes).sum()
    }

    /// How many separate streams this plan is. The audio path only accepts one
    /// -- there is nothing to merge in an MP3 -- so the caller has to be able
    /// to ask before committing.
    pub fn stream_count(&self) -> usize {
        self.streams.len()
    }

    /// The container this plan's audio can be copied into, or `None` when the
    /// app knows no box for that codec.
    ///
    /// Only meaningful for a single-stream audio plan; the caller has already
    /// checked `stream_count` by the time it asks. `None` is what turns a
    /// request for `original` back into an encode, which always works.
    pub fn audio_copy_ext(&self) -> Option<&'static str> {
        let stream = self.streams.first()?;
        copy_container(stream.acodec.as_deref()?)
    }

    /// Whether any stream carries video -- what the job card is told the
    /// download is, once the page has been resolved.
    pub fn has_video(&self) -> bool {
        self.streams.iter().any(|stream| stream.has_video)
    }

    /// The codec family of the first stream's audio: "aac", "opus", ...
    pub fn audio_codec(&self) -> Option<&'static str> {
        let codec = self.streams.first()?.acodec.as_deref()?.to_ascii_lowercase();
        Some(match () {
            _ if codec.starts_with("mp4a") || codec.starts_with("aac") => "aac",
            _ if codec.starts_with("opus") => "opus",
            _ if codec.starts_with("vorbis") => "vorbis",
            _ if codec.starts_with("mp3") => "mp3",
            _ if codec.starts_with("flac") => "flac",
            _ => "other",
        })
    }

    /// The short side of the picture being fetched, when there is one.
    pub fn resolution(&self) -> Option<u32> {
        self.streams.iter().find_map(|stream| stream.short_side)
    }
}

/// What the fetched streams are turned into once they are on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    /// Put them in this container (mp4 or mkv), copying every stream through.
    /// A remux: seconds, and not a frame is recompressed.
    Container(&'static str),
    /// One audio stream, re-encoded -- what `yt-dlp -x --audio-format ...`
    /// does at the end of its own download, done here so the *transfer* can
    /// still happen on eight connections.
    Encode(AudioEncode),
    /// One audio stream, lifted into the container its codec belongs in without
    /// being decoded.
    ///
    /// The stream a site serves as "bestaudio" is already a finished AAC or
    /// Opus file; running it through LAME spends a minute to make it measurably
    /// worse. This is the same argument `ops::copy_audio_ext` makes for the
    /// extract-audio tool, applied to the download that fetched the stream in
    /// the first place.
    ///
    /// Still an ffmpeg pass rather than a rename, because the container and the
    /// codec are different questions: YouTube's Opus arrives inside a WebM, and
    /// renaming that to `.opus` produces a file whose extension lies about its
    /// bytes. `-c:a copy` moves the same packets into the right box.
    AudioCopy,
}

/// An audio encode, with its bitrate in kbps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioEncode {
    /// None is LAME's best VBR.
    Mp3(Option<u32>),
    Aac(u32),
    Opus(u32),
}

impl AudioEncode {
    fn ext(self) -> &'static str {
        match self {
            Self::Mp3(_) => "mp3",
            Self::Aac(_) => "m4a",
            Self::Opus(_) => "opus",
        }
    }

    fn args(self) -> Vec<String> {
        let mut args: Vec<String> = Vec::new();
        match self {
            // `-q:a 0` is LAME's best VBR, which is what `--audio-quality 0`
            // asks yt-dlp for.
            Self::Mp3(None) => args.extend(["-c:a", "libmp3lame", "-q:a", "0"].map(String::from)),
            Self::Mp3(Some(kbps)) => {
                args.extend(["-c:a".into(), "libmp3lame".into(), "-b:a".into(), format!("{kbps}k")])
            }
            Self::Aac(kbps) => args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), format!("{kbps}k")]),
            Self::Opus(kbps) => {
                args.extend(["-c:a".into(), "libopus".into(), "-b:a".into(), format!("{kbps}k")])
            }
        }
        args
    }
}

/// What is written into the finished file besides its streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Embed {
    /// Title and artist tags.
    pub metadata: bool,
    /// The page's thumbnail as cover art, where the container has a place for
    /// one -- MP4, M4A and MP3. Ogg and Matroska covers are skipped rather
    /// than half-supported.
    pub thumbnail: bool,
}

/// What a resolve learned about a page.
pub struct Resolved {
    /// yt-dlp's title, sanitized into a file stem -- whether or not the fast
    /// path can take the page. The yt-dlp engine names its file with it rather
    /// than with `%(title)s`, so the name is chosen, and made unique, before
    /// anything is written.
    pub title: Option<String>,
    /// The streams, when they are ones this engine can fetch.
    pub plan: Option<Plan>,
}

/// Asks yt-dlp what this page's chosen formats are, and whether they are ones
/// this engine can fetch.
///
/// No plan is the ordinary answer for most of the web and is not a failure:
/// it means "fragmented, live, or unmeasured -- run yt-dlp". An `Err` is a real
/// extraction failure (a dead link, a private video) and the caller reports it
/// rather than retrying, because yt-dlp is about to fail the same way.
pub async fn resolve(
    app: &AppHandle,
    url: &str,
    selection: &[String],
    cookies_from: Option<&str>,
) -> AppResult<Resolved> {
    let mut cmd = binaries::command(app, Tool::YtDlp)?;
    cmd.args(["-J", "--no-warnings", "--no-playlist"]);
    // `-f` and `-S`, from `formats` -- the same arguments yt-dlp's own
    // download would be given, so both engines fetch the same streams.
    cmd.args(selection);
    // Without the cookie this resolve sees the formats an anonymous visitor
    // sees, which for a members-only video is none -- so the fast path would
    // decline and hand a login-walled link to yt-dlp to fail on slowly.
    crate::download::with_cookies(&mut cmd, cookies_from);
    binaries::with_url(app, &mut cmd, url);

    let stdout = process::output(cmd, Tool::YtDlp.name()).await?;
    let extracted: Extracted = match serde_json::from_str(&stdout) {
        Ok(extracted) => extracted,
        // Unreadable metadata is not this engine's problem to report: yt-dlp
        // itself may well download the thing anyway. Decline and let it try.
        Err(_) => {
            return Ok(Resolved {
                title: None,
                plan: None,
            })
        }
    };

    let title = extracted
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(paths::sanitize_stem);
    Ok(Resolved {
        title,
        plan: triage(extracted),
    })
}

/// Whether these formats can be fetched as plain ranged HTTP, and the plan if
/// they can.
///
/// Separated from the yt-dlp call so the rule is testable against captured JSON
/// rather than against the network. Every branch here is a "no" -- the fast
/// path is what is left when nothing objected.
fn triage(extracted: Extracted) -> Option<Plan> {
    // A live stream has no end, so it has no length and no ranges.
    if extracted.is_live == Some(true)
        || extracted.live_status.as_deref() == Some("is_live")
        || extracted.live_status.as_deref() == Some("post_live")
    {
        return None;
    }
    // A playlist page. Its entries each need extracting in turn, which is
    // yt-dlp's job.
    if extracted.entries.is_some() {
        return None;
    }

    let formats = match extracted.requested_formats {
        Some(formats) => formats,
        None => vec![extracted.single],
    };
    if formats.is_empty() || formats.len() > MAX_STREAMS {
        return None;
    }

    let mut streams = Vec::with_capacity(formats.len());
    for format in formats {
        streams.push(usable(format)?);
    }

    let clean = |value: Option<String>| value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    Some(Plan {
        title: paths::sanitize_stem(extracted.title.as_deref().unwrap_or("media")),
        display_title: clean(extracted.title),
        artist: clean(extracted.artist)
            .or_else(|| clean(extracted.uploader))
            .or_else(|| clean(extracted.channel)),
        thumbnail: clean(extracted.thumbnail).filter(|url| url.starts_with("https://")),
        streams,
    })
}

/// One format, if it is one this engine can fetch.
fn usable(format: Format) -> Option<Stream> {
    // Fragmented: HLS and DASH arrive as hundreds of segment URLs, and the
    // single `url` on such a format is a manifest. Fetching it in eight ranged
    // pieces would download the playlist, very quickly, and call it a video.
    if format.fragments.is_some() {
        return None;
    }

    // Plain HTTP is the whole precondition -- `m3u8_native`, `http_dash_segments`
    // and the rest are yt-dlp's to handle.
    match format.protocol.as_deref() {
        Some("https") | Some("http") => {}
        _ => return None,
    }

    let url = format.url?;
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return None;
    }

    // An exact length or nothing -- see `Format::filesize`.
    let size_bytes = format.filesize.filter(|size| *size > 0)?;

    // Neither track: a storyboard or a subtitle picked up by a strange
    // selector. Nothing to merge and nothing anyone asked for.
    let has_video = format.vcodec.as_deref().is_some_and(|c| c != "none");
    let has_media = has_video || format.acodec.as_deref().is_some_and(|c| c != "none");
    if !has_media {
        return None;
    }

    Some(Stream {
        url,
        headers: header_map(format.http_headers.as_ref()),
        size_bytes,
        ext: format.ext.unwrap_or_else(|| "bin".to_string()),
        acodec: format.acodec.filter(|codec| codec != "none"),
        short_side: if has_video {
            match (format.width, format.height) {
                (Some(w), Some(h)) if w > 0 && h > 0 => Some(w.min(h)),
                (_, h) => h,
            }
        } else {
            None
        },
        has_video,
    })
}

/// The container this audio codec belongs in, for `Target::AudioCopy`.
///
/// yt-dlp names codecs the way ffprobe does but with profile suffixes -- `mp4a`
/// alone, or `mp4a.40.2` -- so this matches on the prefix. The mapping itself is
/// `ops::copy_audio_ext`'s, minus the PCM flavours no site streams.
///
/// `None` means "no container this app is sure of", and the caller falls back to
/// encoding rather than guessing a box the packets do not fit in.
fn copy_container(acodec: &str) -> Option<&'static str> {
    let codec = acodec.to_ascii_lowercase();
    // mp4a is yt-dlp's spelling of AAC; ffprobe calls the same thing "aac".
    if codec.starts_with("mp4a") || codec.starts_with("aac") {
        return Some("m4a");
    }
    if codec.starts_with("opus") {
        return Some("opus");
    }
    if codec.starts_with("vorbis") {
        return Some("ogg");
    }
    if codec.starts_with("mp3") {
        return Some("mp3");
    }
    if codec.starts_with("flac") {
        return Some("flac");
    }
    if codec.starts_with("alac") {
        return Some("m4a");
    }
    if codec.starts_with("ec-3") || codec.starts_with("eac3") {
        return Some("eac3");
    }
    if codec.starts_with("ac-3") || codec.starts_with("ac3") {
        return Some("ac3");
    }
    None
}

/// yt-dlp's header map, minus anything reqwest will not accept.
///
/// A header it rejects is dropped rather than failing the download: the ones
/// that matter (`User-Agent`, `Referer`, `Cookie`) are all ordinary, and losing
/// an exotic one to a strict parser is not worth giving up the fast path over.
pub(crate) fn header_map(headers: Option<&std::collections::HashMap<String, String>>) -> HeaderMap {
    let mut map = HeaderMap::new();
    let Some(headers) = headers else { return map };

    for (name, value) in headers {
        // `Accept-Encoding` is reqwest's own to set: letting yt-dlp's value
        // through can ask for a compressed body, and a compressed body makes
        // byte ranges mean something other than offsets into the file.
        if name.eq_ignore_ascii_case("accept-encoding") {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            map.insert(name, value);
        }
    }
    map
}

/// Fetches every stream in the plan and merges them into one file.
///
/// Streams are fetched one after another rather than at once. Concurrently they
/// would be two sets of eight sockets against one host, and the audio track is
/// a twelfth the size of the video -- so running them together buys a few
/// seconds and costs a connection count that looks like abuse. Sequential also
/// makes the progress arithmetic honest: a single running total over a known
/// grand total.
///
/// Ten arguments, deliberately. Seven of them are the job's ambient context --
/// the handle, the registry, the id, the emitters, the cancel signal -- which
/// every path in this module already takes in exactly this order; bundling them
/// into a struct here and nowhere else would make this one call site look
/// different from `download::run_ytdlp` and `direct::run` for no gain.
///
/// `source_key` is `paths::short_key` of the page, and goes into the partial
/// files' names -- see `part_path`.
///
/// A failed transfer keeps what it fetched and says so; the caller decides
/// whether a second attempt continues from it or yt-dlp takes over and it is
/// thrown away (`discard_parts`).
#[allow(clippy::too_many_arguments)]
pub async fn run(
    app: &AppHandle,
    jobs: &Jobs,
    id: &str,
    emitters: &mut Emitters,
    cancel: &CancelSignal,
    dir: &Path,
    output_name: Option<&str>,
    plan: &Plan,
    target: Target,
    embed: Embed,
    source_key: &str,
) -> AppResult<PathBuf> {
    let stem = stem_for(output_name, plan);

    let total = plan.total_bytes();
    let mut base = 0u64;
    let mut parts = Vec::with_capacity(plan.streams.len());

    for (index, stream) in plan.streams.iter().enumerate() {
        let part = part_path(dir, &stem, source_key, index, &stream.ext);
        // Recorded so a cancelled job's leftovers are known, exactly as the
        // other engines do.
        jobs.set_partial_output(id, part.clone()).await;

        let outcome = direct::fetch_to(
            cancel,
            &stream.url,
            &stream.headers,
            &part,
            stream.size_bytes,
            None,
            &mut |done, _, speed| {
                emitters.progress(JobProgress {
                    percent: Some(((base + done) as f64 / total as f64 * 100.0).clamp(0.0, 100.0)),
                    speed,
                    eta_secs: speed.filter(|rate| *rate > 1.0).map(|rate| {
                        (total.saturating_sub(base + done) as f64 / rate) as u64
                    }),
                    bytes: Some(base + done),
                    total_bytes: Some(total),
                    ..JobProgress::new(id, JobKind::Download, Stage::Downloading)
                });
            },
        )
        .await;

        parts.push(part);

        // Whatever arrived stays where a second attempt looks for it. A cancel
        // is the user's retry button; any other failure is the caller's to
        // decide about -- it tries once more on fresh URLs before handing the
        // page to yt-dlp, and throwing the bytes away first is what used to
        // make that second attempt start from nothing.
        outcome?;

        base += stream.size_bytes;
    }

    jobs.clear_partial_output(id).await;

    // An MP3 is a real encode, and it is CPU work like any compression: it
    // takes a place in the CPU lane rather than running beside three x264
    // encodes. Waiting for one is cancellable like any other queue.
    let _cpu = if matches!(target, Target::Encode(_)) {
        Some(jobs.acquire_cpu(id).await?)
    } else {
        None
    };

    let ext = match target {
        Target::Container(container) => container,
        Target::Encode(encode) => encode.ext(),
        // The caller only picks this target after `audio_copy_ext` answered, so
        // the fallback is unreachable in practice -- but naming a container the
        // codec does not fit would produce a file that lies about itself, and
        // m4a is the one every source this path accepts can be muxed into.
        Target::AudioCopy => plan.audio_copy_ext().unwrap_or("m4a"),
    };
    // Claimed for the length of the merge, which on a long video is long
    // enough for a second job with the same title to finish its own download
    // and look for a name -- see `paths::OutputClaim`.
    let output = paths::claim_output(dir, &stem, ext);

    // The cover, when one was asked for and the container has a place for it.
    // Best effort: a thumbnail that will not download costs the file its
    // picture, never the download.
    let cover = if embed.thumbnail && takes_cover(ext) {
        match &plan.thumbnail {
            Some(url) => {
                let path = dir.join(format!(".{stem}.{source_key}.cover"));
                match cancel.guard(direct::fetch_small(url, &path, COVER_LIMIT)).await {
                    Ok(Ok(())) => Some(path),
                    _ => None,
                }
            }
            None => None,
        }
    } else {
        None
    };
    let tags = Tags {
        title: embed.metadata.then(|| plan.display_title.clone()).flatten(),
        artist: embed.metadata.then(|| plan.artist.clone()).flatten(),
        cover: cover.clone(),
    };

    // A failed merge keeps the parts, like a failed transfer: they are
    // complete, and the caller's second attempt only has to merge them.
    let assembled = assemble(app, emitters, id, cancel, &parts, output.path(), target, ext, &tags).await;
    if let Some(cover) = &cover {
        let _ = tokio::fs::remove_file(cover).await;
    }
    assembled?;

    // Only once the result exists. Losing a part before the merge succeeded
    // would turn a recoverable failure into a full re-download.
    discard(&parts).await;

    Ok(output.path().to_path_buf())
}

/// The file stem a plan is saved and fetched under.
fn stem_for(output_name: Option<&str>, plan: &Plan) -> String {
    output_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(paths::sanitize_stem)
        .unwrap_or_else(|| plan.title.clone())
}

/// Where stream `index` of a page is fetched to.
///
/// Deterministic, so a retry finds what the previous attempt left. The page's
/// key is in the name as well as its title: two different videos that share a
/// title -- two entries of one playlist both called "Intro" -- used to write
/// into each other's partial files at the same time, and the merge then
/// produced a video that was neither. The index is there because a video and
/// an audio stream of the same source can share an extension.
fn part_path(dir: &Path, stem: &str, source_key: &str, index: usize, ext: &str) -> PathBuf {
    dir.join(format!(".{stem}.{source_key}.{index}.{ext}.part"))
}

/// Throws away what a plan's transfer left behind, for the caller that is
/// about to hand the page to yt-dlp instead. yt-dlp produces the file by
/// another route and never looks at these; leaving them would be hundreds of
/// megabytes of hidden litter for a download that succeeded.
pub async fn discard_parts(dir: &Path, output_name: Option<&str>, plan: &Plan, source_key: &str) {
    let stem = stem_for(output_name, plan);
    let parts: Vec<PathBuf> = plan
        .streams
        .iter()
        .enumerate()
        .map(|(index, stream)| part_path(dir, &stem, source_key, index, &stream.ext))
        .collect();
    discard(&parts).await;
}

/// Removes the intermediate streams and the sidecars that track their chunks.
async fn discard(parts: &[PathBuf]) {
    for part in parts {
        let _ = tokio::fs::remove_file(part).await;
        // `direct` writes `<part>.state` beside each one; without this the
        // folder keeps a scattering of small JSON files forever.
        let mut state = part.clone().into_os_string();
        state.push(".state");
        let _ = tokio::fs::remove_file(PathBuf::from(state)).await;
    }
}

/// Turns the fetched streams into the file the user asked for.
///
/// For a video that is `-c copy` throughout: the streams were chosen to be
/// container-compatible in the first place (see `format_selector`), so this is
/// a remux and not a re-encode -- seconds rather than minutes, and not a single
/// frame is recompressed. `+faststart` moves the index to the front, which is
/// what lets the file start playing before it has been read to the end.
///
/// For an MP3 it is a real encode, and the only part of an audio download that
/// was ever CPU work. yt-dlp does exactly this at the end of `-x`; the
/// difference is that the megabytes before it arrived on eight connections
/// rather than one.
#[allow(clippy::too_many_arguments)]
async fn assemble(
    app: &AppHandle,
    emitters: &mut Emitters,
    id: &str,
    cancel: &CancelSignal,
    parts: &[PathBuf],
    output: &Path,
    target: Target,
    ext: &str,
    tags: &Tags,
) -> AppResult<()> {
    // A single stream that is already in the right box, with nothing to write
    // into it, is already the file. Renaming beats spending an ffmpeg pass to
    // copy it to itself.
    if let ([only], Target::Container(_)) = (parts, target) {
        let same_box = only.extension().and_then(|e| e.to_str()) == Some(ext);
        if same_box && tags.is_empty() {
            return tokio::fs::rename(only, output)
                .await
                .map_err(|error| AppError::io(only, error));
        }
    }

    emitters.progress_now(JobProgress {
        percent: Some(100.0),
        ..JobProgress::new(
            id,
            JobKind::Download,
            match target {
                // A copy is a remux either way: nothing is being encoded, and
                // "Encoding" on a step that takes two seconds reads as a lie.
                Target::Container(_) | Target::AudioCopy => Stage::Merging,
                Target::Encode(_) => Stage::Encoding,
            },
        )
    });

    let mut cmd = binaries::command(app, Tool::Ffmpeg)?;
    cmd.args(["-hide_banner", "-loglevel", "error", "-y"]);
    for part in parts {
        cmd.arg("-i").arg(part);
    }
    cmd.args(assemble_args(parts.len(), target, ext, tags));
    cmd.arg(output);

    // Guarded rather than simply awaited. This ffmpeg is not in the job
    // registry -- there is nothing for `cancel_job` to take and kill -- so
    // without the guard, cancelling during the merge would be felt only once
    // the merge finished. Dropping the future kills the process, through the
    // tree guard inside `process::output`, so the guard is what actually ends
    // it. A remux is quick, but "quick" on a two-hour 4K video is not instant.
    let merged = cancel.guard(process::output(cmd, Tool::Ffmpeg.name())).await;

    // A merge that did not finish leaves a truncated output behind, and that
    // file is not a partial download anyone can resume -- it is a broken video
    // with a real name sitting in the user's folder. Cancelled or failed, it
    // goes: a failed one used to stay, and the yt-dlp fallback that follows a
    // failure found a file by that name, reported "already downloaded", and
    // finished the job pointing at the truncated one.
    match merged {
        Ok(Ok(_)) if !cancel.is_cancelled() => Ok(()),
        Ok(Err(error)) if !cancel.is_cancelled() => {
            remove_when_released(output).await;
            Err(error)
        }
        _ => {
            remove_when_released(output).await;
            Err(AppError::Cancelled)
        }
    }
}

/// The biggest thumbnail fetched for a cover. YouTube's largest is ~200 KB.
const COVER_LIMIT: u64 = 4 * 1024 * 1024;

/// Containers that carry a cover picture ffmpeg can write.
fn takes_cover(ext: &str) -> bool {
    matches!(ext, "mp4" | "m4a" | "mp3")
}

/// Tags written into the result.
pub struct Tags {
    title: Option<String>,
    artist: Option<String>,
    /// A downloaded thumbnail, added as the last input when present.
    cover: Option<PathBuf>,
}

impl Tags {
    fn is_empty(&self) -> bool {
        self.title.is_none() && self.artist.is_none() && self.cover.is_none()
    }
}

/// ffmpeg's arguments after the stream inputs: the cover input if any, the
/// stream mapping, the codecs, the tags and the container flags.
///
/// With no cover, nothing is mapped explicitly -- ffmpeg's own pick of one
/// video and one audio is what this has always relied on. With a cover, every
/// stream is named, because the cover is a video stream and has to be told
/// apart from the picture.
fn assemble_args(inputs: usize, target: Target, ext: &str, tags: &Tags) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    let cover = tags.cover.as_ref().filter(|_| takes_cover(ext));
    if let Some(cover) = cover {
        args.extend(["-i".into(), cover.to_string_lossy().into_owned()]);
    }

    match target {
        Target::Container(_) => {
            if cover.is_some() {
                for input in 0..inputs {
                    args.extend(["-map".into(), format!("{input}")]);
                }
                args.extend(["-map".into(), format!("{inputs}:v:0")]);
                // Everything copied, except the cover: re-encoded as a JPEG,
                // whatever the site served it as, and marked as the cover.
                args.extend(["-c".into(), "copy".into(), "-c:v:1".into(), "mjpeg".into()]);
                args.extend(["-disposition:v:1".into(), "attached_pic".into()]);
            } else {
                args.extend(["-c".into(), "copy".into()]);
            }
        }
        Target::AudioCopy | Target::Encode(_) => {
            let codec: Vec<String> = match target {
                Target::Encode(encode) => encode.args(),
                _ => vec!["-c:a".into(), "copy".into()],
            };
            if cover.is_some() {
                args.extend(["-map".into(), "0:a:0".into(), "-map".into(), format!("{inputs}:v:0")]);
                args.extend(codec);
                args.extend(["-c:v".into(), "mjpeg".into(), "-disposition:v:0".into(), "attached_pic".into()]);
            } else {
                // `-vn` drops the cover art some audio formats carry, which
                // would otherwise land as a video stream a few players choke on.
                args.push("-vn".into());
                args.extend(codec);
            }
        }
    }

    if let Some(title) = &tags.title {
        args.extend(["-metadata".into(), format!("title={title}")]);
    }
    if let Some(artist) = &tags.artist {
        args.extend(["-metadata".into(), format!("artist={artist}")]);
    }
    match ext {
        // The index at the front, so the file starts playing before it has
        // been read to the end.
        "mp4" | "m4a" => args.extend(["-movflags".into(), "+faststart".into()]),
        // ID3v2.3: what Windows Explorer and most car stereos read covers from.
        "mp3" => args.extend(["-id3v2_version".into(), "3".into()]),
        _ => {}
    }
    args
}

/// Deletes a file a just-killed process may still be holding.
///
/// On Windows a file cannot be deleted while another process has it open, and
/// a killed ffmpeg takes a moment to let go. A few short retries cover that
/// without making a cancel wait on anything longer.
async fn remove_when_released(path: &Path) {
    for _ in 0..10 {
        match tokio::fs::remove_file(path).await {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            _ => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan_from(json: &str) -> Option<Plan> {
        triage(serde_json::from_str(json).expect("the fixture parses"))
    }

    /// Shaped exactly like what `yt-dlp -J -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]"`
    /// returned for a YouTube video while this was written, trimmed to the
    /// fields that are read.
    const YOUTUBE: &str = r#"{
        "title": "Big Buck Bunny",
        "ext": "mp4",
        "requested_formats": [
            {
                "url": "https://rr1.googlevideo.com/videoplayback?v=1",
                "protocol": "https",
                "ext": "mp4",
                "filesize": 124386876,
                "vcodec": "avc1.640028",
                "acodec": "none",
                "http_headers": {"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip"}
            },
            {
                "url": "https://rr1.googlevideo.com/videoplayback?a=1",
                "protocol": "https",
                "ext": "m4a",
                "filesize": 10202210,
                "vcodec": "none",
                "acodec": "mp4a.40.2",
                "http_headers": {"User-Agent": "Mozilla/5.0"}
            }
        ]
    }"#;

    #[test]
    fn takes_two_plain_https_streams() {
        let plan = plan_from(YOUTUBE).expect("this is the fast path's whole reason to exist");

        assert_eq!(plan.title, "Big Buck Bunny");
        assert_eq!(plan.streams.len(), 2);
        assert_eq!(plan.total_bytes(), 124_386_876 + 10_202_210);
    }

    /// The headers the URL was signed for have to survive, or googlevideo
    /// answers with a 403 -- and `Accept-Encoding` has to not, or the body
    /// arrives compressed and every byte range points at the wrong place.
    #[test]
    fn carries_the_signing_headers_and_drops_the_encoding_one() {
        let plan = plan_from(YOUTUBE).unwrap();
        let headers = &plan.streams[0].headers;

        assert_eq!(
            headers.get("user-agent").map(|v| v.to_str().unwrap()),
            Some("Mozilla/5.0")
        );
        assert!(
            headers.get("accept-encoding").is_none(),
            "a compressed body makes byte offsets meaningless"
        );
    }

    /// The most important "no". A fragmented format's `url` is a manifest:
    /// fetching it in eight ranged pieces downloads a few kilobytes of playlist
    /// text, very quickly, and saves it as the video.
    #[test]
    fn declines_fragmented_streams() {
        let json = r#"{
            "title": "Reel",
            "ext": "mp4",
            "url": "https://cdn.example.com/master.m3u8",
            "protocol": "m3u8_native",
            "filesize": 1234567,
            "vcodec": "avc1",
            "acodec": "mp4a",
            "fragments": [{"url": "https://cdn.example.com/1.ts"}]
        }"#;
        assert!(plan_from(json).is_none());
    }

    /// Even without the `fragments` key: the protocol alone is disqualifying,
    /// because these are the ones yt-dlp assembles rather than downloads.
    #[test]
    fn declines_streaming_protocols() {
        for protocol in ["m3u8", "m3u8_native", "http_dash_segments", "rtmp", "ws"] {
            let json = format!(
                r#"{{
                    "title": "Stream", "ext": "mp4",
                    "url": "https://cdn.example.com/x", "protocol": "{protocol}",
                    "filesize": 999999, "vcodec": "avc1", "acodec": "mp4a"
                }}"#
            );
            assert!(plan_from(&json).is_none(), "{protocol} should be declined");
        }
    }

    /// An approximate size is not a length to build the last byte range from,
    /// and a range past the end of a file is a 416 rather than a short read.
    #[test]
    fn declines_a_stream_of_merely_approximate_length() {
        let json = r#"{
            "title": "Clip", "ext": "mp4",
            "url": "https://cdn.example.com/v.mp4", "protocol": "https",
            "filesize_approx": 58720256, "vcodec": "avc1", "acodec": "mp4a"
        }"#;
        assert!(plan_from(json).is_none());
    }

    #[test]
    fn declines_live_streams() {
        let json = r#"{
            "title": "Live now", "ext": "mp4", "is_live": true,
            "url": "https://cdn.example.com/v.mp4", "protocol": "https",
            "filesize": 123456789, "vcodec": "avc1", "acodec": "mp4a"
        }"#;
        assert!(plan_from(json).is_none());

        let json = r#"{
            "title": "Live now", "ext": "mp4", "live_status": "is_live",
            "url": "https://cdn.example.com/v.mp4", "protocol": "https",
            "filesize": 123456789, "vcodec": "avc1", "acodec": "mp4a"
        }"#;
        assert!(plan_from(json).is_none());
    }

    #[test]
    fn declines_a_playlist() {
        let json = r#"{
            "title": "A whole channel", "ext": "mp4",
            "entries": [{"id": "a"}, {"id": "b"}],
            "url": "https://cdn.example.com/v.mp4", "protocol": "https",
            "filesize": 123, "vcodec": "avc1", "acodec": "mp4a"
        }"#;
        assert!(plan_from(json).is_none());
    }

    /// One stream is the ordinary shape for a source that is already muxed --
    /// most non-YouTube sites, and YouTube's own format 18.
    #[test]
    fn takes_a_single_progressive_stream() {
        let json = r#"{
            "title": "Clip", "ext": "mp4",
            "url": "https://cdn.example.com/v.mp4", "protocol": "https",
            "filesize": 28524544, "vcodec": "avc1.42001E", "acodec": "mp4a.40.2"
        }"#;
        let plan = plan_from(json).expect("a progressive mp4 is fetchable");
        assert_eq!(plan.streams.len(), 1);
        assert_eq!(plan.total_bytes(), 28_524_544);
    }

    /// The audio download's shape, and the reason `Target::Mp3` can exist.
    ///
    /// Copied from what `yt-dlp -J -f "bestaudio[acodec^=mp4a]/bestaudio/best"`
    /// returned for a YouTube video on 2026-09-02: no `requested_formats`, so
    /// the entry itself is the format, `protocol: https` and an exact
    /// `filesize`. That is precisely what the parallel engine needs, which is
    /// what an audio download was passing up by going to yt-dlp on one socket.
    #[test]
    fn takes_a_single_audio_stream() {
        let json = r#"{
            "title": "Big Buck Bunny", "ext": "m4a",
            "format_id": "140",
            "url": "https://rr1.googlevideo.com/videoplayback?a=1",
            "protocol": "https",
            "filesize": 10271496,
            "vcodec": "none",
            "acodec": "mp4a.40.2",
            "live_status": "not_live",
            "http_headers": {"User-Agent": "Mozilla/5.0"}
        }"#;
        let plan = plan_from(json).expect("an audio-only https stream is fetchable");

        assert_eq!(plan.stream_count(), 1, "an MP3 comes from one stream");
        assert_eq!(plan.total_bytes(), 10_271_496);
        // The same stream, asked the other question: it is AAC, so it can be
        // handed over rather than run through LAME.
        assert_eq!(plan.audio_copy_ext(), Some("m4a"));
    }

    /// YouTube's other audio ladder. Opus arrives inside a WebM, which is why
    /// `Target::AudioCopy` is an ffmpeg pass and not a rename: the container the
    /// packets came in is not the container they belong in.
    #[test]
    fn an_opus_stream_copies_into_opus_and_not_into_webm() {
        let json = r#"{
            "title": "Big Buck Bunny", "ext": "webm",
            "format_id": "251",
            "url": "https://rr1.googlevideo.com/videoplayback?a=1",
            "protocol": "https",
            "filesize": 8123456,
            "vcodec": "none",
            "acodec": "opus"
        }"#;
        let plan = plan_from(json).expect("an opus stream is fetchable");

        assert_eq!(plan.audio_copy_ext(), Some("opus"));
    }

    /// A codec with no container this app is sure of has to turn back into an
    /// encode rather than guessing a box the packets do not fit in.
    #[test]
    fn an_unknown_audio_codec_has_no_copy_container() {
        let json = r#"{
            "title": "Odd", "ext": "mka",
            "url": "https://cdn.example.com/a.mka", "protocol": "https",
            "filesize": 4096, "vcodec": "none", "acodec": "truehd"
        }"#;
        let plan = plan_from(json).expect("the stream itself is fetchable");
        assert_eq!(plan.audio_copy_ext(), None);
    }

    /// A video plan is not an audio plan. `audio_copy_ext` reads the *first*
    /// stream, which for a merge is the video -- and a video track has no
    /// business naming an audio container.
    #[test]
    fn a_video_stream_offers_no_audio_container() {
        let json = r#"{
            "title": "Clip", "ext": "mp4",
            "url": "https://cdn.example.com/v.mp4", "protocol": "https",
            "filesize": 123, "vcodec": "avc1.42001E", "acodec": "none"
        }"#;
        let plan = plan_from(json).expect("a video-only stream is fetchable");
        assert_eq!(plan.audio_copy_ext(), None);
    }

    /// yt-dlp writes codecs with profile suffixes and ffprobe does not, so the
    /// mapping has to match on the prefix. Every spelling here came off a real
    /// `-J` response.
    #[test]
    fn codec_names_map_to_containers_by_prefix() {
        assert_eq!(copy_container("mp4a.40.2"), Some("m4a"));
        assert_eq!(copy_container("mp4a.40.5"), Some("m4a"));
        assert_eq!(copy_container("aac"), Some("m4a"));
        assert_eq!(copy_container("opus"), Some("opus"));
        assert_eq!(copy_container("vorbis"), Some("ogg"));
        assert_eq!(copy_container("mp3"), Some("mp3"));
        assert_eq!(copy_container("flac"), Some("flac"));
        assert_eq!(copy_container("alac"), Some("m4a"));
        // Dolby, spelled both of the ways the two ecosystems spell it.
        assert_eq!(copy_container("ec-3"), Some("eac3"));
        assert_eq!(copy_container("eac3"), Some("eac3"));
        assert_eq!(copy_container("ac-3"), Some("ac3"));

        assert_eq!(copy_container("truehd"), None);
        assert_eq!(copy_container("none"), None);
        assert_eq!(copy_container(""), None);
    }

    /// A storyboard or a subtitle track has neither codec. Nothing to merge and
    /// nothing anyone asked for.
    #[test]
    fn declines_a_format_that_is_neither_video_nor_audio() {
        let json = r#"{
            "title": "Storyboard", "ext": "mhtml",
            "url": "https://i.ytimg.com/sb/x.jpg", "protocol": "https",
            "filesize": 4096, "vcodec": "none", "acodec": "none"
        }"#;
        assert!(plan_from(json).is_none());
    }

    /// A title that would not survive as a file name still has to produce one:
    /// `sanitize_stem` is the same function every other engine names its output
    /// with, so the three cannot disagree about what a video is called.
    #[test]
    fn sanitizes_the_title_into_a_file_stem() {
        let json = r#"{
            "title": "10/10 <best> video?", "ext": "mp4",
            "url": "https://cdn.example.com/v.mp4", "protocol": "https",
            "filesize": 28524544, "vcodec": "avc1", "acodec": "mp4a"
        }"#;
        let plan = plan_from(json).unwrap();
        assert_eq!(plan.title, "10_10 _best_ video_");
    }

    fn tags(cover: bool) -> Tags {
        Tags {
            title: Some("A Song".into()),
            artist: Some("Someone".into()),
            cover: cover.then(|| PathBuf::from("/tmp/x.cover")),
        }
    }

    #[test]
    fn video_with_a_cover_maps_every_stream_and_marks_the_picture() {
        let args = assemble_args(2, Target::Container("mp4"), "mp4", &tags(true)).join(" ");
        assert!(args.starts_with("-i /tmp/x.cover -map 0 -map 1 -map 2:v:0 -c copy -c:v:1 mjpeg -disposition:v:1 attached_pic"), "{args}");
        assert!(args.contains("-metadata title=A Song") && args.contains("-movflags +faststart"), "{args}");
    }

    #[test]
    fn mkv_and_opus_get_tags_but_no_cover() {
        let mkv = assemble_args(2, Target::Container("mkv"), "mkv", &tags(true)).join(" ");
        assert!(!mkv.contains("cover") && mkv.starts_with("-c copy"), "{mkv}");
        let opus = assemble_args(1, Target::AudioCopy, "opus", &tags(true)).join(" ");
        assert!(opus.starts_with("-vn -c:a copy") && opus.contains("artist=Someone"), "{opus}");
    }

    #[test]
    fn audio_encodes_carry_their_bitrate() {
        let mp3 = assemble_args(1, Target::Encode(AudioEncode::Mp3(Some(192))), "mp3", &tags(true)).join(" ");
        assert!(mp3.contains("-map 0:a:0 -map 1:v:0 -c:a libmp3lame -b:a 192k -c:v mjpeg"), "{mp3}");
        assert!(mp3.ends_with("-id3v2_version 3"), "{mp3}");
        let best = assemble_args(1, Target::Encode(AudioEncode::Mp3(None)), "mp3", &tags(false)).join(" ");
        assert!(best.starts_with("-vn -c:a libmp3lame -q:a 0"), "{best}");
        let aac = assemble_args(1, Target::Encode(AudioEncode::Aac(192)), "m4a", &tags(false)).join(" ");
        assert!(aac.contains("-c:a aac -b:a 192k") && aac.ends_with("+faststart"), "{aac}");
    }
}
