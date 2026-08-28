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

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::binaries::{self, Tool};
use crate::direct::{self, FileInfo};
use crate::error::{AppError, AppResult};
use crate::jobs::{Emitters, JobKind, JobProgress, JobStatus, Jobs, Stage};
use crate::muxed;
use crate::paths;
use crate::process::{self, Line, StderrTail};

/// Marks our own progress lines so they are unambiguous in the stdout stream.
const MARKER: &str = "__DLPROGRESS__";

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
const PROGRESS_TEMPLATE: &str = concat!(
    "download:__DLPROGRESS__",
    "%(progress._percent_str)s",
    "|%(progress.downloaded_bytes)s",
    "|%(progress.total_bytes,progress.total_bytes_estimate)s",
    "|%(progress.speed)s",
    "|%(progress.eta)s"
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
}

impl DownloadRequest {
    fn wants_audio(&self) -> bool {
        self.media_type == "audio"
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
    pub is_playlist: bool,
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
fn validate_url(url: &str) -> AppResult<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid("url", "empty"));
    }
    let lower = trimmed.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err(AppError::invalid("url", "must start with http:// or https://"));
    }
    // Anything that would let a crafted URL reach the local filesystem or a
    // shell is rejected outright rather than handed to a subprocess.
    if lower.starts_with("file:") || lower.contains('\n') || lower.contains('\r') {
        return Err(AppError::invalid("url", "unsupported scheme"));
    }
    Ok(trimmed.to_string())
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
pub async fn run(
    app: AppHandle,
    jobs: &Jobs,
    id: String,
    request: DownloadRequest,
) -> AppResult<()> {
    let url = validate_url(&request.url)?;
    let dir = paths::ensure_dir(&request.output_dir)?;

    let mut emitters = Emitters::new(app.clone());
    emitters.status(&id, JobKind::Download, JobStatus::Queued);

    let _permit = jobs.acquire(JobKind::Download).await;

    emitters.status(&id, JobKind::Download, JobStatus::Running);
    emitters.progress_now(JobProgress::new(&id, JobKind::Download, Stage::Preparing));

    let outcome = match choose_engine(&url, &request).await {
        Engine::Direct(info) => {
            // Nothing to kill: the work is a set of HTTPS requests rather than
            // a child process, so cancellation arrives through the signal.
            let cancel = jobs.cancel_signal(&id).await;
            direct::run(
                &id,
                &mut emitters,
                &cancel,
                &url,
                &dir,
                request.output_name.as_deref(),
                &info,
            )
            .await
        }
        Engine::YtDlp => {
            run_media(&app, jobs, &id, &mut emitters, &url, &dir, &request).await
        }
    };

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
async fn run_media(
    app: &AppHandle,
    jobs: &Jobs,
    id: &str,
    emitters: &mut Emitters,
    url: &str,
    dir: &Path,
    request: &DownloadRequest,
) -> AppResult<PathBuf> {
    // Audio is a transcode, not a transfer: `-x --audio-format mp3` is
    // yt-dlp's post-processor, the stream is a tenth the size of the video, and
    // the download is not the slow part. Nothing to gain and a whole second
    // path to get wrong.
    let eligible = !request.wants_audio()
        && request.parallel.unwrap_or(true)
        // Merging is ffmpeg's, so without ffmpeg this path cannot finish what
        // it starts. `run_ytdlp` already reports that case properly.
        && binaries::resolve(app, Tool::Ffmpeg).is_ok();

    if eligible {
        let selector = format_selector(request.quality.as_deref());
        let cancel = jobs.cancel_signal(id).await;

        // Guarded, because resolving is a yt-dlp spawn and yt-dlp takes about
        // two seconds to unpack itself before it does anything. That is two
        // seconds of a cancelled job sitting there looking cancelled and not
        // being, and the child is not in the registry for `cancel_job` to
        // reach -- dropping the future is what ends it.
        //
        // `Ok(None)` is the ordinary answer for most of the web; an extraction
        // error is left to `run_ytdlp` to produce again with its own stderr
        // tail attached, which is the one the user can actually read.
        let resolved = match cancel.guard(muxed::resolve(app, url, &selector)).await {
            Ok(resolved) => resolved,
            Err(_) => return Err(AppError::Cancelled),
        };

        if let Ok(Some(plan)) = resolved {
            match muxed::run(
                app,
                jobs,
                id,
                emitters,
                &cancel,
                dir,
                request.output_name.as_deref(),
                &plan,
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

    run_ytdlp(app, jobs, id, emitters, url, dir, request).await
}

/// The extractor engine: yt-dlp, for the thousand-odd sites where the link the
/// user has is not the link the file is at.
async fn run_ytdlp(
    app: &AppHandle,
    jobs: &Jobs,
    id: &str,
    emitters: &mut Emitters,
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

    let ext = if is_audio { "mp3" } else { "mp4" };
    let template = dir.join(format!("{stem}.%(ext)s"));

    let mut args: Vec<String> = vec![
        "--newline".into(),
        "--no-colors".into(),
        "--no-playlist".into(),
        "--progress-template".into(),
        PROGRESS_TEMPLATE.into(),
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
        args.extend([
            "-x".into(),
            "--audio-format".into(),
            "mp3".into(),
            "--audio-quality".into(),
            "0".into(),
        ]);
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

    args.push("--".into());
    args.push(url.to_string());

    let mut cmd = binaries::command(app, Tool::YtDlp)?;
    cmd.args(&args);
    binaries::with_js_runtime(app, &mut cmd);

    // The child goes into the registry so `cancel_job` can reach it, while the
    // reader keeps the pipes. Taking stdout and stderr before the handover is
    // what lets cancellation and progress coexist.
    let process::Running { child, mut lines } = process::spawn(cmd, Tool::YtDlp.name())?;
    jobs.attach_child(id, child).await;

    let mut tail = StderrTail::default();
    let mut final_path: Option<PathBuf> = None;
    let mut stage = Stage::Downloading;
    // See `merge_was_skipped`.
    let mut unmerged = false;

    while let Some(line) = lines.recv().await {
        match line {
            Line::Stdout(line) => {
                if let Some(path) = line.strip_prefix("__DLPATH__") {
                    final_path = Some(PathBuf::from(path.trim()));
                } else if let Some(payload) = line.strip_prefix(MARKER) {
                    if let Some(progress) = parse_progress(id, payload, stage) {
                        emitters.progress(progress);
                    }
                }
            }
            Line::Stderr(line) => {
                unmerged |= merge_was_skipped(&line);
                // yt-dlp reports merging on stderr, and it is the one phase
                // that can sit at 100% for a long time on a large video.
                if line.contains("[Merger]") || line.contains("Merging formats") {
                    stage = Stage::Merging;
                    emitters.progress_now(JobProgress {
                        percent: Some(100.0),
                        ..JobProgress::new(id, JobKind::Download, Stage::Merging)
                    });
                } else if line.contains("[ExtractAudio]") {
                    stage = Stage::Finalizing;
                    emitters.progress_now(JobProgress::new(
                        id,
                        JobKind::Download,
                        Stage::Finalizing,
                    ));
                }
                tail.push(line);
            }
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

fn parse_progress(id: &str, payload: &str, stage: Stage) -> Option<JobProgress> {
    let fields: Vec<&str> = payload.splitn(5, '|').collect();
    if fields.len() != 5 {
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

    Some(JobProgress {
        id: id.to_string(),
        kind: JobKind::Download,
        percent,
        stage,
        speed: decimal(fields[3]).filter(|rate| *rate > 0.0),
        encode_rate: None,
        eta_secs: number(fields[4]),
        bytes: number(fields[1]),
        total_bytes: number(fields[2]),
    })
}

/// What the download screen previews after a link is pasted.
///
/// Asks the cheap question first. A direct link answers in one request, with
/// its real name and its exact size, and never has to wake yt-dlp at all --
/// which is the difference between a preview that appears as you finish
/// pasting and one that takes two seconds. Only a page falls through to the
/// extractor, and a page is the only thing the extractor is needed for.
pub async fn probe_url(app: &AppHandle, url: &str) -> AppResult<UrlInfo> {
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
            entry_count: None,
            size_bytes: file.size_bytes,
            resumable: file.resumable,
        });
    }

    let mut cmd = binaries::command(app, Tool::YtDlp)?;
    cmd.args([
        "-J",
        "--no-warnings",
        "--flat-playlist",
        "--no-playlist",
        "--",
        &url,
    ]);
    binaries::with_js_runtime(app, &mut cmd);

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
        entry_count: entries.map(|e| e.len() as u64),
        // yt-dlp cannot say: the size depends on the format it ends up
        // choosing, which it does not decide until the download starts.
        size_bytes: None,
        // yt-dlp writes a `.part` and continues from it, for every site.
        resumable: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
        for url in ["file:///etc/passwd", "javascript:alert(1)", "", "  "] {
            assert!(validate_url(url).is_err(), "{url} should be rejected");
        }
    }

    #[test]
    fn rejects_embedded_newlines() {
        assert!(validate_url("https://a.com\nhttps://b.com").is_err());
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
        let p = parse_progress("j1", " 42.5%|1048576|4194304|1258291.2|30", Stage::Downloading)
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
        let p = parse_progress("j1", " 10.0%|NA|NA|NA|NA", Stage::Downloading).unwrap();
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
        let p = parse_progress("j1", " 5.0%|524288|10485760.0|65536|120", Stage::Downloading)
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
            let p = parse_progress("j1", &line, Stage::Downloading).expect("should parse");
            assert_eq!(p.speed, None, "{field:?} should not be a speed");
        }
    }
}
