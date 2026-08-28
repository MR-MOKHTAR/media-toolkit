//! Running an ffmpeg job and turning its output into progress.

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::binaries::{self, Tool};
use crate::error::{AppError, AppResult};
use crate::jobs::{Emitters, JobKind, JobProgress, JobStatus, Jobs, Stage};
use crate::process::{self, Line, StderrTail};

/// Options every invocation gets.
///
/// `-nostdin` matters: without it ffmpeg reads the inherited stdin and can
/// consume input meant for the app. `-nostats` turns off the human-readable
/// status line, which is both unparseable and the thing that floods stderr.
pub const COMMON_ARGS: &[&str] = &[
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    "-nostats",
];

/// One ffmpeg invocation. Multi-pass operations -- target-size encoding is the
/// one this app has -- are a list of these.
pub struct Pass {
    pub args: Vec<String>,
    /// Media seconds this pass will produce, for the percentage. `None` leaves
    /// progress indeterminate rather than inventing a denominator.
    pub duration_secs: Option<f64>,
    /// A pass that only analyses (two-pass pass 1) produces no visible output
    /// but still takes time, so it still reports progress.
    pub label: &'static str,
}

pub struct Plan {
    pub passes: Vec<Pass>,
    pub output: PathBuf,
    /// Removed on completion and on failure. Palette PNGs and two-pass logs.
    pub temp_files: Vec<PathBuf>,
}

/// Runs a plan, emitting progress across all its passes.
pub async fn run(
    app: AppHandle,
    jobs: &Jobs,
    id: String,
    kind: JobKind,
    plan: Plan,
) -> AppResult<()> {
    let mut emitters = Emitters::new(app.clone());
    emitters.status(&id, kind, JobStatus::Queued);
    // Emitted before the permit so a job waiting behind the semaphore reads as
    // "waiting" rather than as a frozen 0%.
    emitters.progress_now(JobProgress::new(&id, kind, Stage::Queued));

    // Held until the job ends. This is what makes four concurrent compressions
    // queue instead of pegging every core.
    let _permit = jobs.acquire(kind).await;

    emitters.status(&id, kind, JobStatus::Running);
    jobs.set_partial_output(&id, plan.output.clone()).await;

    let total_passes = plan.passes.len() as f64;
    let result = run_passes(&app, jobs, &id, kind, &plan, &mut emitters, total_passes).await;

    for temp in &plan.temp_files {
        let _ = std::fs::remove_file(temp);
    }

    match result {
        Ok(()) => {
            jobs.clear_partial_output(&id).await;
            jobs.finish(&id).await;
            emitters.progress_now(JobProgress {
                percent: Some(100.0),
                ..JobProgress::new(&id, kind, Stage::Finalizing)
            });
            emitters.status(
                &id,
                kind,
                JobStatus::Completed {
                    output_path: plan.output.to_string_lossy().into_owned(),
                },
            );
            Ok(())
        }
        Err(AppError::Cancelled) => {
            cleanup(jobs, &id).await;
            emitters.status(&id, kind, JobStatus::Cancelled);
            Err(AppError::Cancelled)
        }
        Err(error) => {
            cleanup(jobs, &id).await;
            emitters.status(
                &id,
                kind,
                JobStatus::Failed {
                    error: error.clone(),
                },
            );
            Err(error)
        }
    }
}

async fn run_passes(
    app: &AppHandle,
    jobs: &Jobs,
    id: &str,
    kind: JobKind,
    plan: &Plan,
    emitters: &mut Emitters,
    total_passes: f64,
) -> AppResult<()> {
    for (index, pass) in plan.passes.iter().enumerate() {
        let mut cmd = binaries::command(app, Tool::Ffmpeg)?;
        cmd.args(COMMON_ARGS);
        cmd.args(&pass.args);

        let process::Running { child, mut lines } = process::spawn(cmd, Tool::Ffmpeg.name())?;
        jobs.attach_child(id, child).await;

        let mut tail = StderrTail::default();
        let mut block = ProgressBlock::default();

        while let Some(line) = lines.recv().await {
            match line {
                Line::Stdout(line) => {
                    if let Some(update) = block.feed(&line) {
                        // The terminal block lands short of the real duration,
                        // so it is dropped; the completion path emits the 100.
                        if update.ended {
                            continue;
                        }
                        let fraction = update.fraction(pass.duration_secs);
                        emitters.progress(JobProgress {
                            // Spread each pass across its slice of the whole,
                            // so a two-pass encode does not run 0-100 twice.
                            percent: fraction
                                .map(|f| ((index as f64 + f) / total_passes * 100.0).clamp(0.0, 99.9)),
                            encode_rate: update.speed,
                            eta_secs: update.eta_secs(pass.duration_secs),
                            bytes: update.total_size,
                            ..JobProgress::new(id, kind, Stage::Encoding)
                        });
                    }
                }
                Line::Stderr(line) => tail.push(line),
            }
        }

        let Some(mut child) = jobs.take_child(id).await else {
            return Err(AppError::Cancelled);
        };

        let status = child
            .wait()
            .await
            .map_err(|error| AppError::spawn(Tool::Ffmpeg.name(), error))?;

        if !status.success() {
            return Err(AppError::Tool {
                tool: format!("ffmpeg ({})", pass.label),
                code: status.code(),
                tail: tail.into_string(),
            });
        }
    }
    Ok(())
}

async fn cleanup(jobs: &Jobs, id: &str) {
    // ffmpeg leaves a truncated file when killed, and a half-written mp4 in the
    // output folder is indistinguishable from a finished one until it is played.
    if let Some(path) = jobs.finish(id).await {
        let _ = std::fs::remove_file(path);
    }
}

