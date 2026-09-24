//! Downloading: choosing an engine, and driving yt-dlp.
//!
//! There are three engines.
//!
//!   - `direct` fetches a link that already *is* the file, on eight
//!     connections, and can resume. Which links those are is one HTTP request
//!     away, and it is the whole reason this app can be given any link at all:
//!     before it, a URL yt-dlp did not recognise simply failed, which included
//!     every installer, archive and PDF anyone tried.
//!   - `muxed` handles a *page* whose streams turn out to be plain ranged HTTP,
//!     which is what YouTube and most video sites serve. yt-dlp resolves the
//!     page, `direct` moves the bytes on eight connections, ffmpeg merges. This
//!     is the fast path, and the measurements behind it are in `muxed`.
//!   - `run_ytdlp` is yt-dlp doing the whole job itself. Everything the second
//!     engine declines -- fragmented streams, live, unmeasured lengths, and the
//!     long tail of the thousand sites -- lands here, exactly as before.
//!
//! `choose_engine` picks between the first and the rest; `muxed::triage` picks
//! between the last two, and errs towards yt-dlp whenever it is not certain.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::binaries::{self, Tool};
use crate::direct::{self, FileInfo};
use crate::error::{AppError, AppResult};
use crate::jobs::{
    CancelSignal, Emitters, JobKind, JobMeta, JobProgress, JobStatus, Jobs, MediaClass, Stage,
};
use crate::library::{self, Slot};
use crate::muxed;
use crate::paths;
use crate::process::{self, Line, StderrTail};

/// Marks our own progress lines so they are unambiguous in the stdout stream.
const MARKER: &str = "__DLPROGRESS__";

/// Printed once per video before its download starts: what the chosen formats
/// are and what the page calls itself. See `INFO_TEMPLATE`.
const INFO_MARKER: &str = "__DLINFO__";

/// Printed when the download is over and yt-dlp's post-processors -- the merge,
/// the audio extraction -- are about to run.
const STAGE_MARKER: &str = "__DLSTAGE__";

/// `vcodec|acodec|title`, printed before the download starts.
///
/// The codecs are what tell a page asked for as video that turned out to have
/// no picture -- a SoundCloud track, a podcast episode -- which the job card can
/// then draw as audio from the start. The title comes last because it is the
/// one field that can itself contain a `|`.
const INFO_TEMPLATE: &str = "before_dl:__DLINFO__%(vcodec)s|%(acodec)s|%(title)s";

/// Any template will do as long as it has a field in it: a `--print` value with
/// no `%(` is read as a *field name*, and prints `NA`.
const STAGE_TEMPLATE: &str = "post_process:__DLSTAGE__%(ext)s";

/// Fragments fetched in parallel per download.
///
/// A constant rather than something derived from `available_parallelism`:
/// fetching fragments is network-bound, not CPU-bound, so the core count says
/// nothing useful about the right number. Eight against the four-download
/// network lane is at most 32 sockets, which a modern home connection handles
/// and which the user opted into by starting four downloads.
///
/// This applies to *fragmented* formats only -- HLS and DASH, where the video
/// arrives as hundreds of segment URLs. It was described here as the single
/// biggest speed lever, which was wrong in the case that matters most: a normal
/// YouTube format has `protocol: https` and no fragments, so yt-dlp fetches it
/// on one socket and this flag does nothing at all. That case is what `muxed`
/// exists for. The flag still earns its place for everything muxed declines,
/// which is exactly the fragmented sources it does apply to.
const CONCURRENT_FRAGMENTS: u8 = 8;

/// Below this, yt-dlp gives up on a stream and re-extracts rather than crawling.
///
/// 100K was too eager. It is a floor on *this* transfer's throughput, and a
/// connection that genuinely runs at 80 KB/s -- which is an ordinary evening in
/// plenty of places this app is used -- would trip it on every attempt and spend
/// the download re-extracting instead of downloading. 50K still catches the
/// pathological case it was added for (a throttled stream sitting at 40 KB/s
/// for an hour) while leaving a slow-but-working line alone.
const THROTTLED_RATE: &str = "50K";

/// The five fields the job card reads, in one line, marked so they cannot be
/// confused with yt-dlp's own output.
///
/// Two of them are written as alternates -- `%(a,b)s` takes the first that is
/// present:
///
///   - `total_bytes` is literally `NA` for every fragmented source: HLS, DASH
///     manifests, and so most of Instagram, X, and YouTube's m3u8 variants.
///     `total_bytes_estimate` is what carries the number there, and asking only
///     for the exact one is why those downloads showed no size at all.
///   - `speed` rather than `_speed_str`, so what crosses the bridge is bytes per
///     second and not the string "3.36MiB/s". The direct engine reports a
///     number, and two engines formatting their own units put "3.36MiB/s" and
///     "3.4 MB/s" on adjacent rows of the same list.
///
/// The sixth field is the format being fetched. A video that yt-dlp merges
/// arrives as two downloads -- the picture, then the sound -- each counting
/// from zero against its own size, which drew a bar that reached 100%, fell
/// back to nothing and climbed again. Knowing which stream a line is about is
/// what lets `StreamTotals` add them up into one.
const PROGRESS_TEMPLATE: &str = concat!(
    "download:__DLPROGRESS__",
    "%(progress._percent_str)s",
    "|%(progress.downloaded_bytes)s",
    "|%(progress.total_bytes,progress.total_bytes_estimate)s",
    "|%(progress.speed)s",
    "|%(progress.eta)s",
    "|%(info.format_id)s"
);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    pub output_dir: String,
    pub output_name: Option<String>,
    /// "video" or "audio".
    pub media_type: String,
    /// "best", "2160", "1440", "1080", "720", "480". Ignored for audio.
    pub quality: Option<String>,
    /// Which engine to use: "auto", "media" (yt-dlp) or "file" (direct).
    ///
    /// Absent means auto, which is what every screen sends. The two overrides
    /// exist for the case the probe gets wrong -- a site that serves its watch
    /// page as `application/octet-stream`, or a file whose host answers a bare
    /// GET with a login page.
    pub mode: Option<String>,
    /// Whether a media page may be fetched on many connections rather than by
    /// yt-dlp itself. See `muxed`.
    ///
    /// Absent means yes. It is a switch rather than an unconditional behaviour
    /// because it is the one path here that talks to a CDN in a way yt-dlp did
    /// not: a site that objects to eight ranged requests, or hands out URLs that
    /// expire faster than the transfer takes, needs a way back to the old
    /// behaviour that does not require a new release.
    pub parallel: Option<bool>,
    /// What an audio download should end up as: `original` to keep the stream
    /// the site served, `mp3` to re-encode it.
    ///
    /// Absent means `mp3`, which is what every version before this one did
    /// unconditionally. Meaningless when `media_type` is not audio.
    pub audio_format: Option<String>,
    /// The browser to borrow cookies from, for links behind a login, an age
    /// check, or a members-only wall. `None` -- and the default -- is to send
    /// no cookies at all.
    ///
    /// Validated against `BROWSERS` before it reaches a command line: this
    /// value comes from the webview, and `--cookies-from-browser` takes a
    /// string with its own `+KEYRING:PROFILE::CONTAINER` syntax that there is
    /// no reason to let through.
    pub cookies_from: Option<String>,
    /// Put the result on the library shelf that matches what the link turns
    /// out to be, rather than in `output_dir`.
    ///
    /// The form picks a folder before the download starts, and when its probe
    /// could not say what the link was, that folder was a guess -- Video, since
    /// that is what the toggle said -- and an archive or an installer landed on
    /// the Video shelf. With this set, the engine files the result once it
    /// knows. `output_dir` is still sent: it is the folder the form showed, and
    /// where the download goes if the library cannot be reached. Absent means
    /// no, which is what every request stored by an older build means.
    pub auto_folder: Option<bool>,
}

/// The browsers yt-dlp can read cookies from, as it names them.
///
/// Listed here rather than passed through, because the value arrives from the
/// webview and lands in an argument. yt-dlp's own syntax allows a keyring, a
/// profile and a container appended to the name; none of that is offered, so
/// none of it is accepted.
pub const BROWSERS: &[&str] = &[
    "brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale",
];

/// The browser name, if it is one of `BROWSERS`.
///
/// Every path that reaches a yt-dlp command line goes through here, so an
/// unknown value can never become an argument. Matching case-insensitively and
/// returning the *listed* spelling rather than the caller's is what makes that
/// true: what goes on the command line is a `&'static str` from this file.
pub fn browser_name(requested: Option<&str>) -> Option<&'static str> {
    let requested = requested?.trim();
    BROWSERS
        .iter()
        .copied()
        .find(|name| name.eq_ignore_ascii_case(requested))
}

