mod binaries;
mod commands;
mod direct;
mod download;
mod error;
mod filetype;
mod jobs;
mod library;
mod media;
mod muxed;
mod network;
mod paths;
mod process;
mod ratelimit;
mod settings;
mod tray;
mod updater;

use jobs::Jobs;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, as the plugin asks: a second launch has to be turned away
        // before anything else starts. It brings the running window forward
        // instead -- restored if it was minimised -- which is what someone
        // double-clicking the icon again is actually asking for.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Jobs::default())
        .setup(|app| {
            // The library is created here rather than on the first save, so
            // "your files go to ~/Downloads/MediaToolkit" is true from the
            // moment the app is installed and the folder is there to be found.
            library::ensure_layout(app.handle());

            // The proxy, the speed limit and the download slots, in force
            // before the first download asks for any of them.
            network::init(app.handle());

            // The tray icon, and whether closing the window hides it there.
            tray::init(app.handle());

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
            network::get_network_settings,
            network::set_network_settings,
            network::test_proxy,
            tray::get_tray_settings,
            tray::set_close_to_tray,
            tray::set_tray_labels,
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
            // The close button hides the window into the tray instead, when
            // there is a tray to bring it back from. Every route to "close" --
            // the title bar, Alt+F4, the taskbar -- arrives here.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && tray::hide_on_close() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Without this, quitting leaves yt-dlp and ffmpeg running as
            // orphans, still writing to half-finished files. It is the exit
            // that is watched rather than the window being destroyed: quitting
            // from the tray ends the app while its window is merely hidden.
            if let tauri::RunEvent::Exit = event {
                let jobs = app.state::<Jobs>();
                tauri::async_runtime::block_on(async {
                    jobs.cancel_all().await;
                    // Long enough for a cancelled job to delete its truncated
                    // output and record its progress, short enough that
                    // quitting never feels stuck.
                    jobs.wait_idle(std::time::Duration::from_secs(3)).await;
                });
            }
        });
}
