//! The IPC surface.
//!
//! Every job command returns a `JobId` immediately rather than awaiting the
//! work. Progress and the terminal outcome arrive on the `job-progress` and
//! `job-status` events. The old `download_media` awaited completion, which is
//! what made a second concurrent download impossible to express.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, State};

use crate::binaries::{self, Tool};
use crate::download::{self, DownloadRequest, UrlInfo};
use crate::error::{AppError, AppResult};
use crate::jobs::{JobKind, JobSummary, Jobs};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub ytdlp: bool,
    pub ffmpeg: bool,
    pub ffprobe: bool,
    /// The JavaScript runtime yt-dlp needs for YouTube. Reported like the
    /// others because its absence is not silent -- it costs formats -- and
    /// "some of your downloads came back at a lower quality" is not something
    /// anyone would think to look for without a row saying so.
    pub deno: bool,
    /// Shown in Settings next to the update button, so "is it current?" is a
    /// question the user can answer without leaving the app.
    pub ytdlp_version: Option<String>,
}

/// Answering this means running yt-dlp, which is a PyInstaller bundle that
/// unpacks itself and boots CPython on every launch -- about two seconds, and
/// the Download and Settings screens both ask on mount. Since the answer only
/// changes when the updater replaces a binary, it is computed once per session
/// and cleared from `update_ytdlp`.
///
/// The lock is held across the measurement on purpose: two screens mounting at
/// once should not both spawn yt-dlp, the second should wait for the first.
fn status_cache() -> &'static tokio::sync::Mutex<Option<ToolStatus>> {
    static CACHE: OnceLock<tokio::sync::Mutex<Option<ToolStatus>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// `async` is load-bearing, not decoration. A plain `fn` command runs inline in
/// the IPC handler on the main thread, so the four seconds this used to take
/// froze the entire window, not just the request -- which is what made clicking
/// Download or Settings feel like the app had hung.
#[tauri::command]
pub async fn tool_status(app: AppHandle) -> ToolStatus {
    let mut cached = status_cache().lock().await;
    if let Some(status) = cached.as_ref() {
        return status.clone();
    }
    let status = measure_tools(&app).await;
    *cached = Some(status.clone());
    status
}

/// Fills the cache from the app's `setup` hook, so the first navigation to
/// Download or Settings finds the answer already waiting.
pub async fn warm_tool_status(app: &AppHandle) {
    let mut cached = status_cache().lock().await;
    if cached.is_none() {
        *cached = Some(measure_tools(app).await);
    }
}

async fn measure_tools(app: &AppHandle) -> ToolStatus {
    let (ytdlp_version, ffmpeg, ffprobe, deno) = tokio::join!(
        binaries::probe(app, Tool::YtDlp),
        binaries::probe(app, Tool::Ffmpeg),
        binaries::probe(app, Tool::Ffprobe),
        binaries::probe(app, Tool::Deno),
    );

    ToolStatus {
        // Availability *is* "it ran and told us its version". A separate
        // existence check is what previously let a broken ffmpeg linkage
        // report as ready and then fail inside every single job.
        ytdlp: ytdlp_version.is_some(),
        ffmpeg: ffmpeg.is_some(),
        ffprobe: ffprobe.is_some(),
        deno: deno.is_some(),
        ytdlp_version,
    }
}

/// Downloads a current yt-dlp into the app data dir, ahead of the bundled copy.
#[tauri::command]
pub async fn update_ytdlp(app: AppHandle) -> AppResult<crate::updater::UpdateResult> {
    let result = crate::updater::update_ytdlp(&app).await?;
    // The cache names the version we just replaced. Leaving it would make
    // Settings report the old one until restart, so the update would look like
    // it had done nothing.
    *status_cache().lock().await = None;
    Ok(result)
}

#[tauri::command]
pub async fn probe_url(app: AppHandle, url: String) -> AppResult<UrlInfo> {
    download::probe_url(&app, &url).await
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request: DownloadRequest,
) -> AppResult<String> {
    let id = crate::jobs::new_id();
    let title = request
        .output_name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| request.url.clone());

    jobs.register(id.clone(), JobKind::Download, title).await;

    // Detached: the command returns the id now and the work reports itself
    // through events. `Jobs` lives in Tauri's managed state for the life of the
    // app, so the task can safely outlive this call.
    let handle = app.clone();
    let job_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let jobs = handle.state::<Jobs>();
        let _ = download::run(handle.clone(), &jobs, job_id, request).await;
    });

    Ok(id)
}

#[tauri::command]
pub async fn cancel_job(jobs: State<'_, Jobs>, id: String) -> AppResult<()> {
    jobs.cancel(&id).await
}

#[tauri::command]
pub async fn cancel_all_jobs(jobs: State<'_, Jobs>) -> AppResult<()> {
    jobs.cancel_all().await;
    Ok(())
}

#[tauri::command]
pub async fn list_jobs(jobs: State<'_, Jobs>) -> AppResult<Vec<JobSummary>> {
    Ok(jobs.list().await)
}

#[tauri::command]
pub async fn open_path(path: String) -> AppResult<()> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(AppError::invalid("path", "does not exist"));
    }
    run_detached(opener_command(&target))
}

/// Opens the containing folder with the file selected.
///
/// The per-platform implementation belongs to tauri-plugin-opener, which this
/// app already depends on and registers. Doing it by hand here is what caused
/// the "first click does nothing" bug: we shelled out to `dbus-send` without
/// `--print-reply`, which fires the message and exits immediately. With no file
/// manager running, D-Bus starts activating one, our sender is already gone,
/// and the ShowItems message is dropped -- so the first click only warmed up
/// the file manager and the second one was the one that worked. That same flag
/// also meant `dbus-send` always exited 0, even against a destination that does
/// not exist, so the xdg-open fallback below it was unreachable.
///
/// The plugin makes a real zbus call that waits for the reply, falls back to
/// the XDG desktop portal (which matters under Flatpak, where we had nothing),
/// and carries the Windows and macOS paths too.
///
/// When the file itself is gone -- renamed, moved, or deleted since the job
/// finished -- this opens the folder it was written to rather than failing.
/// "Show me where this went" is still answerable, and refusing outright reads
/// as a dead button.
#[tauri::command]
pub async fn reveal_in_folder(path: String) -> AppResult<()> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        let parent = target
            .parent()
            .filter(|parent| parent.is_dir())
            .ok_or_else(|| AppError::invalid("path", "neither the file nor its folder exists"))?;
        return run_detached(opener_command(parent));
    }

    // The plugin's proxy is blocking, and waiting for a cold file manager to
    // activate measured at 0.76s. This is an async command, so that has to
    // happen off the runtime's worker threads.
    tauri::async_runtime::spawn_blocking(move || {
        tauri_plugin_opener::reveal_item_in_dir(&target)
            .map_err(|error| AppError::spawn("file manager", error))
    })
    .await
    .map_err(|error| AppError::spawn("file manager", error))?
}

fn opener_command(path: &Path) -> Command {
    let mut cmd = if cfg!(target_os = "macos") {
        Command::new("open")
    } else if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", ""]);
        cmd
    } else {
        Command::new("xdg-open")
    };
    cmd.arg(path);
    binaries::hide_console(&mut cmd);
    cmd
}

/// Launches and forgets. Waiting on a file manager would block until the user
/// closes it.
fn run_detached(mut cmd: Command) -> AppResult<()> {
    cmd.spawn()
        .map(|_| ())
        .map_err(|error| AppError::spawn("file manager", error))
}