/// Adds `--cookies-from-browser` when one was asked for.
///
/// Every yt-dlp call in the app takes this: the download itself, the probe that
/// draws the preview, the playlist walk, and `muxed::resolve`. A members-only
/// video whose *metadata* needs the cookie shows up as "Video unavailable" in
/// the preview otherwise, which is a confusing way to be told to log in.
pub fn with_cookies(cmd: &mut Command, browser: Option<&str>) {
    if let Some(name) = browser_name(browser) {
        cmd.arg("--cookies-from-browser");
        cmd.arg(name);
    }
}

/// The value the download form sends for "leave the stream alone".
///
/// The same word the extract-audio tool uses for the same idea, deliberately:
/// they are one promise made in two places, and a user who has met it once on
/// the tool screen should not have to learn a second name for it here.
pub const ORIGINAL_AUDIO: &str = "original";

impl DownloadRequest {
    fn wants_audio(&self) -> bool {
        self.media_type == "audio"
    }

    /// Whether an audio download should keep the stream it fetched.
    fn wants_original_audio(&self) -> bool {
        self.wants_audio()
            && self
                .audio_format
                .as_deref()
                .is_some_and(|format| format.eq_ignore_ascii_case(ORIGINAL_AUDIO))
    }

    /// The browser to read cookies from, if it is one yt-dlp knows and this app
    /// offers. Anything else is dropped rather than refused: a stale setting
    /// from a build that listed a browser this one does not is a download that
    /// should still run, without the cookies.
    fn cookie_browser(&self) -> Option<&'static str> {
        let requested = self.cookies_from.as_deref()?.trim();
        BROWSERS
            .iter()
            .copied()
            .find(|name| name.eq_ignore_ascii_case(requested))
    }
}

/// What a link turned out to be. The download screen shows one or the other:
/// a title, channel and thumbnail for media; a file name and a size for a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UrlKind {
    /// A page yt-dlp knows how to extract from.
    Media,
    /// A link that already points at the bytes.
    File,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlInfo {
    pub kind: UrlKind,
    pub title: String,
    pub uploader: Option<String>,
    pub duration_secs: Option<f64>,
    pub thumbnail: Option<String>,
    /// The link is a playlist page in its own right: it resolves to a list of
    /// videos rather than to one.
    pub is_playlist: bool,
    /// The link is a *video* that also names a playlist -- the `list=` on a
    /// `watch?v=…&list=…`, which is the shape YouTube's share button produces
    /// from inside a playlist and by far the most common way one is pasted.
    ///
    /// Read off the URL rather than from yt-dlp, deliberately. Answering it
    /// properly would mean a second `-J` without `--no-playlist`, which is two
    /// more seconds on every paste to answer a question most links do not raise.
    /// The expensive call is `list_playlist`, and it only happens if the user
    /// actually asks for the whole thing.
    pub in_playlist: bool,
    /// How many videos the playlist holds, when the page said. Never known for
    /// `in_playlist`, where nothing has looked yet.
    pub entry_count: Option<u64>,
    /// Known ahead of time for a file, never for a media page -- the size there
    /// depends on the format yt-dlp ends up choosing.
    pub size_bytes: Option<u64>,
    /// Whether an interrupted download of this link can be continued rather
    /// than restarted.
    pub resumable: bool,
}

/// Which engine a job runs on.
enum Engine {
    /// The link is the file, and the probe already learned its size and name.
    Direct(Box<FileInfo>),
    YtDlp,
}

/// Accepts any http(s) URL and lets yt-dlp decide what it supports.
///
/// The old check required the string to contain "youtube.com" or "youtu.be",
/// which is the only reason the app was YouTube-only; yt-dlp itself handles
/// around a thousand sites. Removing it is the whole feature. A failure on an
/// unsupported site now explains itself, because the stderr tail comes back
/// with the error.
///
/// A missing scheme is supplied rather than rejected. `youtu.be/abc` and
/// `www.aparat.com/v/x` are what a share sheet, a chat message and half the
/// links anyone reads out loud actually look like, and answering one of those
/// with "must start with http://" is the app declining to do the obvious thing.
/// Every other scheme is still refused: `file:`, `javascript:` and `data:` are
/// the ones that would matter, and none of them is a download.
fn validate_url(url: &str) -> AppResult<String> {
    // Zero-width and bidi marks ride along on anything copied out of a Persian
    // or Arabic page, and a URL carrying one is not the URL it looks like.
    // A newline becomes a space rather than vanishing: two links on two lines
    // must stay two links, so the first one is taken and the second is not
    // silently glued onto its end.
    let cleaned: String = url
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .filter(|c| !is_invisible(*c))
        .collect();

    // The link out of whatever it was pasted with. A share sheet writes "Look
    // at this https://youtu.be/x", and the URL is the part of that anyone
    // meant. Whitespace ends it -- a real URL has none.
    let trimmed = match cleaned.find("http://").or_else(|| cleaned.find("https://")) {
        Some(at) => cleaned[at..].split_whitespace().next().unwrap_or("").to_string(),
        None => cleaned.split_whitespace().next().unwrap_or("").to_string(),
    };
    let trimmed = trim_trailing_punctuation(&trimmed);
    if trimmed.is_empty() {
        return Err(AppError::invalid("url", "empty"));
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(trimmed);
    }
    // Some other scheme spelled out in full, or a bare host. `example.com:8080`
    // is the one ambiguous case, and a port is digits -- so a colon followed by
    // anything else is a scheme, and not one of the two this app speaks.
    if let Some((head, rest)) = lower.split_once(':') {
        let is_port = !rest.is_empty()
            && rest
                .split(['/', '?', '#'])
                .next()
                .is_some_and(|port| !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()));
        let looks_like_scheme = !head.is_empty()
            && head.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c));
        if looks_like_scheme && !is_port {
            return Err(AppError::invalid("url", "unsupported scheme"));
        }
    }

    // A host has a dot in it. Without this, a stray word in the field would be
    // turned into `https://word` and spend two seconds failing DNS.
    let host = lower.split(['/', '?', '#']).next().unwrap_or("");
    if !host.contains('.') || host.starts_with('.') || host.ends_with('.') {
        return Err(AppError::invalid("url", "not a link"));
    }

    Ok(format!("https://{trimmed}"))
}

/// Drops the sentence a link was pasted inside of, from its end.
///
/// A URL copied out of prose comes with the full stop or the closing quote that
/// followed it. A closing bracket is only punctuation when nothing opened it --
/// `en.wikipedia.org/wiki/Bat_(disambiguation)` ends in one on purpose, and
/// cutting that gives a 404.
fn trim_trailing_punctuation(url: &str) -> String {
    let mut end = url.len();
    while let Some(last) = url[..end].chars().next_back() {
        let cut = match last {
            '.' | ',' | ';' | ':' | '!' | '?' | '"' | '\'' | '>' | '»' | '،' => true,
            ')' => url[..end].matches('(').count() < url[..end].matches(')').count(),
            ']' => url[..end].matches('[').count() < url[..end].matches(']').count(),
            _ => false,
        };
        if !cut {
            break;
        }
        end -= last.len_utf8();
    }
    url[..end].to_string()
}

