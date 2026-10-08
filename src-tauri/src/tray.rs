//! The system tray icon, and closing the window into it.
//!
//! A download manager is something you start and then stop looking at. With a
//! close button that quits, closing the window to get it out of the way also
//! cancelled everything it was doing; with a tray icon, closing the window only
//! hides it, the jobs keep running, and the icon brings it back or ends the
//! app on purpose.
//!
//! Hiding is a setting (`closeToTray`, on by default) and is also conditional on
//! there being an icon to get the window back from: where the tray could not be
//! created -- a Linux desktop with no status-notifier host and no
//! libayatana-appindicator -- the close button quits, as it always did. A
//! window that disappears with nothing on screen to restore it is worse than
//! one that closes.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::error::{AppError, AppResult};
use crate::settings;

const SHOW_ID: &str = "show";
const QUIT_ID: &str = "quit";

/// Whether the close button hides the window. Held in memory because the
/// window event handler asks on every close request.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

/// Whether a tray icon exists to restore the window from.
static TRAY_READY: AtomicBool = AtomicBool::new(false);

/// What the app keeps hold of: the icon itself, and the two menu entries whose
/// text follows the interface language. Menu text lives in Rust and the
/// language lives in the webview, so the webview pushes it -- see `set_labels`.
struct Tray {
    _icon: TrayIcon,
    show: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// Creates the icon and loads the saved close behaviour. Called once, at
/// startup. A failure to build the tray is logged and survived: see the module
/// comment.
pub fn init(app: &AppHandle) {
    CLOSE_TO_TRAY.store(settings::load(app).close_to_tray, Ordering::Relaxed);

    match build(app) {
        Ok(tray) => {
            app.manage(tray);
            TRAY_READY.store(true, Ordering::Relaxed);
        }
        Err(error) => eprintln!("tray icon unavailable, closing the window will quit: {error}"),
    }
}

fn build(app: &AppHandle) -> tauri::Result<Tray> {
    // English until the webview sends the real words a moment later.
    let show = MenuItem::with_id(app, SHOW_ID, "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Media Toolkit")
        .menu(&menu)
        // Left click restores the window (below); the menu is the right click.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_ID => show_main_window(app),
            // Ends the app for real. Running jobs are cancelled on the way out
            // by the exit handler in `lib.rs`.
            QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    Ok(Tray {
        _icon: builder.build(app)?,
        show,
        quit,
    })
}

/// Brings the main window back from the tray, or from behind other windows.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Whether a close request should hide the window instead of closing it.
pub fn hide_on_close() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed) && TRAY_READY.load(Ordering::Relaxed)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraySettings {
    pub close_to_tray: bool,
    /// False when there is no icon, so the switch can say it does nothing here
    /// rather than appear to work.
    pub available: bool,
}

#[tauri::command]
pub fn get_tray_settings() -> TraySettings {
    TraySettings {
        close_to_tray: CLOSE_TO_TRAY.load(Ordering::Relaxed),
        available: TRAY_READY.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, enabled: bool) -> AppResult<TraySettings> {
    let mut saved = settings::load(&app);
    saved.close_to_tray = enabled;
    settings::save(&app, &saved)?;
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
    Ok(get_tray_settings())
}

/// Puts the menu entries into the interface language. Called by the webview at
/// startup and whenever the language changes.
#[tauri::command]
pub fn set_tray_labels(app: AppHandle, show: String, quit: String) -> AppResult<()> {
    let Some(tray) = app.try_state::<Tray>() else {
        return Ok(());
    };
    tray.show
        .set_text(show)
        .and_then(|_| tray.quit.set_text(quit))
        .map_err(|e| AppError::invalid("tray", e.to_string()))
}
