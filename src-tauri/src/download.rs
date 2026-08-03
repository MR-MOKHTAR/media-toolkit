//! Downloading with yt-dlp.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::binaries::{self, Tool};
use crate::error::{AppError, AppResult};
use crate::jobs::{Emitters, JobKind, JobProgress, JobStatus, Jobs, Stage};
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
const CONCURRENT_FRAGMENTS: u8 = 8;

const PROGRESS_TEMPLATE: &str = concat!(
    "download:__DLPROGRESS__",
    "%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s",
    "|%(progress._speed_str)s|%(progress.eta)s"
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlInfo {
    pub title: String,
    pub uploader: Option<String>,
    pub duration_secs: Option<f64>,
    pub thumbnail: Option<String>,
    pub is_playlist: bool,
    pub entry_count: Option<u64>,
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
fn format_selector(quality: Option<&str>) -> String {
    match quality.unwrap_or("best") {
        "best" => "bestvideo+bestaudio/best".to_string(),
        height => {
            let height: u32 = height.trim_end_matches('p').parse().unwrap_or(720);
            format!(
                "bestvideo[height<={h}]+bestaudio/best[height<={h}]/best",
                h = height
            )
        }
    }
}

pub async fn run(
    app: AppHandle,
    jobs: &Jobs,
    id: String,
    request: DownloadRequest,
) -> AppResult<()> {
    let url = validate_url(&request.url)?;
    let dir = paths::ensure_dir(&request.output_dir)?;
    let is_audio = request.media_type == "audio";

    let mut emitters = Emitters::new(app.clone());
    emitters.status(&id, JobKind::Download, JobStatus::Queued);

    let _permit = jobs.acquire(JobKind::Download).await;

    emitters.status(&id, JobKind::Download, JobStatus::Running);
    emitters.progress_now(JobProgress::new(&id, JobKind::Download, Stage::Preparing));

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
        // The single biggest speed lever. YouTube and Instagram serve DASH and
        // HLS, and yt-dlp fetches fragments one at a time by default, so a
        // download that could saturate the line instead trickles.
        "--concurrent-fragments".into(),
        CONCURRENT_FRAGMENTS.to_string(),
        // YouTube throttles each connection after the first few megabytes.
        // Requesting in chunks makes it hand out a fresh allowance per chunk.
        "--http-chunk-size".into(),
        "10M".into(),
        // When a stream still ends up throttled below this, re-extract rather
        // than sit at 40 KB/s for an hour.
        "--throttled-rate".into(),
        "100K".into(),
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
    if let Ok(ffmpeg) = binaries::resolve(&app, Tool::Ffmpeg) {
        if let Some(parent) = ffmpeg.path.parent().filter(|dir| !dir.as_os_str().is_empty()) {
            args.push("--ffmpeg-location".into());
            args.push(parent.to_string_lossy().into_owned());
        }
    }

    args.push("--".into());
    args.push(url);

    let mut cmd = binaries::command(&app, Tool::YtDlp)?;
    cmd.args(&args);

    // The child goes into the registry so `cancel_job` can reach it, while the
    // reader keeps the pipes. Taking stdout and stderr before the handover is
    // what lets cancellation and progress coexist.
    let process::Running { child, mut lines } = process::spawn(cmd, Tool::YtDlp.name())?;
    jobs.attach_child(&id, child).await;

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
                    let path = final_path.clone().expect("just assigned");
                    jobs.set_partial_output(&id, path).await;
                } else if let Some(payload) = line.strip_prefix(MARKER) {
                    if let Some(progress) = parse_progress(&id, payload, stage) {
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
                        ..JobProgress::new(&id, JobKind::Download, Stage::Merging)
                    });
                } else if line.contains("[ExtractAudio]") {
                    stage = Stage::Finalizing;
                    emitters.progress_now(JobProgress::new(
                        &id,
                        JobKind::Download,
                        Stage::Finalizing,
                    ));
                }
                tail.push(line);
            }
        }
    }

    // A child that is gone from the registry was taken by `cancel`.
    let Some(mut child) = jobs.take_child(&id).await else {
        cleanup_partial(jobs, &id).await;
        emitters.status(&id, JobKind::Download, JobStatus::Cancelled);
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
        let error = AppError::tool_missing(Tool::Ffmpeg.name());
        jobs.clear_partial_output(&id).await;
        jobs.finish(&id).await;
        emitters.status(
            &id,
            JobKind::Download,
            JobStatus::Failed {
                error: error.clone(),
            },
        );
        return Err(error);
    }

    if !status.success() {
        cleanup_partial(jobs, &id).await;
        let error = AppError::Tool {
            tool: Tool::YtDlp.name().to_string(),
            code: status.code(),
            tail: tail.into_string(),
        };
        emitters.status(
            &id,
            JobKind::Download,
            JobStatus::Failed {
                error: error.clone(),
            },
        );
        return Err(error);
    }

    // `--print after_move:%(filepath)s` gives the real name after every
    // post-processor has run, which is the only reliable way to know it: the
    // extension depends on what the source turned out to be.
    let output = final_path.unwrap_or_else(|| dir.join(format!("{stem}.{ext}")));

    jobs.clear_partial_output(&id).await;
    jobs.finish(&id).await;

    emitters.progress_now(JobProgress {
        percent: Some(100.0),
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

async fn cleanup_partial(jobs: &Jobs, id: &str) {
    // A killed download leaves a truncated file behind, which looks like a
    // usable result in the folder until it is opened.
    if let Some(path) = jobs.finish(id).await {
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("part"));
    }
}

fn parse_progress(id: &str, payload: &str, stage: Stage) -> Option<JobProgress> {
    let fields: Vec<&str> = payload.splitn(5, '|').collect();
    if fields.len() != 5 {
        return None;
    }

    let number = |raw: &str| -> Option<u64> {
        let raw = raw.trim();
        (raw != "NA" && raw != "N/A" && !raw.is_empty())
            .then(|| raw.parse::<f64>().ok())
            .flatten()
            .map(|v| v as u64)
    };
    let text = |raw: &str| -> Option<String> {
        let raw = raw.trim();
        (!raw.is_empty() && raw != "NA" && raw != "N/A").then(|| raw.to_string())
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
        speed: text(fields[3]),
        eta_secs: number(fields[4]),
        bytes: number(fields[1]),
        total_bytes: number(fields[2]),
    })
}

/// Metadata for the download screen's preview: title, channel, duration and
/// thumbnail, so pasting a link shows what is about to be downloaded.
pub async fn probe_url(app: &AppHandle, url: &str) -> AppResult<UrlInfo> {
    let url = validate_url(url)?;
    let mut cmd = binaries::command(app, Tool::YtDlp)?;
    cmd.args([
        "-J",
        "--no-warnings",
        "--flat-playlist",
        "--no-playlist",
        "--",
        &url,
    ]);

    let stdout = process::output(cmd, Tool::YtDlp.name()).await?;
    let value: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|error| AppError::invalid("url", format!("could not read metadata: {error}")))?;

    let entries = value.get("entries").and_then(|e| e.as_array());
    Ok(UrlInfo {
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
        assert_eq!(format_selector(Some("best")), "bestvideo+bestaudio/best");
        assert_eq!(format_selector(None), "bestvideo+bestaudio/best");
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
        let p = parse_progress("j1", " 42.5%|1048576|4194304| 1.20MiB/s|30", Stage::Downloading)
            .expect("should parse");
        assert_eq!(p.percent, Some(42.5));
        assert_eq!(p.bytes, Some(1_048_576));
        assert_eq!(p.total_bytes, Some(4_194_304));
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
}
