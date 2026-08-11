mod binaries;
mod commands;
mod direct;
mod download;
mod error;
mod jobs;
mod library;
mod media;
mod paths;
mod process;
mod settings;
mod transcribe;
mod updater;

use jobs::Jobs;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Jobs::default())
        .setup(|app| {
            // A transcription killed by a SIGKILL or a power cut leaves its
            // chunk directory behind, and those are large. Nothing else ever
            // cleans them up, so a stale sweep at startup is the only thing
            // between a working install and a slowly filling /tmp.
            sweep_stale_workdirs();

            // The library is created here rather than on the first save, so
            // "your files go to ~/Downloads/Media Toolkit" is true from the
            // moment the app is installed and the folder is there to be found.
            library::ensure_layout(app.handle());

            // Checking the tools means running them, and yt-dlp takes about two
            // seconds to unpack itself. Do it here, in the background, while the
            // user is still looking at the home screen -- by the time they open
            // Download or Settings the answer is cached and the screen is
            // instant. Failures need no handling: the result is just "not
            // available", which those screens already report.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                commands::warm_tool_status(&handle).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tool_status,
            commands::update_ytdlp,
            library::library_info,
            library::library_folder,
            library::set_library_root,
            library::reset_library_root,
            library::set_library_organize,
            library::set_save_next_to_input,
            commands::probe_url,
            commands::start_download,
            commands::cancel_job,
            commands::cancel_all_jobs,
            commands::list_jobs,
            commands::open_path,
            commands::reveal_in_folder,
            media::commands::probe_media,
            media::commands::estimate_compressed_size,
            media::commands::can_copy_streams,
            media::commands::audio_copy_format,
            media::commands::start_compress,
            media::commands::start_trim,
            media::commands::start_convert,
            media::commands::start_extract_audio,
            transcribe::commands::start_transcribe,
            transcribe::commands::read_transcript,
            transcribe::commands::api_key_status,
            transcribe::commands::set_api_key,
            transcribe::commands::clear_api_key,
            transcribe::commands::test_api_key,
        ])
        .on_window_event(|window, event| {
            // Without this, killing the window leaves yt-dlp and ffmpeg running
            // as orphans, still writing to half-finished files.
            if let tauri::WindowEvent::Destroyed = event {
                let jobs = window.state::<Jobs>();
                tauri::async_runtime::block_on(jobs.cancel_all());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Removes transcription chunk directories left behind by a previous run.
///
/// Only ones over a day old, so a second window -- or a job still running in
/// another instance -- cannot have its working files pulled out from under it.
fn sweep_stale_workdirs() {
    const MAX_AGE: std::time::Duration = std::time::Duration::from_secs(86_400);

    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if !name.to_string_lossy().starts_with("mt-transcribe-") {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .and_then(|at| at.elapsed().map_err(std::io::Error::other))
            .map(|age| age > MAX_AGE)
            .unwrap_or(false);
        if stale {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}
