//! The media tool commands.
//!
//! Each one probes the input, builds a plan, and hands it to the runner. They
//! all return a job id immediately; the work reports itself through events.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::error::AppResult;
use crate::jobs::{JobKind, Jobs};
use crate::media::ops::{
    self, CompressPreset, CompressRequest, ConvertRequest, ExtractAudioRequest, TrimRequest,
};
use crate::media::probe::MediaInfo;
use crate::media::runner;
use crate::paths;

#[tauri::command]
pub async fn probe_media(app: AppHandle, path: String) -> AppResult<MediaInfo> {
    crate::media::probe(&app, &PathBuf::from(path)).await
}

/// Pure estimate for the hint under the compress presets. No process, no job.
#[tauri::command]
pub async fn estimate_compressed_size(
    app: AppHandle,
    path: String,
    preset: CompressPreset,
    max_height: Option<u32>,
) -> AppResult<u64> {
    let info = crate::media::probe(&app, &PathBuf::from(path)).await?;
    Ok(ops::estimate_compressed_bytes(&info, preset, max_height))
}

/// Whether a conversion would be a plain container swap, so the UI can promise
/// "instant, no quality loss" only when that is true.
#[tauri::command]
pub async fn can_copy_streams(app: AppHandle, path: String, format: String) -> AppResult<bool> {
    let info = crate::media::probe(&app, &PathBuf::from(path)).await?;
    Ok(ops::can_stream_copy(&info, &format.to_ascii_lowercase()))
}

/// The container this file's audio can be lifted into untouched, or `None` when
/// extracting it means re-encoding. Lets the extract-audio screen offer the
/// instant, lossless option only for the files that actually have one.
#[tauri::command]
pub async fn audio_copy_format(app: AppHandle, path: String) -> AppResult<Option<String>> {
    let info = crate::media::probe(&app, &PathBuf::from(path)).await?;
    Ok(ops::copy_audio_ext(&info).map(str::to_string))
}

/// Shared shape: probe, plan, register, spawn. Written once because every tool
/// does exactly this, which is also why the five screens can look identical.
macro_rules! media_command {
    ($name:ident, $request:ty, $kind:expr, $build:path) => {
        #[tauri::command]
        pub async fn $name(
            app: AppHandle,
            jobs: State<'_, Jobs>,
            request: $request,
        ) -> AppResult<String> {
            let input = PathBuf::from(&request.input);
            let info = crate::media::probe(&app, &input).await?;
            // Built before the job is registered so an invalid request fails
            // here, with a real message, instead of appearing as a job that
            // dies a moment later.
            let plan = $build(&request, &info)?;

            let id = crate::jobs::new_id();
            let title = plan
                .output
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| paths::stem_of(&input));
            jobs.register(id.clone(), $kind, title).await;

            let handle = app.clone();
            let job_id = id.clone();
            tauri::async_runtime::spawn(async move {
                let jobs = handle.state::<Jobs>();
                let _ = runner::run(handle.clone(), &jobs, job_id, $kind, plan).await;
            });

            Ok(id)
        }
    };
}

media_command!(start_compress, CompressRequest, JobKind::Compress, ops::compress);
media_command!(start_trim, TrimRequest, JobKind::Trim, ops::trim);
media_command!(start_convert, ConvertRequest, JobKind::Convert, ops::convert);
media_command!(
    start_extract_audio,
    ExtractAudioRequest,
    JobKind::ExtractAudio,
    ops::extract_audio
);