/// Accumulates `key=value` lines until ffmpeg terminates a block.
#[derive(Default)]
pub struct ProgressBlock {
    out_time_us: Option<u64>,
    total_size: Option<u64>,
    speed: Option<f64>,
    ended: bool,
}

#[derive(Debug, Clone)]
pub struct ProgressUpdate {
    pub out_time_secs: f64,
    pub total_size: Option<u64>,
    /// ffmpeg's realtime multiplier, already parsed out of `2.0x`. It was kept
    /// as the raw string and re-parsed inside `eta_secs`, which meant the one
    /// place that needed it as a number did the work and the UI got the `x`.
    pub speed: Option<f64>,
    pub ended: bool,
}

impl ProgressUpdate {
    pub fn fraction(&self, duration_secs: Option<f64>) -> Option<f64> {
        // Without a duration there is no denominator. An indeterminate bar is
        // honest; a fabricated percentage is not.
        let duration = duration_secs.filter(|d| *d > 0.0)?;
        Some((self.out_time_secs / duration).clamp(0.0, 1.0))
    }

    pub fn eta_secs(&self, duration_secs: Option<f64>) -> Option<u64> {
        let duration = duration_secs.filter(|d| *d > 0.0)?;
        let speed = self.speed?;
        if speed <= 0.0 {
            return None;
        }
        let remaining = (duration - self.out_time_secs).max(0.0);
        Some((remaining / speed) as u64)
    }
}

impl ProgressBlock {
    /// Feeds one line, returning an update when the block is complete.
    ///
    /// ffmpeg writes repeating blocks of `key=value` to stdout, each ending
    /// with `progress=continue` or `progress=end`.
    pub fn feed(&mut self, line: &str) -> Option<ProgressUpdate> {
        let (key, value) = line.split_once('=')?;
        let value = value.trim();

        match key.trim() {
            // Despite the name, out_time_ms is MICROseconds -- a long-standing
            // ffmpeg naming bug, and out_time_us carries the identical value.
            // Reading it as milliseconds gives progress 1000x too fast.
            "out_time_us" | "out_time_ms" => {
                self.out_time_us = value.parse().ok();
            }
            "total_size" => self.total_size = value.parse().ok(),
            "speed" => {
                // "N/A" until the first frames are through, and "2.05x" after.
                self.speed = value.trim().trim_end_matches('x').parse().ok();
            }
            "progress" => {
                self.ended = value == "end";
                let update = ProgressUpdate {
                    out_time_secs: self.out_time_us.unwrap_or(0) as f64 / 1_000_000.0,
                    total_size: self.total_size,
                    speed: self.speed.clone(),
                    ended: self.ended,
                };
                return Some(update);
            }
            _ => {}
        }
        None
    }
}

pub fn arg(value: impl AsRef<str>) -> String {
    value.as_ref().to_string()
}

pub fn path_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_all(block: &mut ProgressBlock, lines: &[&str]) -> Option<ProgressUpdate> {
        let mut last = None;
        for line in lines {
            if let Some(update) = block.feed(line) {
                last = Some(update);
            }
        }
        last
    }

    #[test]
    fn out_time_ms_is_actually_microseconds() {
        // Verified against the bundled n8.1.2 build: for a 1.933 s output it
        // prints out_time_us=1933333 AND out_time_ms=1933333, the same number.
        // Treating out_time_ms as milliseconds would report 1933 seconds.
        let mut block = ProgressBlock::default();
        let update = feed_all(
            &mut block,
            &["out_time_us=1933333", "out_time_ms=1933333", "progress=continue"],
        )
        .unwrap();
        assert!((update.out_time_secs - 1.933333).abs() < 1e-6, "{}", update.out_time_secs);
    }

    #[test]
    fn percentage_needs_a_known_duration() {
        let mut block = ProgressBlock::default();
        let update = feed_all(&mut block, &["out_time_us=1000000", "progress=continue"]).unwrap();
        assert_eq!(update.fraction(Some(4.0)), Some(0.25));
        assert_eq!(update.fraction(None), None);
        assert_eq!(update.fraction(Some(0.0)), None);
    }

    #[test]
    fn never_exceeds_one_when_ffmpeg_overshoots() {
        // The final block can report slightly past the probed duration.
        let mut block = ProgressBlock::default();
        let update = feed_all(&mut block, &["out_time_us=5000000", "progress=end"]).unwrap();
        assert_eq!(update.fraction(Some(4.0)), Some(1.0));
        assert!(update.ended);
    }

    #[test]
    fn treats_na_speed_as_absent() {
        let mut block = ProgressBlock::default();
        let update = feed_all(&mut block, &["speed=N/A", "progress=continue"]).unwrap();
        assert_eq!(update.speed, None);
        assert_eq!(update.eta_secs(Some(10.0)), None);
    }

    #[test]
    fn eta_divides_remaining_media_time_by_speed() {
        let mut block = ProgressBlock::default();
        let update = feed_all(
            &mut block,
            &["out_time_us=2000000", "speed=2.0x", "progress=continue"],
        )
        .unwrap();
        // 8 s of media left at 2x runs for 4 s.
        assert_eq!(update.eta_secs(Some(10.0)), Some(4));
    }

    #[test]
    fn ignores_lines_that_are_not_key_value() {
        let mut block = ProgressBlock::default();
        assert!(block.feed("frame= 60").is_none());
        assert!(block.feed("").is_none());
    }
}
