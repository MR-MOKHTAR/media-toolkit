//! Running a transcription.
//!
//! Deliberately a second runner rather than a generalization of
//! `media::runner`. That one is built around "N ffmpeg invocations, percent
//! spread evenly across passes", and bending it to also mean "one ffmpeg
//! invocation, then N HTTPS uploads" would make the ffmpeg path harder to read
//! for no shared code. The two share what actually is shared: `process::spawn`,
//! `ProgressBlock`, `Emitters` and the `Jobs` registry, plus the same
//! register -> acquire -> emit -> clean up contract.

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::chunks::{self, ChunkSpec, Segment};
use super::groq::{self, Model};
use super::subtitles::{self, OutputFormat};
use crate::binaries::{self, Tool};
use crate::error::{AppError, AppResult};
use crate::jobs::{CancelSignal, Emitters, JobKind, JobProgress, JobStatus, Jobs, Stage};
use crate::media::runner::{ProgressBlock, COMMON_ARGS};
use crate::paths;
use crate::process::{self, Line, StderrTail};

const KIND: JobKind = JobKind::Transcribe;

/// The share of the bar that belongs to extracting and splitting the audio.
const PREPARE_SHARE: f64 = 10.0;
/// ...and to the uploads. The remainder is merging and writing the file.
const UPLOAD_SHARE: f64 = 85.0;

pub struct Job {
    pub input: PathBuf,
    pub output_dir: PathBuf,
    pub output_name: Option<String>,
    pub duration_secs: f64,
    pub model: Model,
    pub language: Option<String>,
    pub translate: bool,
    pub prompt: Option<String>,
    pub format: OutputFormat,
    pub key: String,
}

pub async fn run(app: AppHandle, jobs: &Jobs, id: String, job: Job) -> AppResult<()> {
    let mut emitters = Emitters::new(app.clone());
    emitters.status(&id, KIND, JobStatus::Queued);
    emitters.progress_now(JobProgress::new(&id, KIND, Stage::Queued));

    let cancel = jobs.cancel_signal(&id).await;
    let _permit = jobs.acquire(KIND).await;

    // A cancel arriving while the job sat behind the semaphore has to be
    // honoured before anything is spent. The five ffmpeg tools have the same
    // gap and simply start anyway; this one is spending someone's quota, so it
    // checks.
    if cancel.is_cancelled() {
        finish_cancelled(jobs, &id, &mut emitters, None).await;
        return Err(AppError::Cancelled);
    }

    emitters.status(&id, KIND, JobStatus::Running);

    // One directory per job, so cleanup is a single call on every exit. Audio
    // temporaries are large and there are up to sixty-four of them.
    let workdir = std::env::temp_dir().join(format!(
        "mt-transcribe-{}-{}",
        std::process::id(),
        id.replace(['/', '\\'], "-")
    ));
    let result = pipeline(&app, jobs, &id, &job, &cancel, &workdir, &mut emitters).await;
    let _ = std::fs::remove_dir_all(&workdir);

    match result {
        Ok(output) => {
            jobs.clear_partial_output(&id).await;
            jobs.finish(&id).await;
            emitters.progress_now(JobProgress {
                percent: Some(100.0),
                ..JobProgress::new(&id, KIND, Stage::Finalizing)
            });
            emitters.status(
                &id,
                KIND,
                JobStatus::Completed {
                    output_path: output.to_string_lossy().into_owned(),
                },
            );
            Ok(())
        }
        Err(AppError::Cancelled) => {
            finish_cancelled(jobs, &id, &mut emitters, None).await;
            Err(AppError::Cancelled)
        }
        Err(error) => {
            cleanup_output(jobs, &id).await;
            emitters.status(
                &id,
                KIND,
                JobStatus::Failed {
                    error: error.clone(),
                },
            );
            Err(error)
        }
    }
}

