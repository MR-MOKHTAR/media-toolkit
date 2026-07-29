mod binaries;
mod commands;
mod download;
mod error;
mod jobs;
mod media;
mod paths;
mod process;

use jobs::Jobs;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Jobs::default())
        .invoke_handler(tauri::generate_handler![
            commands::tool_status,
            commands::get_default_download_path,
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
            media::commands::start_compress,
            media::commands::start_trim,
            media::commands::start_convert,
            media::commands::start_resize,
            media::commands::start_gif,
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
