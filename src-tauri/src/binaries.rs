//! Locating and launching the bundled tools.
//!
//! Resolution order is app data dir, then the bundled resources, then PATH.
//! App data comes first so the in-app updater can drop a fresher yt-dlp
//! somewhere writable: on Windows the install lives under Program Files, so
//! neither `yt-dlp --update` nor overwriting the bundled copy can work there.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    YtDlp,
    Ffmpeg,
    Ffprobe,
}

impl Tool {
    pub fn name(self) -> &'static str {
        match self {
            Self::YtDlp => "yt-dlp",
            Self::Ffmpeg => "ffmpeg",
            Self::Ffprobe => "ffprobe",
        }
    }

    fn file_name(self) -> String {
        if cfg!(windows) {
            format!("{}.exe", self.name())
        } else {
            self.name().to_string()
        }
    }
}

/// Where a tool was found, plus the directory it was found in. The directory
/// matters for ffmpeg: the shared build needs its libraries on the search path.
#[derive(Debug, Clone)]
pub struct Resolved {
    pub path: PathBuf,
    dir: Option<PathBuf>,
}

/// Resolution is stable for the life of the process and each miss costs a
/// `--version` spawn, so it is cached. Tool screens probe on every file
/// selection and would otherwise re-resolve constantly.
fn cache() -> &'static std::sync::Mutex<std::collections::HashMap<&'static str, Option<Resolved>>> {
    static CACHE: OnceLock<std::sync::Mutex<std::collections::HashMap<&'static str, Option<Resolved>>>> =
        OnceLock::new();
    CACHE.get_or_init(Default::default)
}

pub fn resolve(app: &AppHandle, tool: Tool) -> AppResult<Resolved> {
    if let Some(hit) = cache().lock().unwrap().get(tool.name()).cloned() {
        return hit.ok_or_else(|| AppError::tool_missing(tool.name()));
    }
    let found = locate(app, tool);
    cache().lock().unwrap().insert(tool.name(), found.clone());
    found.ok_or_else(|| AppError::tool_missing(tool.name()))
}

pub fn is_available(app: &AppHandle, tool: Tool) -> bool {
    resolve(app, tool).is_ok()
}

/// Drops the cache so a freshly downloaded tool is picked up without a restart.
pub fn forget_cached() {
    cache().lock().unwrap().clear();
}

fn locate(app: &AppHandle, tool: Tool) -> Option<Resolved> {
    let file = tool.file_name();

    let mut roots = Vec::new();
    if let Ok(data) = app.path().app_data_dir() {
        roots.push(data.join("bin"));
    }
    if let Ok(resources) = app.path().resource_dir() {
        roots.push(resources.join("binaries"));
    }

    for root in roots {
        let candidate = root.join(&file);
        if candidate.is_file() {
            ensure_executable(&candidate);
            return Some(Resolved {
                path: candidate,
                dir: Some(root),
            });
        }
    }

    // Last resort: a system install. Handy in dev, where the app runs straight
    // out of target/ and the resource dir does not exist yet.
    let mut probe = Command::new(&file);
    probe.arg("-version");
    hide_console(&mut probe);
    let works = probe
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);

    works.then(|| Resolved {
        path: PathBuf::from(&file),
        dir: None,
    })
}

/// Builds a command for `tool` with the environment it needs to actually run.
pub fn command(app: &AppHandle, tool: Tool) -> AppResult<Command> {
    let resolved = resolve(app, tool)?;
    let mut cmd = Command::new(&resolved.path);
    hide_console(&mut cmd);

    // The shared ffmpeg build we bundle has a malformed RPATH -- BtbN's build
    // emits the literal "-Wl:../lib", so the linker flag prefix leaked into the
    // value and the loader ignores it. Without this the binary dies with
    // "error while loading shared libraries: libavdevice.so.62".
    //
    // Only Linux needs it. Windows finds DLLs in the executable's own
    // directory, and the macOS builds we bundle are standalone.
    #[cfg(target_os = "linux")]
    if matches!(tool, Tool::Ffmpeg | Tool::Ffprobe) {
        if let Some(dir) = &resolved.dir {
            let lib = dir.join("lib");
            if lib.is_dir() {
                let value = match std::env::var_os("LD_LIBRARY_PATH") {
                    Some(existing) => {
                        let mut paths = vec![lib];
                        paths.extend(std::env::split_paths(&existing));
                        std::env::join_paths(paths)
                            .map_err(|e| AppError::spawn(tool.name(), e))?
                    }
                    None => lib.into_os_string(),
                };
                cmd.env("LD_LIBRARY_PATH", value);
            }
        }
    }

    Ok(cmd)
}

/// Unix only. A resource unpacked by an installer can land without the execute
/// bit; a failure here is ignored on purpose, because a read-only or
/// root-owned install should surface as a spawn error rather than being
/// reported as a permissions problem we cannot fix.
fn ensure_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(path) {
            let mode = metadata.permissions().mode();
            if mode & 0o111 == 0 {
                let _ = std::fs::set_permissions(
                    path,
                    std::fs::Permissions::from_mode(mode | 0o111),
                );
            }
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Stops a console window flashing up behind every spawn on Windows.
pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}