/// Characters that are in the string and not on the screen: the bidi marks and
/// zero-width joiners that come with any copy out of an RTL page, and the BOM.
fn is_invisible(c: char) -> bool {
    matches!(c, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{feff}')
}

/// yt-dlp format selector for a requested height.
///
/// `height<=N` rather than `height=N`: an exact match silently misses a
/// 1920x1084 source or a DASH variant that is a pixel off, and then falls
/// through to a lower-quality branch. The bare `/best` tail matters for
/// single-file and audio-only sources that have no separate video stream.
///
/// The codec branch comes first because the output has to *play*.
///
/// Left to "best", YouTube hands back VP9 or AV1 video and Opus audio, and
/// `--merge-output-format mp4` dutifully puts them in an `.mp4`. That file is
/// valid and it does not play in Windows Media Player, QuickTime, or most
/// televisions -- the user gets something that looks like it worked and opens to
/// a black screen or silence.
///
/// Filtering on the codec and not on `ext`, which was the first attempt and is
/// not enough: YouTube publishes AV1 *inside* mp4, so `bestvideo[ext=mp4]`
/// picked format 399 (`av01.0.09M.08`) and landed straight back in the same
/// problem. `vcodec^=avc1` and `acodec^=mp4a` are H.264 and AAC by name, which
/// is what every device made in the last fifteen years decodes.
///
/// It costs size -- on the video measured while writing this, H.264 1080p60 is
/// 246 MB against AV1's 119 MB for the same footage. That is the right way
/// round for this app: a file twice as large is an inconvenience, and a file
/// that will not open is a failure. Anyone who wants the small modern codec is
/// served by the fallbacks, which is where sources that have nothing else land
/// anyway.
fn format_selector(quality: Option<&str>) -> String {
    let height = match quality.unwrap_or("best") {
        "best" => None,
        height => Some(height.trim_end_matches('p').parse::<u32>().unwrap_or(720)),
    };
    // `[height<=N]` on every video branch, or nothing at all for "best".
    let cap = height.map(|h| format!("[height<={h}]")).unwrap_or_default();

    // Four branches, in order of preference:
    //   1. H.264 + AAC -- plays everywhere.
    //   2. Whatever else the mp4 container holds natively.
    //   3. Whatever the site does have, in any container.
    //   4. A single already-muxed file, for sources with no separate streams.
    [
        format!("bestvideo[vcodec^=avc1]{cap}+bestaudio[acodec^=mp4a]"),
        format!("bestvideo[ext=mp4]{cap}+bestaudio[ext=m4a]"),
        format!("bestvideo{cap}+bestaudio"),
        format!("best{cap}"),
        "best".to_string(),
    ]
    .join("/")
}

/// Starts a download and reports how it ended.
///
/// The engine choice, the status events and the registry bookkeeping live
/// here. The two engines only have to move bytes and hand back where they
/// landed, which is what let the second one be added without touching any of
/// this.
///
/// Every way out goes through the one `match` at the end. A link that failed
/// validation, or a folder that could not be created, used to return before
/// any status was sent and before the registry forgot the job -- so the card sat
/// on "queued" for good, and after a reload `list_jobs` revived it as running.
pub async fn run(
    app: AppHandle,
    jobs: &Jobs,
    id: String,
    request: DownloadRequest,
) -> AppResult<()> {
    let mut emitters = Emitters::new(app.clone());
    emitters.status(&id, JobKind::Download, JobStatus::Queued);

    let outcome = execute(&app, jobs, &id, &mut emitters, &request).await;

    // The registry entry goes either way. Its recorded partial path is
    // deliberately *not* acted on any more: an interrupted download leaves its
    // `.part` behind on purpose now, because that is what the retry button
    // continues from. Deleting it was the old behaviour and it meant a download
    // that died at 95% started again at nothing.
    jobs.finish(&id).await;

    match outcome {
        Ok(output) => {
            // Measured, not accumulated. This tick used to carry no byte count
            // at all, and being the last one it wiped whatever the engine had
            // reported -- which is why a finished download never showed its
            // size. Counting the bytes that went by would not have been right
            // either: yt-dlp reports them per stream, so the final figure for a
            // DASH video is the size of its audio track. The file exists now,
            // so it can simply be measured.
            let bytes = tokio::fs::metadata(&output).await.ok().map(|meta| meta.len());
            emitters.progress_now(JobProgress {
                percent: Some(100.0),
                bytes,
                total_bytes: bytes,
                ..JobProgress::new(&id, JobKind::Download, Stage::Finalizing)
            });
            emitters.status(
                &id,
                JobKind::Download,
                JobStatus::Completed {
                    output_path: output.to_string_lossy().into_owned(),
                },
            );
            Ok(())
        }
        Err(AppError::Cancelled) => {
            emitters.status(&id, JobKind::Download, JobStatus::Cancelled);
            Err(AppError::Cancelled)
        }
        Err(error) => {
            emitters.status(
                &id,
                JobKind::Download,
                JobStatus::Failed {
                    error: error.clone(),
                },
            );
            Err(error)
        }
    }
}

/// Everything between "queued" and a finished file, with every wait on it --
/// the queue, the probe, the transfer -- given up the moment cancel is pressed.
async fn execute(
    app: &AppHandle,
    jobs: &Jobs,
    id: &str,
    emitters: &mut Emitters,
    request: &DownloadRequest,
) -> AppResult<PathBuf> {
    let url = validate_url(&request.url)?;
    let cancel = jobs.cancel_signal(id).await;

    let _permit = jobs.acquire(id, JobKind::Download).await?;

    emitters.status(id, JobKind::Download, JobStatus::Running);
    emitters.progress_now(JobProgress::new(id, JobKind::Download, Stage::Preparing));

    // One HTTP request, but one that can take its full connect timeout against
    // a host that does not answer -- twenty seconds of "cancelling" otherwise.
    let engine = cancel.guard(choose_engine(&url, request)).await?;

    // What the link is, said as soon as it is known, so a job the form could
    // not describe stops being "unknown" here rather than at the finish.
    emitters.meta(id, JobKind::Download, meta_for(&engine, request));

    let dir = output_dir(app, request, &engine)?;

    match engine {
        Engine::Direct(info) => {
            // Nothing to kill: the work is a set of HTTPS requests rather than
            // a child process, so cancellation arrives through the signal.
            direct::run(
                id,
                emitters,
                &cancel,
                &url,
                &dir,
                request.output_name.as_deref(),
                &info,
            )
            .await
        }
        Engine::YtDlp => run_media(app, jobs, id, emitters, &cancel, &url, &dir, request).await,
    }
}

/// What the engine now knows the link to be. See `JobMeta`.
fn meta_for(engine: &Engine, request: &DownloadRequest) -> JobMeta {
    match engine {
        Engine::Direct(info) => JobMeta {
            media: info.media_class(),
            file_name: Some(info.filename.clone()),
            content_type: info.content_type.clone(),
            title: None,
        },
        // A page, which yt-dlp fetches as whichever of the two was asked for.
        // A page asked for as video that has no picture is corrected once the
        // formats are known -- see `run_media` and `run_ytdlp`.
        Engine::YtDlp => JobMeta {
            media: Some(if request.wants_audio() {
                MediaClass::Audio
            } else {
                MediaClass::Video
            }),
            ..JobMeta::default()
        },
    }
}

/// Where this download is written.
///
/// `output_dir` unless the request asked to be filed by what it turned out to
/// be. That decision is made here, after the engine has looked at the link,
/// because this is the first point anything knows for certain whether it is a
/// video, an audio file or neither.
fn output_dir(app: &AppHandle, request: &DownloadRequest, engine: &Engine) -> AppResult<PathBuf> {
    if request.auto_folder.unwrap_or(false) {
        let slot = match engine {
            Engine::Direct(info) => match info.media_class() {
                Some(MediaClass::Video) => Slot::Video,
                Some(MediaClass::Audio) => Slot::Audio,
                None => Slot::Files,
            },
            Engine::YtDlp if request.wants_audio() => Slot::Audio,
            Engine::YtDlp => Slot::Video,
        };
        // The library can be on a drive that has gone away. The folder the form
        // showed is the fallback, and the error from that is the one reported.
        if let Ok(dir) = library::folder(app, slot) {
            return Ok(dir);
        }
    }
    paths::ensure_dir(&request.output_dir)
}

/// Which engine gets this URL.
///
/// One HTTP request decides it, and that request is cheap next to the
/// alternative: booting yt-dlp to find out it has nothing to extract costs two
/// seconds every time, and used to end in a failure the user could do nothing
/// about.
async fn choose_engine(url: &str, request: &DownloadRequest) -> Engine {
    match request.mode.as_deref() {
        Some("media") => return Engine::YtDlp,
        Some("file") => {
            // Asked for by name, so a probe answering "this is a page" is
            // overruled -- but its name and size are still worth having.
            return match direct::probe(url).await {
                Ok(Some(info)) => Engine::Direct(Box::new(info)),
                _ => Engine::YtDlp,
            };
        }
        _ => {}
    }

    match direct::probe(url).await {
        // Extracting audio means re-encoding, and yt-dlp is the only engine
        // here that can: fetching the bytes verbatim would hand back the video
        // the user asked not to have. A link that is not media in the first
        // place -- an archive, an installer -- is fetched whatever the toggle
        // says, because there is no audio in it to extract.
        Ok(Some(info)) if request.wants_audio() && is_media_type(&info) => Engine::YtDlp,
        Ok(Some(info)) => Engine::Direct(Box::new(info)),
        // A page, or a host that would not answer a plain GET. Either way
        // yt-dlp is the one that knows what to do next.
        _ => Engine::YtDlp,
    }
}

fn is_media_type(info: &FileInfo) -> bool {
    info.content_type
        .as_deref()
        .is_some_and(|value| value.starts_with("video/") || value.starts_with("audio/"))
}

/// What to ask a site for when the user wants the audio.
///
/// AAC first because that is what most sites serve as a plain ranged stream
/// (YouTube's format 140), which is exactly the shape the parallel engine can
/// fetch -- and because it is already the audio inside the video, so decoding
/// it costs nothing. The fallbacks cover Opus-only sources and the sites that
/// publish nothing but a muxed file, both of which LAME encodes from just as
/// happily.
const AUDIO_SELECTOR: &str = "bestaudio[acodec^=mp4a]/bestaudio/best";

/// A media page, on whichever of the two engines can have it.
///
/// The fast path is tried first and is allowed to decline for any reason -- an
/// unreadable extraction, a fragmented stream, a live broadcast -- because
/// declining costs one `-J` call that `run_ytdlp` would have made a version of
/// anyway, and the alternative is the engine that has always worked.
///
/// A *failure* inside the fast path also falls back, once. The likeliest cause
/// is a signed URL that expired between the resolve and the transfer, or a host
/// that stopped honouring ranges partway through; both are things yt-dlp
/// negotiates for itself. What is deliberately not retried is cancellation --
/// the user asked for it to stop, and starting it again on another engine is
/// the opposite of that.
///
/// Nine arguments for the reason `muxed::run` gives: the job's ambient context,
/// in the order every engine takes it.
#[allow(clippy::too_many_arguments)]
async fn run_media(
    app: &AppHandle,
    jobs: &Jobs,
    id: &str,
    emitters: &mut Emitters,
    cancel: &CancelSignal,
    url: &str,
    dir: &Path,
    request: &DownloadRequest,
) -> AppResult<PathBuf> {
    // Both engines below find their partial files again by name -- the title,
    // or the name the form passed -- so the same page asked for twice at once
    // would put two downloads into one set of `.part` files. They take turns
    // instead; see `paths::PathLock`. Keyed on the name when there is one, and
    // on the link when yt-dlp is going to choose it.
    let _lock = cancel.guard(paths::lock_path(media_lock_key(dir, url, request))).await?;

    let audio = request.wants_audio();
    let eligible = request.parallel.unwrap_or(true)
        // Merging and encoding are both ffmpeg's, so without ffmpeg this path
        // cannot finish what it starts. `run_ytdlp` already reports that case
        // properly.
        && binaries::resolve(app, Tool::Ffmpeg).is_ok();

    if eligible {
        // Audio used to be excluded here, on the reasoning that `-x` is a
        // transcode and the transfer is not the slow part. Half of that is
        // true: the encode has to happen either way, and it happens below
        // instead. The transfer is the other half, and a 60-minute podcast is
        // 90 MB that yt-dlp pulls down one socket at a time -- the same
        // single-connection transfer, against the same throttled CDN, that the
        // whole of this module exists to stop doing.
        let selector = if audio {
            AUDIO_SELECTOR.to_string()
        } else {
            format_selector(request.quality.as_deref())
        };
        // Guarded, because resolving is a yt-dlp spawn and yt-dlp takes about
        // two seconds to unpack itself before it does anything. That is two
        // seconds of a cancelled job sitting there looking cancelled and not
        // being, and the child is not in the registry for `cancel_job` to
        // reach -- dropping the future is what ends it.
        //
        // `Ok(None)` is the ordinary answer for most of the web; an extraction
        // error is left to `run_ytdlp` to produce again with its own stderr
        // tail attached, which is the one the user can actually read.
        let resolved = match cancel
            .guard(muxed::resolve(
                app,
                url,
                &selector,
                request.cookie_browser(),
            ))
            .await
        {
            Ok(resolved) => resolved,
            Err(_) => return Err(AppError::Cancelled),
        };

        // An MP3 is made from one audio stream. Two means the selector came
        // back with a video track as well, which is not something to hand to
        // an audio encoder -- so that one goes to yt-dlp, as it always did.
        let usable = resolved
            .ok()
            .flatten()
            .filter(|plan| !audio || plan.stream_count() == 1);

        if let Some(plan) = usable {
            // The page has a name now, and whether it has a picture. A job the
            // form could only title with its URL gets the real title here, and
            // a "video" that turns out to be sound alone is drawn as audio.
            emitters.meta(
                id,
                JobKind::Download,
                JobMeta {
                    media: Some(if audio || !plan.has_video() {
                        MediaClass::Audio
                    } else {
                        MediaClass::Video
                    }),
                    title: Some(plan.title.clone()),
                    ..JobMeta::default()
                },
            );

            // Decided here rather than above, because for `original` the answer
            // depends on what the resolve actually came back with: a codec this
            // app has no container for degrades to an encode instead of failing,
            // which is the same choice `ops::extract_audio` makes.
            let target = if !audio {
                muxed::Target::Container
            } else if request.wants_original_audio() && plan.audio_copy_ext().is_some() {
                muxed::Target::AudioCopy
            } else {
                muxed::Target::Mp3
            };

            match muxed::run(
                app,
                jobs,
                id,
                emitters,
                cancel,
                dir,
                request.output_name.as_deref(),
                &plan,
                target,
            )
            .await
            {
                Ok(output) => return Ok(output),
                Err(AppError::Cancelled) => return Err(AppError::Cancelled),
                Err(_) => {
                    // Back to the start of the bar: the fallback is a fresh
                    // download and a percentage that walked to 80 and then sat
                    // still would be the wrong story about what is happening.
                    emitters.progress_now(JobProgress::new(
                        id,
                        JobKind::Download,
                        Stage::Preparing,
                    ));
                }
            }
        }
    }

    run_ytdlp(app, jobs, id, emitters, cancel, url, dir, request).await
}

/// What two media downloads must not share: the file name both engines will
/// write their partials under.
fn media_lock_key(dir: &Path, url: &str, request: &DownloadRequest) -> PathBuf {
    let name = request
        .output_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(paths::sanitize_stem)
        .unwrap_or_else(|| {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            url.hash(&mut hasher);
            format!("url-{:016x}", hasher.finish())
        });
    // Not a file anyone creates; a key in `paths::lock_path`'s map, spelled as
    // a path so it cannot collide with the direct engine's `.part` keys.
    dir.join(format!(".{name}.media-lock"))
}

/// The extractor engine: yt-dlp, for the thousand-odd sites where the link the
/// user has is not the link the file is at.
#[allow(clippy::too_many_arguments)]
async fn run_ytdlp(
    app: &AppHandle,
    jobs: &Jobs,
    id: &str,
    emitters: &mut Emitters,
    cancel: &CancelSignal,
    url: &str,
    dir: &Path,
    request: &DownloadRequest,
) -> AppResult<PathBuf> {
    let is_audio = request.wants_audio();

    // yt-dlp picks the extension itself once it knows the source, so the output
    // template gets `%(ext)s` and the real path is read back afterwards.
    let stem = request
        .output_name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .map(paths::sanitize_stem)
        .unwrap_or_else(|| "%(title).100B".to_string());

    // Only ever a fallback, for the case where yt-dlp's `after_move` print does
    // not reach us -- see the `unwrap_or_else` at the end of this function. Every
    // branch of it is a guess, `mp4` included: a webm-only site produces a
    // `.webm`. m4a is the guess for a copied audio stream because AAC is what
    // the great majority of sites serve as their best audio.
    let ext = match (is_audio, request.wants_original_audio()) {
        (true, true) => "m4a",
        (true, false) => "mp3",
        (false, _) => "mp4",
    };
    let template = dir.join(format!("{stem}.%(ext)s"));

    let mut args: Vec<String> = vec![
        "--newline".into(),
        "--no-colors".into(),
        "--no-playlist".into(),
        // Not optional. Any `--print` puts yt-dlp in quiet mode, and quiet mode
        // turns progress off -- so since `after_move` was added below, this
        // engine printed no progress at all. Every download it ran sat on
        // "Preparing" with an empty bar until it was suddenly finished, which
        // on a long video, or two running side by side, reads as a download
        // that never ends. Verified against yt-dlp 2026.08.19: without this
        // flag not one progress line is written.
        "--progress".into(),
        "--progress-template".into(),
        PROGRESS_TEMPLATE.into(),
        "--print".into(),
        INFO_TEMPLATE.into(),
        "--print".into(),
        STAGE_TEMPLATE.into(),
        "--print".into(),
        "after_move:__DLPATH__%(filepath)s".into(),
        "-o".into(),
        template.to_string_lossy().into_owned(),
        // Resume from the `.part` a previous attempt left rather than starting
        // over. yt-dlp's own default, stated because the app now depends on it:
        // the retry button is only worth pressing if this holds.
        "--continue".into(),
        // What this path is left with is mostly fragmented streams -- see
        // CONCURRENT_FRAGMENTS -- and those are exactly the ones it helps.
        "--concurrent-fragments".into(),
        CONCURRENT_FRAGMENTS.to_string(),
        // YouTube throttles each connection after the first few megabytes.
        // Requesting in chunks makes it hand out a fresh allowance per chunk.
        // It is a workaround for having one connection; `muxed` solves the same
        // problem by having eight, which is why this only has to serve the
        // downloads that path declined.
        "--http-chunk-size".into(),
        "10M".into(),
        "--throttled-rate".into(),
        THROTTLED_RATE.into(),
        "--retries".into(),
        "10".into(),
        "--fragment-retries".into(),
        "10".into(),
        "--file-access-retries".into(),
        "3".into(),
    ];

    if is_audio {
        args.push("-x".into());
        args.extend(if request.wants_original_audio() {
            // `best` is yt-dlp's word for "do not re-encode": it lifts the
            // stream out of whatever container it arrived in and leaves the
            // packets alone. The extension follows the codec, which is why the
            // template below is `%(ext)s` rather than a fixed one.
            ["--audio-format".into(), "best".into()]
        } else {
            ["--audio-format".into(), "mp3".into()]
        });
        if !request.wants_original_audio() {
            // LAME's best VBR. Meaningless for a copy, and yt-dlp warns when it
            // is passed with `--audio-format best`.
            args.extend(["--audio-quality".into(), "0".into()]);
        }
    } else {
        args.extend([
            "-f".into(),
            format_selector(request.quality.as_deref()),
            "--merge-output-format".into(),
            "mp4".into(),
        ]);
    }

    // yt-dlp shells out to ffmpeg to merge and to transcode audio. Point it at
    // the copy we bundle so it never depends on a system install.
    //
    // Only when there is a real directory to point at. A system ffmpeg found on
    // PATH resolves to the bare name "ffmpeg", whose parent is the empty path --
    // and yt-dlp answers `--ffmpeg-location ""` with "does not exist! Continuing
    // without ffmpeg", which is worse than saying nothing and letting it search
    // PATH itself.
    if let Ok(ffmpeg) = binaries::resolve(app, Tool::Ffmpeg) {
        if let Some(parent) = ffmpeg.path.parent().filter(|dir| !dir.as_os_str().is_empty()) {
            args.push("--ffmpeg-location".into());
            args.push(parent.to_string_lossy().into_owned());
        }
    }

    // Before the `--`, which is where the options stop and the URL begins.
    if let Some(browser) = request.cookie_browser() {
        args.push("--cookies-from-browser".into());
        args.push(browser.to_string());
    }

    let mut cmd = binaries::command(app, Tool::YtDlp)?;
    cmd.args(&args);
    // The `--` and the URL come last, from here, because nothing may follow
    // them -- see `binaries::with_url`.
    binaries::with_url(app, &mut cmd, url);

    // The child goes into the registry so `cancel_job` can reach it, while the
    // reader keeps the pipes. Taking stdout and stderr before the handover is
    // what lets cancellation and progress coexist.
    let process::Running { child, mut lines } = process::spawn(cmd, Tool::YtDlp.name())?;
    jobs.attach_child(id, child).await;

    let mut tail = StderrTail::default();
    let mut final_path: Option<PathBuf> = None;
    let mut stage = Stage::Downloading;
    let mut streams = StreamTotals::default();
    // See `merge_was_skipped`.
    let mut unmerged = false;

    loop {
        // Watching the signal as well as the pipes is what makes a cancelled
        // card go quiet at once. `cancel` kills the process tree on its own
        // task; this loop only has to stop reporting and let it finish dying.
        let line = tokio::select! {
            biased;
            () = cancel.cancelled() => {
                process::drain(&mut lines, process::DRAIN_LIMIT).await;
                return Err(AppError::Cancelled);
            }
            line = lines.recv() => line,
        };
        let Some(line) = line else { break };

        // Everything this loop acts on is a marker of our own, because yt-dlp's
        // own chatter never arrives: `--print` makes it quiet, so the
        // `[Merger]` line the stage used to be read from was not printed at
        // all -- and when it was, it went to stdout while this looked for it on
        // stderr. The markers are matched on either pipe regardless.
        let text = match &line {
            Line::Stdout(text) | Line::Stderr(text) => text.as_str(),
        };
        if let Some(path) = text.strip_prefix("__DLPATH__") {
            final_path = Some(PathBuf::from(path.trim()));
        } else if let Some(payload) = text.strip_prefix(MARKER) {
            if let Some((progress, stream)) = parse_progress(id, payload, stage) {
                emitters.progress(streams.add(stream, progress));
            }
        } else if let Some(payload) = text.strip_prefix(INFO_MARKER) {
            let (media, title) = parse_info(payload, is_audio);
            emitters.meta(
                id,
                JobKind::Download,
                JobMeta {
                    media: Some(media),
                    title,
                    ..JobMeta::default()
                },
            );
        } else if text.starts_with(STAGE_MARKER) {
            // Every byte is in; what is left is ffmpeg's. That can sit at 100%
            // for a long time on a large video, so it gets a name of its own.
            // Encoding for an MP3, which really is an encode; merging for the
            // rest, which is a remux or a copy -- or nothing at all, for a
            // single-file download, where this label is on screen for an
            // instant.
            stage = if is_audio && !request.wants_original_audio() {
                Stage::Encoding
            } else {
                Stage::Merging
            };
            emitters.progress_now(JobProgress {
                percent: Some(100.0),
                ..JobProgress::new(id, JobKind::Download, stage)
            });
        }

        if let Line::Stderr(text) = line {
            unmerged |= merge_was_skipped(&text);
            tail.push(text);
        }
    }

    // A child that is gone from the registry was taken by `cancel`.
    let Some(mut child) = jobs.take_child(id).await else {
        return Err(AppError::Cancelled);
    };

    let status = child
        .wait()
        .await
        .map_err(|error| AppError::spawn(Tool::YtDlp.name(), error))?;

    // Zero exit, no usable file: see `merge_was_skipped`. Reported as the
    // missing tool it is, which is the one thing the user can act on -- the UI
    // turns `ToolMissing` into a pointer at Settings. The two streams are left
    // where they are rather than cleaned up: they downloaded completely, and
    // guessing which of them is the "partial" one would delete half a video.
    if status.success() && unmerged {
        return Err(AppError::tool_missing(Tool::Ffmpeg.name()));
    }

    if !status.success() {
        return Err(AppError::Tool {
            tool: Tool::YtDlp.name().to_string(),
            code: status.code(),
            tail: tail.into_string(),
        });
    }

    // `--print after_move:%(filepath)s` gives the real name after every
    // post-processor has run, which is the only reliable way to know it: the
    // extension depends on what the source turned out to be.
    Ok(final_path.unwrap_or_else(|| dir.join(format!("{stem}.{ext}"))))
}

/// Whether yt-dlp has just told us it is giving up on merging.
///
/// On YouTube the video and audio streams arrive separately and are joined by
/// ffmpeg at the end. When ffmpeg cannot be run, yt-dlp does not fail: it
/// prints this warning, keeps both streams as `name.f399.mp4` and
/// `name.f251.webm`, and exits zero -- so the job reported success and left two
/// files that neither play together nor on their own.
///
/// Matched on the half of the sentence that is stable across yt-dlp versions
/// and shared with the post-processing variant of the same message.
fn merge_was_skipped(line: &str) -> bool {
    line.contains("ffmpeg is not installed") || line.contains("ffmpeg could not be found")
}

/// One progress line, and the format it is about when the line says.
///
/// Five fields is the shape older builds printed and the tests still speak;
/// the sixth, the format id, is optional so either reads the same.
fn parse_progress(id: &str, payload: &str, stage: Stage) -> Option<(JobProgress, Option<String>)> {
    let fields: Vec<&str> = payload.splitn(6, '|').collect();
    if fields.len() < 5 {
        return None;
    }

    // yt-dlp writes "NA" for a field it does not have, and occasionally
    // "Unknown" or "none". None of them parse as a number, so one guard covers
    // all of them: anything that is not a figure is an absent figure.
    let decimal = |raw: &str| -> Option<f64> {
        let raw = raw.trim();
        (!raw.is_empty()).then(|| raw.parse::<f64>().ok()).flatten()
    };
    let number = |raw: &str| -> Option<u64> {
        decimal(raw).filter(|value| *value >= 0.0).map(|v| v as u64)
    };

    let percent = fields[0]
        .trim()
        .trim_end_matches('%')
        .trim()
        .parse::<f64>()
        .ok()
        .map(|p| p.clamp(0.0, 100.0));

    let bytes = number(fields[1]);
    // `total_bytes_estimate` stands in for the total on fragmented sources, and
    // it is an estimate: it runs *behind* the real size, so the bytes that have
    // arrived overtake it and the card read "130 MB / 118 MB". Whatever has
    // actually arrived is a floor on the size of the file.
    let total_bytes = match (number(fields[2]), bytes) {
        (Some(total), Some(bytes)) => Some(total.max(bytes)),
        (total, _) => total,
    };

    let stream = fields
        .get(5)
        .map(|raw| raw.trim())
        .filter(|raw| !raw.is_empty() && *raw != "NA")
        .map(str::to_string);

    Some((
        JobProgress {
            id: id.to_string(),
            kind: JobKind::Download,
            percent,
            stage,
            speed: decimal(fields[3]).filter(|rate| *rate > 0.0),
            encode_rate: None,
            eta_secs: number(fields[4]),
            bytes,
            total_bytes,
        },
        stream,
    ))
}

/// Adds up the streams of a download yt-dlp fetches in more than one piece.
///
/// A merged video is the picture and then the sound, each reported from zero
/// against its own size. Shown as they come, the bar filled, emptied and filled
/// again, and the size under it changed from the video's to the audio's --
/// neither of which is the size of what the user is getting. Here each stream
/// that finishes is carried forward, so the figures only ever grow and the
/// percentage is of everything fetched so far.
#[derive(Default)]
struct StreamTotals {
    current: Option<String>,
    /// Bytes of the streams that are finished.
    done: u64,
    /// The running stream's last figures, carried forward when the next begins.
    last_bytes: u64,
    last_total: Option<u64>,
}

impl StreamTotals {
    fn add(&mut self, stream: Option<String>, mut progress: JobProgress) -> JobProgress {
        if stream.is_some() && self.current.is_some() && stream != self.current {
            self.done += self.last_total.unwrap_or(0).max(self.last_bytes);
        }
        if stream.is_some() {
            self.current = stream;
        }
        self.last_bytes = progress.bytes.unwrap_or(self.last_bytes);
        self.last_total = progress.total_bytes.or(self.last_total);

        if self.done > 0 {
            progress.bytes = progress.bytes.map(|bytes| bytes + self.done);
            progress.total_bytes = progress.total_bytes.map(|total| total + self.done);
            // yt-dlp's own percentage is of this stream alone; with a known
            // total it is recomputed over everything, and without one it is
            // still the best figure there is.
            if let (Some(bytes), Some(total)) = (progress.bytes, progress.total_bytes) {
                if total > 0 {
                    progress.percent = Some((bytes as f64 / total as f64 * 100.0).clamp(0.0, 100.0));
                }
            }
        }
        progress
    }
}

/// `vcodec|acodec|title` from `INFO_TEMPLATE`: whether the download has a
/// picture, and what the page calls itself.
fn parse_info(payload: &str, wants_audio: bool) -> (MediaClass, Option<String>) {
    let mut fields = payload.splitn(3, '|');
    let vcodec = fields.next().unwrap_or("").trim();
    let _acodec = fields.next();
    let title = fields
        .next()
        .map(str::trim)
        .filter(|title| !title.is_empty() && *title != "NA")
        .map(str::to_string);

    // Only an explicit "none" is a missing picture. "NA" means yt-dlp does not
    // know -- which is what a plain file link on the generic extractor says --
    // and that is not evidence of anything.
    let media = if wants_audio || vcodec == "none" {
        MediaClass::Audio
    } else {
        MediaClass::Video
    };
    (media, title)
}

/// What the download screen previews after a link is pasted.
///
/// Asks the cheap question first. A direct link answers in one request, with
/// its real name and its exact size, and never has to wake yt-dlp at all --
/// which is the difference between a preview that appears as you finish
/// pasting and one that takes two seconds. Only a page falls through to the
/// extractor, and a page is the only thing the extractor is needed for.
pub async fn probe_url(
    app: &AppHandle,
    url: &str,
    cookies_from: Option<&str>,
) -> AppResult<UrlInfo> {
    let url = validate_url(url)?;

    if let Some(file) = direct::probe(&url).await? {
        return Ok(UrlInfo {
            kind: UrlKind::File,
            title: file.filename,
            // A file has no channel, no duration and no thumbnail, and inventing
            // any of them would put a blank line under the name.
            uploader: file.content_type,
            duration_secs: None,
            thumbnail: None,
            is_playlist: false,
            in_playlist: false,
            entry_count: None,
            size_bytes: file.size_bytes,
            resumable: file.resumable,
        });
    }

    let mut cmd = binaries::command(app, Tool::YtDlp)?;
    cmd.args(["-J", "--no-warnings", "--flat-playlist", "--no-playlist"]);
    // Before the `--`. A members-only video whose metadata needs the cookie
    // answers an anonymous probe with "Video unavailable", which is a confusing
    // way to be told to log in.
    with_cookies(&mut cmd, cookies_from);
    binaries::with_url(app, &mut cmd, &url);

    let stdout = process::output(cmd, Tool::YtDlp.name()).await?;
    let value: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|error| AppError::invalid("url", format!("could not read metadata: {error}")))?;

    let entries = value.get("entries").and_then(|e| e.as_array());
    Ok(UrlInfo {
        kind: UrlKind::Media,
        title: value
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled")
            .to_string(),
        uploader: value
            .get("uploader")
            .or_else(|| value.get("channel"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        duration_secs: value.get("duration").and_then(|v| v.as_f64()),
        thumbnail: value
            .get("thumbnail")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        is_playlist: entries.is_some(),
        // Only worth saying for a link that is not already a playlist page:
        // `/playlist?list=X` carries the parameter too, and offering "this one
        // or all of them" twice over for the same list would be one choice
        // wearing two hats.
        in_playlist: entries.is_none() && names_a_playlist(&url),
        entry_count: entries.map(|e| e.len() as u64),
        // yt-dlp cannot say: the size depends on the format it ends up
        // choosing, which it does not decide until the download starts.
        size_bytes: None,
        // yt-dlp writes a `.part` and continues from it, for every site.
        resumable: true,
    })
}

/// Whether this URL names a playlist alongside whatever else it points at.
///
/// A string check on the query, not a parse: `list=` is the parameter every
/// extractor that has the concept spells the same way, and the alternative is
/// pulling in a URL crate to answer one question. A `list=` with an empty value
/// -- which YouTube emits on some share links -- names nothing and is ignored.
fn names_a_playlist(url: &str) -> bool {
    let Some((_, query)) = url.split_once('?') else {
        return false;
    };
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .any(|(key, value)| key.eq_ignore_ascii_case("list") && !value.is_empty())
}

/// One video in a playlist, as `list_playlist` reports it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    /// The watch URL, ready to hand back to `start_download` unchanged.
    pub url: String,
    pub title: String,
}

/// The most videos one press of "download all" will queue.
///
/// A channel URL is a playlist too, and some of them are five thousand videos.
/// Queueing that many is not a download, it is an accident with a progress bar
/// -- and the job list persists a hundred rows, so the other four thousand nine
/// hundred would not even be visible. The cap is reported rather than silently
/// applied; see `PlaylistListing::truncated`.
const MAX_PLAYLIST_ENTRIES: usize = 100;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistListing {
    pub entries: Vec<PlaylistEntry>,
    /// How many the playlist actually holds, before the cap.
    pub total: u64,
    /// Whether `entries` is short of `total`, so the form can say so rather
    /// than quietly starting the first hundred of a thousand.
    pub truncated: bool,
}

/// Expands a playlist link into the videos it holds.
///
/// Deliberately not part of `probe_url`: this is the expensive call -- yt-dlp
/// walking a whole list -- and most pasted links never need it. It runs when the
/// user has actually asked for the whole playlist.
///
/// `--flat-playlist` is what keeps it to one request: yt-dlp lists the entries
/// without extracting each one, so a fifty-video playlist costs a single page
/// load rather than fifty. Each entry is extracted properly later, by the
/// download that fetches it.
pub async fn list_playlist(
    app: &AppHandle,
    url: &str,
    cookies_from: Option<&str>,
) -> AppResult<PlaylistListing> {
    let url = validate_url(url)?;

    let mut cmd = binaries::command(app, Tool::YtDlp)?;
    // No `--no-playlist` here -- that flag is the whole reason this function
    // exists -- and `--yes-playlist` to override it for a `watch?v=…&list=…`,
    // where yt-dlp's own default is the single video.
    cmd.args(["-J", "--no-warnings", "--flat-playlist", "--yes-playlist"]);
    with_cookies(&mut cmd, cookies_from);
    binaries::with_url(app, &mut cmd, &url);

    let stdout = process::output(cmd, Tool::YtDlp.name()).await?;
    let value: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|error| AppError::invalid("url", format!("could not read playlist: {error}")))?;

    let Some(raw) = value.get("entries").and_then(|e| e.as_array()) else {
        return Err(AppError::invalid("url", "not a playlist"));
    };

    let total = raw.len() as u64;
    let entries: Vec<PlaylistEntry> = raw
        .iter()
        // An entry with no URL is one yt-dlp could not resolve -- a deleted or
        // private video, which every long playlist has a few of. Skipped rather
        // than queued as a download that is certain to fail.
        .filter_map(|entry| {
            let url = entry.get("url").and_then(|v| v.as_str())?;
            Some(PlaylistEntry {
                url: url.to_string(),
                title: entry
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Untitled")
                    .to_string(),
            })
        })
        .take(MAX_PLAYLIST_ENTRIES)
        .collect();

    Ok(PlaylistListing {
        truncated: total > entries.len() as u64,
        entries,
        total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A progress line's figures, without the stream it named.
    fn progress_of(payload: &str) -> Option<JobProgress> {
        parse_progress("j1", payload, Stage::Downloading).map(|(progress, _)| progress)
    }

    /// A request as the download form sends one, with only the fields a test
    /// cares about set.
    fn request(media_type: &str, audio_format: Option<&str>) -> DownloadRequest {
        DownloadRequest {
            url: "https://example.com/watch".into(),
            output_dir: "/tmp".into(),
            output_name: None,
            media_type: media_type.into(),
            quality: None,
            mode: None,
            parallel: None,
            audio_format: audio_format.map(str::to_string),
            cookies_from: None,
            auto_folder: None,
        }
    }

    /// Every install before this one sent no `audioFormat` at all, and those
    /// requests are still stored on the retry button of any failed download in
    /// the job list. They have to keep meaning MP3.
    #[test]
    fn an_absent_audio_format_still_means_mp3() {
        assert!(!request("audio", None).wants_original_audio());
        assert!(request("audio", None).wants_audio());
    }

    #[test]
    fn original_is_recognised_whatever_its_case() {
        assert!(request("audio", Some("original")).wants_original_audio());
        assert!(request("audio", Some("Original")).wants_original_audio());
        assert!(!request("audio", Some("mp3")).wants_original_audio());
    }

    /// The audio format has nothing to say about a video download, and a stray
    /// value must not send one down the copy path.
    #[test]
    fn a_video_request_is_never_original_audio() {
        assert!(!request("video", Some("original")).wants_original_audio());
    }

    /// The value arrives from the webview and lands in an argument, so what is
    /// accepted is exactly the list and nothing adjacent to it.
    #[test]
    fn only_a_listed_browser_reaches_a_command_line() {
        assert_eq!(browser_name(Some("firefox")), Some("firefox"));
        assert_eq!(browser_name(Some("Chrome")), Some("chrome"));
        // Whitespace from a stored setting is trimmed, not treated as a name.
        assert_eq!(browser_name(Some("  edge  ")), Some("edge"));

        assert_eq!(browser_name(None), None);
        assert_eq!(browser_name(Some("")), None);
        assert_eq!(browser_name(Some("netscape")), None);
    }

    /// yt-dlp's own syntax allows a keyring, a profile and a container appended
    /// to the browser name. None of that is offered by the UI, so none of it is
    /// accepted -- and neither is anything that merely starts with a real name.
    #[test]
    fn the_browsers_own_extended_syntax_is_refused() {
        assert_eq!(browser_name(Some("firefox:/etc/passwd")), None);
        assert_eq!(browser_name(Some("chrome+gnomekeyring")), None);
        assert_eq!(browser_name(Some("chrome::container")), None);
        assert_eq!(browser_name(Some("firefox --exec")), None);
    }

    /// What `browser_name` returns is a `&'static str` from this file, never
    /// the caller's own string. That is the property that makes the whole
    /// check hold: a matched name cannot smuggle its own spelling through.
    #[test]
    fn a_matched_name_is_the_listed_spelling() {
        let matched = browser_name(Some("VIVALDI")).unwrap();
        assert_eq!(matched, "vivaldi");
        assert!(BROWSERS.contains(&matched));
    }

    /// A stale setting naming a browser this build no longer lists is a
    /// download that should still run, without the cookies -- not one that
    /// fails.
    #[test]
    fn an_unknown_browser_is_dropped_rather_than_refused() {
        let mut request = request("video", None);
        request.cookies_from = Some("netscape".into());
        assert_eq!(request.cookie_browser(), None);
    }

    /// The shape YouTube's share button produces from inside a playlist, and
    /// the reason `in_playlist` exists: the app used to take the video and say
    /// nothing at all about the other thirty-nine.
    #[test]
    fn spots_a_playlist_named_alongside_a_video() {
        assert!(names_a_playlist(
            "https://www.youtube.com/watch?v=abc123&list=PLxyz"
        ));
        assert!(names_a_playlist("https://www.youtube.com/playlist?list=PLxyz"));
        // Order in the query is not fixed, and neither is case.
        assert!(names_a_playlist("https://example.com/v?list=A&t=30"));
        assert!(names_a_playlist("https://example.com/v?LIST=A"));
    }

    #[test]
    fn a_plain_link_names_no_playlist() {
        assert!(!names_a_playlist("https://www.youtube.com/watch?v=abc123"));
        assert!(!names_a_playlist("https://example.com/video.mp4"));
        assert!(!names_a_playlist("https://example.com/"));
        // A parameter that merely starts with the same letters.
        assert!(!names_a_playlist("https://example.com/v?listing=7"));
        // YouTube emits this on some share links, and it names nothing.
        assert!(!names_a_playlist("https://example.com/v?list="));
    }

    /// `validate_url`'s answer, for the cases that have one. `AppError` is not
    /// `PartialEq` -- deliberately, it carries process output -- so the tests
    /// that are about the accepted form unwrap rather than compare a `Result`.
    fn normalized(url: &str) -> String {
        validate_url(url).unwrap_or_else(|_| panic!("{url} should be accepted"))
    }

    #[test]
    fn accepts_any_http_url() {
        // The point of the change: these are all supported by yt-dlp and were
        // all rejected before.
        for url in [
            "https://youtube.com/watch?v=x",
            "https://www.instagram.com/p/abc/",
            "https://x.com/user/status/1",
            "https://www.aparat.com/v/abc",
            "https://soundcloud.com/artist/track",
        ] {
            assert!(validate_url(url).is_ok(), "{url} should be accepted");
        }
    }

    #[test]
    fn rejects_non_http_schemes() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>",
            "magnet:?xt=urn:btih:abc",
            "",
            "  ",
            // Not a link at all: turning this into https://nonsense would cost
            // two seconds of DNS to say so.
            "nonsense",
        ] {
            assert!(validate_url(url).is_err(), "{url} should be rejected");
        }
    }

    /// A missing scheme is the normal shape of a link people read out, share
    /// and retype. Supplying it is the difference between a link that works and
    /// an error message about a prefix nobody types.
    #[test]
    fn supplies_a_missing_scheme() {
        for (input, want) in [
            ("youtu.be/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"),
            ("www.aparat.com/v/abc", "https://www.aparat.com/v/abc"),
            (
                "example.com:8080/file.zip",
                "https://example.com:8080/file.zip",
            ),
        ] {
            assert_eq!(normalized(input), want, "{input}");
        }
    }

    /// What is actually on the clipboard after copying out of a chat: the link
    /// with a sentence around it, and the invisible marks an RTL page leaves
    /// behind.
    #[test]
    fn takes_the_link_out_of_the_text_around_it() {
        assert_eq!(
            normalized("ببین این ویدیو https://youtu.be/abc خیلی خوبه"),
            "https://youtu.be/abc"
        );
        assert_eq!(
            normalized("see https://example.com/a.zip."),
            "https://example.com/a.zip"
        );
        // A bracket that something opened stays: cutting it gives a 404.
        assert_eq!(
            normalized("https://en.wikipedia.org/wiki/Bat_(animal)"),
            "https://en.wikipedia.org/wiki/Bat_(animal)"
        );
        // A zero-width mark from a copied RTL page is not part of the URL.
        assert_eq!(
            normalized("https://example.com/\u{200f}file.mp4"),
            "https://example.com/file.mp4"
        );
    }

    /// Two links on two lines is one link and some noise, not a URL containing
    /// a newline. The point is that the second one can never be glued onto the
    /// end of the first.
    #[test]
    fn a_second_line_is_not_part_of_the_first_url() {
        assert_eq!(normalized("https://a.com/x\nhttps://b.com/y"), "https://a.com/x");
    }

    #[test]
    fn selectors_use_at_most_not_equals() {
        // height=1080 misses a 1920x1084 source entirely.
        let spec = format_selector(Some("1080"));
        assert!(spec.contains("height<=1080"), "{spec}");
        assert!(!spec.contains("height=1080"), "{spec}");
        assert!(spec.ends_with("/best"), "{spec}");
    }

    #[test]
    fn selector_accepts_both_720_and_720p() {
        assert_eq!(format_selector(Some("720")), format_selector(Some("720p")));
    }

    #[test]
    fn best_needs_no_height_filter() {
        for spec in [format_selector(Some("best")), format_selector(None)] {
            assert!(!spec.contains("height"), "{spec}");
            assert!(spec.ends_with("/best"), "{spec}");
        }
    }

    /// The output container is mp4, so the first thing asked for has to be
    /// something every player decodes. Without this, YouTube returns VP9 or AV1
    /// with Opus, yt-dlp puts them in an .mp4 exactly as told, and the file
    /// opens to a black screen on Windows.
    ///
    /// On the codec and not on `ext`, which was the first attempt: YouTube
    /// publishes AV1 inside mp4, so `bestvideo[ext=mp4]` selected format 399
    /// (`av01.0.09M.08`) and landed back in the same problem.
    #[test]
    fn asks_for_playable_codecs_before_merely_best_ones() {
        for quality in [None, Some("best"), Some("1080"), Some("720")] {
            let spec = format_selector(quality);

            assert!(
                spec.starts_with("bestvideo[vcodec^=avc1]"),
                "{quality:?} -> {spec}"
            );
            assert!(
                spec.contains("bestaudio[acodec^=mp4a]"),
                "{quality:?} -> {spec}"
            );
            // The container filter is a fallback now, not the first ask.
            assert!(
                spec.find("[ext=mp4]").unwrap() > spec.find("[vcodec^=avc1]").unwrap(),
                "{quality:?} -> {spec}"
            );
            // And it still degrades all the way down, so a source with nothing
            // but VP9 at this height downloads rather than failing.
            assert!(spec.ends_with("/best"), "{quality:?} -> {spec}");
        }
    }

    /// Every video branch carries the height cap, not just the first one --
    /// otherwise asking for 720p and getting no H.264 at 720p falls through to
    /// a branch with no limit at all and downloads the 4K.
    #[test]
    fn every_branch_respects_the_requested_height() {
        let spec = format_selector(Some("720"));
        let branches: Vec<&str> = spec.split('/').collect();

        for branch in &branches[..branches.len() - 1] {
            assert!(
                branch.contains("[height<=720]"),
                "unbounded branch {branch:?} in {spec}"
            );
        }
        // The last one is the bare "best": a source with nothing at or under
        // the cap should still download something rather than fail.
        assert_eq!(branches.last(), Some(&"best"));
    }

    #[test]
    fn spots_the_warning_that_leaves_two_files_behind() {
        // Verbatim from yt-dlp. It exits 0 after printing this, which is why it
        // has to be recognised rather than left to the exit code.
        assert!(merge_was_skipped(
            "WARNING: You have requested merging of multiple formats but ffmpeg is not installed. \
             The formats won't be merged."
        ));
        assert!(!merge_was_skipped("[Merger] Merging formats into \"a.mp4\""));
        assert!(!merge_was_skipped("[download] 100% of 12.00MiB"));
    }

    #[test]
    fn parses_a_progress_line() {
        let p = progress_of(" 42.5%|1048576|4194304|1258291.2|30")
            .expect("should parse");
        assert_eq!(p.percent, Some(42.5));
        assert_eq!(p.bytes, Some(1_048_576));
        assert_eq!(p.total_bytes, Some(4_194_304));
        assert_eq!(p.speed, Some(1_258_291.2));
        assert_eq!(p.eta_secs, Some(30));
    }

    #[test]
    fn treats_na_fields_as_absent() {
        // Live streams and some extractors report NA for everything but percent.
        let p = progress_of(" 10.0%|NA|NA|NA|NA").unwrap();
        assert_eq!(p.percent, Some(10.0));
        assert_eq!(p.bytes, None);
        assert_eq!(p.total_bytes, None);
        assert_eq!(p.speed, None);
        assert_eq!(p.eta_secs, None);
    }

    /// The template asks for `total_bytes` with `total_bytes_estimate` as its
    /// alternate, so on a fragmented source the estimate is what lands in the
    /// field -- and it has to parse like any other number. Before the alternate
    /// was added this position was always "NA" for HLS, which is why an
    /// Instagram or m3u8 download never showed a size.
    #[test]
    fn reads_an_estimated_total_like_any_other() {
        let p = progress_of(" 5.0%|524288|10485760.0|65536|120")
            .expect("should parse");
        assert_eq!(p.total_bytes, Some(10_485_760));
        assert_eq!(p.speed, Some(65_536.0));
    }

    /// yt-dlp says "Unknown" as well as "NA", and a zero speed between two
    /// fragments is not a speed worth putting on screen.
    #[test]
    fn ignores_speeds_that_are_not_speeds() {
        for field in ["Unknown", "NA", "none", "", "0"] {
            let line = format!(" 50.0%|1000|2000|{field}|10");
            let p = progress_of(&line).expect("should parse");
            assert_eq!(p.speed, None, "{field:?} should not be a speed");
        }
    }

    /// yt-dlp's estimate for a fragmented source runs behind the real size, so
    /// the bytes that have arrived overtake it. The card read "130 MB / 118 MB";
    /// what has arrived is a floor on the size.
    #[test]
    fn an_estimate_the_download_has_outgrown_is_not_shown_as_the_total() {
        let p = progress_of(" 99.0%|136314880|123731968|65536|1").unwrap();
        assert_eq!(p.bytes, Some(136_314_880));
        assert_eq!(p.total_bytes, Some(136_314_880));
    }

    /// The stream a line is about rides along as the sixth field, and a line in
    /// the older five-field shape still reads.
    #[test]
    fn reads_the_stream_a_line_is_about() {
        let (_, stream) = parse_progress("j1", " 1.0%|10|1000|5|9|137", Stage::Downloading).unwrap();
        assert_eq!(stream.as_deref(), Some("137"));
        let (_, stream) = parse_progress("j1", " 1.0%|10|1000|5|9|NA", Stage::Downloading).unwrap();
        assert_eq!(stream, None);
        let (_, stream) = parse_progress("j1", " 1.0%|10|1000|5|9", Stage::Downloading).unwrap();
        assert_eq!(stream, None);
    }

    /// A merged video is the picture, then the sound, each counted from zero.
    /// Added up, the bar never goes backwards and the size is of both.
    #[test]
    fn a_merged_download_adds_its_streams_up() {
        let mut streams = StreamTotals::default();
        let line = |payload: &str| parse_progress("j1", payload, Stage::Downloading).unwrap();

        let (p, s) = line(" 50.0%|500|1000|10|1|137");
        let p = streams.add(s, p);
        assert_eq!((p.bytes, p.total_bytes, p.percent), (Some(500), Some(1000), Some(50.0)));

        let (p, s) = line("100.0%|1000|1000|10|0|137");
        streams.add(s, p);

        // The audio starts at zero of its own 100 bytes -- and is shown as
        // 1000 of 1100, not as 0 of 100.
        let (p, s) = line("  0.0%|0|100|10|10|140");
        let p = streams.add(s, p);
        assert_eq!(p.bytes, Some(1000));
        assert_eq!(p.total_bytes, Some(1100));
        assert!(p.percent.unwrap() > 90.0, "{:?}", p.percent);

        let (p, s) = line("100.0%|100|100|10|0|140");
        let p = streams.add(s, p);
        assert_eq!((p.bytes, p.total_bytes, p.percent), (Some(1100), Some(1100), Some(100.0)));
    }

    /// A single stream is passed through exactly as yt-dlp reported it.
    #[test]
    fn a_single_stream_is_left_alone() {
        let mut streams = StreamTotals::default();
        let (p, s) = parse_progress("j1", " 42.0%|420|1000|10|5|18", Stage::Downloading).unwrap();
        let p = streams.add(s, p);
        assert_eq!((p.bytes, p.total_bytes, p.percent), (Some(420), Some(1000), Some(42.0)));
    }

    /// "none" is a missing picture; "NA" is yt-dlp not knowing, which is what
    /// the generic extractor says about a plain file and is evidence of nothing.
    #[test]
    fn only_an_explicit_none_makes_a_video_request_audio() {
        assert_eq!(parse_info("none|opus|Track", false), (MediaClass::Audio, Some("Track".into())));
        assert_eq!(parse_info("avc1.64001F|mp4a.40.2|Clip", false).0, MediaClass::Video);
        assert_eq!(parse_info("NA|NA|NA", false), (MediaClass::Video, None));
        // Asked for as audio, it is audio whatever the page has.
        assert_eq!(parse_info("avc1|mp4a|Clip", true).0, MediaClass::Audio);
        // A title with the separator in it survives whole.
        assert_eq!(parse_info("none|opus|A | B", false).1.as_deref(), Some("A | B"));
    }
}
