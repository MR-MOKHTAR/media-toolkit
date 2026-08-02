//! Updating the bundled yt-dlp from inside the app.
//!
//! yt-dlp breaks against YouTube every few weeks. Pointing the build at the
//! nightly channel fixes that for *new* installs, but someone who installed in
//! March keeps whatever shipped in March, and for an app whose whole job is
//! downloading, a stale extractor is an outage rather than a missing feature.
//!
//! The new binary goes into the app data dir, which `binaries::locate` searches
//! before the bundled resources. That indirection is the point: on Windows the
//! install lives under Program Files, so overwriting the bundled copy needs
//! admin rights and `yt-dlp --update` cannot work at all.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::binaries::{self, Tool};
use crate::error::{AppError, AppResult};

/// The nightly channel, matching what `tools.lock.json` bundles. Kept here as
/// well as there because the lock file is a build-time input and is not shipped.
const NIGHTLY: &str = "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    /// What it reported before, when it ran at all.
    pub previous: Option<String>,
    pub current: String,
    /// False when the download turned out to be the version already installed.
    pub changed: bool,
}

/// The standalone build for this platform.
///
/// Standalone, not the small zipapp: the zipapp needs a system Python, which
/// most Windows machines do not have.
fn asset_name() -> AppResult<&'static str> {
    let name = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", _) => "yt-dlp.exe",
        ("linux", "aarch64") => "yt-dlp_linux_aarch64",
        ("linux", _) => "yt-dlp_linux",
        ("macos", _) => "yt-dlp_macos",
        (os, arch) => {
            return Err(AppError::invalid(
                "platform",
                &format!("no yt-dlp build for {os}-{arch}"),
            ))
        }
    };
    Ok(name)
}

pub async fn update_ytdlp(app: &AppHandle) -> AppResult<UpdateResult> {
    let previous = binaries::probe(app, Tool::YtDlp).await;
    let dir = binaries::writable_bin_dir(app)?;
    let final_path = dir.join(if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" });
    let staged = dir.join(".yt-dlp.download");

    let url = format!("{NIGHTLY}/{}", asset_name()?);
    download(&url, &staged).await.map_err(|error| {
        let _ = std::fs::remove_file(&staged);
        error
    })?;

    make_executable(&staged)?;

    // Verify before committing. Replacing a working downloader with a truncated
    // or HTML-error-page "binary" would break the app until the user reinstalls,
    // which is a far worse outcome than a failed update.
    let current = probe_version(&staged).ok_or_else(|| {
        let _ = std::fs::remove_file(&staged);
        AppError::invalid("download", "the downloaded file did not run")
    })?;

    std::fs::rename(&staged, &final_path).map_err(|e| AppError::io(&final_path, e))?;

    // Otherwise the cached path keeps pointing at the bundled copy and the
    // update silently appears to have done nothing.
    binaries::invalidate(Tool::YtDlp);

    Ok(UpdateResult {
        changed: previous.as_deref() != Some(current.as_str()),
        previous,
        current,
    })
}

async fn download(url: &str, dest: &Path) -> AppResult<()> {
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .user_agent("media-toolkit")
        .build()
        .and_then(|client| Ok(client.get(url)))
        .map_err(|e| AppError::spawn("updater", e))?
        .send()
        .await
        .map_err(|e| AppError::spawn("updater", e))?;

    let response = response
        .error_for_status()
        .map_err(|e| AppError::spawn("updater", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::spawn("updater", e))?;

    // A few hundred bytes means a proxy error page, not a downloader.
    if bytes.len() < 1024 * 1024 {
        return Err(AppError::invalid(
            "download",
            &format!("expected several MB, got {} bytes", bytes.len()),
        ));
    }

    std::fs::write(dest, &bytes).map_err(|e| AppError::io(dest, e))?;
    Ok(())
}

/// Runs the staged file directly, before it is in the search path.
fn probe_version(path: &PathBuf) -> Option<String> {
    let mut cmd = std::process::Command::new(path);
    cmd.arg("--version");
    binaries::hide_console(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
}

fn make_executable(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| AppError::io(path, e))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
