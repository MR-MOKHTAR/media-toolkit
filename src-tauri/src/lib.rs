mod binaries;
mod commands;
mod direct;
mod download;
mod error;
mod jobs;
mod library;
mod media;
mod muxed;
mod paths;
mod process;
mod settings;
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
            commands::list_playlist,
            commands::cookie_browsers,
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
