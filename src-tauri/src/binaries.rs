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

    /// The flag that makes the tool print its version and exit zero.
    ///
    /// These genuinely differ and getting it wrong is silent: ffmpeg wants the
    /// single-dash `-version`, while yt-dlp's parser reads that as the short
    /// flags `-v -e -r sion` and exits 2 with `invalid rate limit "sion"`. Used
    /// for the health check, so a wrong flag reports a working tool as missing.
    fn version_arg(self) -> &'static str {
        match self {
            Self::YtDlp => "--version",
            Self::Ffmpeg | Self::Ffprobe => "-version",
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

/// Runs the tool, rather than checking that its file exists.
///
/// Existence is not availability. The shared ffmpeg build we bundle needs its
/// libraries on the search path, and when that broke, `resolve` still said yes
/// while every single job failed with a dynamic-loader error. Spawning
/// `-version` through `command()` exercises the same environment a real job
/// gets, so a linkage problem shows up once, as "unavailable", instead of
/// separately inside every operation.
pub fn is_available(app: &AppHandle, tool: Tool) -> bool {
    let Ok(mut cmd) = command(app, tool) else {
        return false;
    };
    cmd.arg(tool.version_arg());
    cmd.output().map(|out| out.status.success()).unwrap_or(false)
}

/// The tool's own reported version, or None if it will not run.
pub fn version(app: &AppHandle, tool: Tool) -> Option<String> {
    let mut cmd = command(app, tool).ok()?;
    cmd.arg(tool.version_arg());
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    // ffmpeg prints a whole banner; yt-dlp prints just the version. Either way
    // the first line is the useful one.
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
}

/// Forgets where a tool lives, so the next resolve looks again.
///
/// The updater writes a newer yt-dlp into the app data dir, which sits ahead of
/// the bundled copy in the search order. Without this the cached path keeps
/// pointing at the old binary for the rest of the session and the update looks
/// like it did nothing.
pub fn invalidate(tool: Tool) {
    cache().lock().unwrap().remove(tool.name());
}

/// Where the updater installs to: ahead of the bundled copy, and writable.
///
/// On Windows the install lives under Program Files, so replacing the bundled
/// binary needs admin rights and `yt-dlp --update` cannot work at all.
pub fn writable_bin_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::io(Path::new("app data dir"), e))?
        .join("bin");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::io(&dir, e))?;
    Ok(dir)
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
    probe.arg(tool.version_arg());
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
    //
    // yt-dlp is in this list even though it needs no libraries itself: it
    // spawns our bundled ffmpeg (see --ffmpeg-location) to merge separate
    // video and audio streams and to transcode audio downloads to MP3. That
    // child inherits this environment, and without it every merge and every
    // audio download fails at the last step -- which is the normal YouTube
    // path, not an edge case.
    #[cfg(target_os = "linux")]
    if matches!(tool, Tool::Ffmpeg | Tool::Ffprobe | Tool::YtDlp) {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs each bundled tool with the flag `is_available` uses.
    ///
    /// This is a spawn rather than an assertion about strings, because the bug
    /// it guards was exactly a string that looked right: `-version` works for
    /// ffmpeg, but yt-dlp's parser reads it as `-v -e -r sion` and exits 2, so
    /// the health check declared a perfectly good yt-dlp missing. Only a real
    /// exec catches that.
    ///
    /// Skips any tool that is not provisioned, so a checkout without
    /// `binaries/` still passes.
    #[test]
    fn every_tool_reports_its_version() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");

        for tool in [Tool::YtDlp, Tool::Ffmpeg, Tool::Ffprobe] {
            let path = dir.join(tool.file_name());
            if !path.is_file() {
                eprintln!("skipping {}: not provisioned", tool.name());
                continue;
            }

            let mut cmd = Command::new(&path);
            cmd.arg(tool.version_arg());
            // The shared ffmpeg build cannot find its libraries on its own; see
            // the RPATH note in `command`.
            let lib = dir.join("lib");
            if lib.is_dir() {
                cmd.env("LD_LIBRARY_PATH", &lib);
            }

            let output = cmd
                .output()
                .unwrap_or_else(|e| panic!("{} failed to spawn: {e}", tool.name()));

            assert!(
                output.status.success(),
                "{} {} exited {:?}\nstderr: {}",
                tool.name(),
                tool.version_arg(),
                output.status.code(),
                String::from_utf8_lossy(&output.stderr).trim(),
            );
        }
    }
}