async fn pipeline(
    app: &AppHandle,
    jobs: &Jobs,
    id: &str,
    job: &Job,
    cancel: &CancelSignal,
    workdir: &Path,
    emitters: &mut Emitters,
) -> AppResult<PathBuf> {
    std::fs::create_dir_all(workdir).map_err(|e| AppError::io(workdir, e))?;

    // 1. Extract to what Groq's own documentation asks for: 16 kHz mono FLAC.
    //    It is also what makes the 25 MB per-request ceiling reachable at all
    //    for a long recording.
    let flac = workdir.join("full.flac");
    extract_audio(app, jobs, id, job, &flac, emitters).await?;

    let flac_bytes = std::fs::metadata(&flac)
        .map_err(|e| AppError::io(&flac, e))?
        .len();
    let plan = chunks::chunk_plan(job.duration_secs, flac_bytes)?;

    // 2. Cut the chunks. Re-encoded rather than stream-copied: a FLAC frame is
    //    about 4096 samples, so `-c copy` snaps every cut to a frame boundary
    //    and the overlaps stop lining up with the timeline the merge assumes.
    //    Re-encoding 16 kHz mono is close to free.
    let paths = split_chunks(app, job, &plan, &flac, workdir, cancel).await?;

    emitters.progress_now(JobProgress {
        percent: Some(PREPARE_SHARE),
        ..JobProgress::new(id, KIND, Stage::Transcribing)
    });

    // 3. Upload, one at a time. Concurrency here would multiply pressure on the
    //    scarcest resource in the whole feature -- a per-model audio-seconds
    //    budget nobody but Groq can see -- to shorten a job whose wall time is a
    //    fixed number of round trips anyway.
    let client = groq::client()?;
    let mut transcribed: Vec<(ChunkSpec, Vec<Segment>)> = Vec::with_capacity(plan.len());
    let mut carry: Option<String> = None;

    for (chunk, path) in plan.iter().zip(&paths) {
        if cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }

        // Groq's prompt is a continuity hint as much as a vocabulary one: the
        // tail of what came before helps it punctuate and spell consistently
        // across a seam. The user's own hint wins when they gave one.
        let prompt = job
            .prompt
            .clone()
            .or_else(|| carry.clone())
            .filter(|p| !p.trim().is_empty());

        let request = groq::Request {
            key: &job.key,
            model: job.model,
            language: job.language.as_deref(),
            translate: job.translate,
            prompt: prompt.as_deref(),
        };

        // Nothing is caught here. A rate limit ends the job with the wait Groq
        // asked for, and the screen turns that into a warning saying which
        // limit was reached -- there is no local budget left to adjust.
        let answer = groq::transcribe(&client, &request, path, cancel).await?;

        carry = answer
            .segments
            .last()
            .map(|segment| tail_words(&segment.text, 200));
        transcribed.push((*chunk, answer.segments));

        emitters.progress_now(JobProgress {
            percent: Some(
                PREPARE_SHARE + UPLOAD_SHARE * (transcribed.len() as f64 / plan.len() as f64),
            ),
            ..JobProgress::new(id, KIND, Stage::Transcribing)
        });
    }

    // 4. Back onto one timeline, then to disk.
    let segments = chunks::merge_segments(&transcribed, job.duration_secs);
    let body = subtitles::render(job.format, &segments);

    let stem = job
        .output_name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| paths::stem_of(&job.input));
    let output = paths::unique_output(&job.output_dir, &stem, job.format.extension());

    // Registered before the write, so a cancel landing mid-write removes the
    // half-file rather than leaving a truncated transcript that reads as whole.
    jobs.set_partial_output(id, output.clone()).await;
    if cancel.is_cancelled() {
        return Err(AppError::Cancelled);
    }
    std::fs::write(&output, body).map_err(|e| AppError::io(&output, e))?;

    Ok(output)
}

/// The one step with real progress to report: ffmpeg knows how far through the
/// file it is, and `-progress pipe:1` says so.
async fn extract_audio(
    app: &AppHandle,
    jobs: &Jobs,
    id: &str,
    job: &Job,
    output: &Path,
    emitters: &mut Emitters,
) -> AppResult<()> {
    let mut cmd = binaries::command(app, Tool::Ffmpeg)?;
    cmd.args(COMMON_ARGS);
    cmd.args([
        "-i",
        &job.input.to_string_lossy(),
        // Drop video and any secondary audio track. Without -vn, embedded cover
        // art becomes a one-frame video stream the FLAC muxer then rejects.
        "-vn",
        "-map",
        "0:a:0",
        // Groq downsamples to 16 kHz mono anyway; doing it here means uploading
        // a tenth of the bytes for exactly the same transcript.
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "flac",
        "-compression_level",
        "8",
        &output.to_string_lossy(),
    ]);

    let process::Running { child, mut lines } = process::spawn(cmd, Tool::Ffmpeg.name())?;
    jobs.attach_child(id, child).await;

    let mut tail = StderrTail::default();
    let mut block = ProgressBlock::default();

    while let Some(line) = lines.recv().await {
        match line {
            Line::Stdout(line) => {
                if let Some(update) = block.feed(&line) {
                    if update.ended {
                        continue;
                    }
                    emitters.progress(JobProgress {
                        percent: update
                            .fraction(Some(job.duration_secs))
                            .map(|f| f * PREPARE_SHARE),
                        encode_rate: update.speed,
                        ..JobProgress::new(id, KIND, Stage::Preparing)
                    });
                }
            }
            Line::Stderr(line) => tail.push(line),
        }
    }

    // The child being gone is how this learns it was cancelled, exactly as in
    // media::runner -- whoever cancelled took it.
    let Some(mut child) = jobs.take_child(id).await else {
        return Err(AppError::Cancelled);
    };
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::spawn(Tool::Ffmpeg.name(), e))?;

    if !status.success() {
        return Err(AppError::Tool {
            tool: "ffmpeg (extract audio)".to_string(),
            code: status.code(),
            tail: tail.into_string(),
        });
    }
    Ok(())
}

