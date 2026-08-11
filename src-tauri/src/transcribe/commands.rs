//! The transcribe commands.
//!
//! `start_transcribe` follows the same shape the `media_command!` macro
//! enforces for the ffmpeg tools -- validate everything that can fail with a
//! real message *before* registering the job, then return an id immediately --
//! but it cannot use the macro, which builds an ffmpeg `Plan`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::chunks;
use super::groq::{self, Model};
use super::runner;
use super::subtitles::OutputFormat;
use crate::error::{AppError, AppResult};
use crate::jobs::{JobKind, Jobs};
use crate::paths;
use crate::settings;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    pub input: String,
    pub output_dir: String,
    pub output_name: Option<String>,
    pub model: Model,
    /// ISO-639-1, or `None` for auto-detect. Ignored when translating.
    pub language: Option<String>,
    /// Use the translations endpoint, which always writes English.
    #[serde(default)]
    pub translate: bool,
    pub format: OutputFormat,
    /// Names and spellings to get right.
    pub prompt: Option<String>,
}

#[tauri::command]
pub async fn start_transcribe(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request: TranscribeRequest,
) -> AppResult<String> {
    let input = paths::require_file(&request.input)?;
    let output_dir = paths::ensure_dir(&request.output_dir)?;

    // Ordered so the cheapest and most actionable failure comes first: being
    // told "add your key in Settings" beats waiting through a probe to hear it.
    let key = settings::groq_key(&app)?;

    if request.translate && !request.model.can_translate() {
        // The UI keeps these two consistent, but a request could still arrive,
        // and the endpoint's own error for this is unhelpful.
        return Err(AppError::invalid(
            "model",
            "only whisper-large-v3 can translate",
        ));
    }

    let info = crate::media::probe(&app, &input).await?;
    if !info.has_audio() {
        return Err(AppError::invalid("input", "this file has no audio"));
    }

    // Nothing here checks a budget. The app keeps no count of what has been
    // spent -- see the note in `mod` -- so a run is always attempted and Groq's
    // 429 is what stops it, with a message saying which limit was hit.
    //
    // Fails here rather than as a job that dies a moment later.
    chunks::chunk_plan(info.duration_secs, chunk_size_hint(&info))?;

    let id = crate::jobs::new_id();
    let stem = request
        .output_name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| paths::stem_of(&input));
    let title = format!("{stem}.{}", request.format.extension());
    jobs.register(id.clone(), JobKind::Transcribe, title).await;

    let job = runner::Job {
        input,
        output_dir,
        output_name: request.output_name,
        duration_secs: info.duration_secs,
        model: request.model,
        language: request.language.filter(|l| !l.trim().is_empty()),
        translate: request.translate,
        prompt: request.prompt,
        format: request.format,
        key,
    };

    let handle = app.clone();
    let job_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let jobs = handle.state::<Jobs>();
        let _ = runner::run(handle.clone(), &jobs, job_id, job).await;
    });

    Ok(id)
}

/// A stand-in for the FLAC's real size, which does not exist yet.
///
/// Only used so a file that is obviously too long is refused before a job is
/// registered. The runner re-plans against the file it actually produced, which
/// is the number that decides the requests.
fn chunk_size_hint(info: &crate::media::probe::MediaInfo) -> u64 {
    (info.duration_secs * 13_000.0) as u64
}

// ------------------------------------------------------------- the API key

#[tauri::command]
pub fn api_key_status(app: AppHandle) -> settings::ApiKeyStatus {
    settings::status(&app)
}

#[tauri::command]
pub fn set_api_key(app: AppHandle, key: String) -> AppResult<()> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err(AppError::invalid("apiKey", "the key is empty"));
    }
    // Whitespace inside a key is always a copy-paste accident -- a wrapped line
    // or a stray quote -- and it produces a 401 that reads as "your key is
    // wrong" rather than "your key got mangled".
    if key.split_whitespace().count() > 1 {
        return Err(AppError::invalid("apiKey", "the key contains spaces"));
    }

    let mut current = settings::load(&app);
    current.groq_api_key = Some(key);
    settings::save(&app, &current)
}

#[tauri::command]
pub fn clear_api_key(app: AppHandle) -> AppResult<()> {
    let mut current = settings::load(&app);
    current.groq_api_key = None;
    settings::save(&app, &current)
}

/// Checks the key that is actually stored, rather than one passed in.
///
/// Deliberate: what can be wrong is the saved key, and testing anything else
/// would answer a question nobody asked.
#[tauri::command]
pub async fn test_api_key(app: AppHandle) -> AppResult<()> {
    let key = settings::groq_key(&app)?;
    groq::verify_key(&key).await
}

// ------------------------------------------------------------- the result

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptText {
    pub text: String,
    pub truncated: bool,
}

/// A three-hour transcript is roughly 150 KB of text, and its SRT about 400 KB.
/// Half a megabyte shows every realistic result in full while stopping a
/// mistargeted path from dragging a video file across the IPC bridge.
const MAX_TRANSCRIPT_BYTES: u64 = 512 * 1024;

/// Reads a finished transcript back for display.
///
/// Deliberately narrow rather than a general file read. The webview names the
/// path, so this checks the extension and the size first: a generic `read_file`
/// command would be an arbitrary-read primitive for anything that can run
/// script in the window, and the app ships with no CSP.
#[tauri::command]
pub async fn read_transcript(path: String) -> AppResult<TranscriptText> {
    let path = PathBuf::from(path);
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(extension.as_str(), "txt" | "srt" | "vtt") {
        return Err(AppError::invalid("path", "not a transcript file"));
    }

    let size = tokio::fs::metadata(&path)
        .await
        .map_err(|e| AppError::io(&path, e))?
        .len();

    let raw = tokio::fs::read(&path)
        .await
        .map_err(|e| AppError::io(&path, e))?;
    // Lossy rather than a failure: a transcript that is 99% readable is worth
    // showing, and this is a display path, not a data path -- the file on disk
    // is untouched.
    let text = String::from_utf8_lossy(&raw).into_owned();

    if size <= MAX_TRANSCRIPT_BYTES {
        return Ok(TranscriptText {
            text,
            truncated: false,
        });
    }

    // On a character boundary, never a byte one: slicing Persian or Arabic text
    // by bytes panics.
    let keep = text
        .char_indices()
        .take_while(|(at, _)| *at < MAX_TRANSCRIPT_BYTES as usize)
        .count();
    Ok(TranscriptText {
        text: text.chars().take(keep).collect(),
        truncated: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_request_deserializes_from_what_the_screen_sends() {
        let raw = r#"{
            "input": "/tmp/a.mp4",
            "outputDir": "/tmp",
            "outputName": "a",
            "model": "whisperLargeV3Turbo",
            "language": "fa",
            "translate": false,
            "format": "srt",
            "prompt": null
        }"#;
        let request: TranscribeRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(request.model, Model::Turbo);
        assert_eq!(request.format, OutputFormat::Srt);
        assert_eq!(request.language.as_deref(), Some("fa"));
    }

    /// `translate` and `prompt` are optional on the wire; a screen that has not
    /// opened its advanced section sends neither.
    #[test]
    fn optional_fields_may_be_omitted_entirely() {
        let raw = r#"{
            "input": "/tmp/a.mp4",
            "outputDir": "/tmp",
            "model": "whisperLargeV3",
            "format": "txt"
        }"#;
        let request: TranscribeRequest = serde_json::from_str(raw).unwrap();
        assert!(!request.translate);
        assert!(request.prompt.is_none());
        assert!(request.output_name.is_none());
    }

}