/// Cuts each chunk out of the extracted FLAC.
///
/// One short ffmpeg run per chunk through `process::output`, not the progress
/// path: these are seconds of work on already-decoded 16 kHz mono, and a
/// progress bar that ticks sixty-four times in two seconds is noise.
async fn split_chunks(
    app: &AppHandle,
    job: &Job,
    plan: &[ChunkSpec],
    flac: &Path,
    workdir: &Path,
    cancel: &CancelSignal,
) -> AppResult<Vec<PathBuf>> {
    if plan.len() == 1 {
        // Nothing to cut: the whole file is the request.
        return Ok(vec![flac.to_path_buf()]);
    }

    let mut paths = Vec::with_capacity(plan.len());
    for chunk in plan {
        if cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        let (start, len) = chunks::cut_window(chunk, job.duration_secs);
        let path = workdir.join(format!("chunk-{:03}.flac", chunk.index));

        let mut cmd = binaries::command(app, Tool::Ffmpeg)?;
        cmd.args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error"]);
        cmd.args([
            "-ss",
            &format!("{start:.3}"),
            "-i",
            &flac.to_string_lossy(),
            // -t, never -to: what -to means after an input seek has varied
            // between ffmpeg versions, and ops::trim avoids it for the same
            // reason.
            "-t",
            &format!("{len:.3}"),
            "-c:a",
            "flac",
            "-compression_level",
            "8",
            &path.to_string_lossy(),
        ]);

        cancel
            .guard(process::output(cmd, Tool::Ffmpeg.name()))
            .await??;
        paths.push(path);
    }
    Ok(paths)
}

async fn finish_cancelled(
    jobs: &Jobs,
    id: &str,
    emitters: &mut Emitters,
    _reason: Option<&str>,
) {
    cleanup_output(jobs, id).await;
    emitters.status(id, KIND, JobStatus::Cancelled);
}

/// A half-written transcript in the output folder is indistinguishable from a
/// finished one until it is opened.
async fn cleanup_output(jobs: &Jobs, id: &str) {
    if let Some(path) = jobs.finish(id).await {
        let _ = std::fs::remove_file(path);
    }
}

/// The last few words of a segment, as continuity context for the next chunk.
///
/// Cut on a character boundary and at a word edge: half a Persian word is both
/// a panic risk if done by bytes and a worse hint than no hint at all.
fn tail_words(text: &str, max_chars: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let tail: String = text
        .chars()
        .rev()
        .take(max_chars)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    match tail.char_indices().find(|(_, c)| c.is_whitespace()) {
        Some((at, _)) => tail[at..].trim().to_string(),
        None => tail,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_carried_context_never_splits_a_word() {
        let text = "the quick brown fox jumps over the lazy dog";
        let tail = tail_words(text, 12);
        assert!(text.ends_with(&tail), "{tail:?}");
        assert!(
            !tail.starts_with("azy") && !tail.starts_with("zy"),
            "cut mid-word: {tail:?}"
        );
    }

    #[test]
    fn a_short_segment_is_carried_whole() {
        assert_eq!(tail_words("  hello  ", 200), "hello");
    }

    /// Slicing by bytes here would panic on the first Persian transcript.
    #[test]
    fn the_carried_context_survives_non_latin_script() {
        let persian = "سلام به این جلسه خوش آمدید امروز درباره چیزی صحبت می‌کنیم";
        let tail = tail_words(persian, 10);
        assert!(persian.ends_with(tail.trim()), "{tail:?}");
        assert!(tail.chars().count() <= 10);
    }

    /// A word longer than the budget has no space to cut at; returning nothing
    /// would silently drop the continuity hint.
    #[test]
    fn a_single_long_word_is_still_carried() {
        let tail = tail_words("Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch", 10);
        assert_eq!(tail.chars().count(), 10);
    }
}
