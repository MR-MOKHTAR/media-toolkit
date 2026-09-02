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
        executable_name(self.name())
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

fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// The JavaScript engines yt-dlp can run YouTube's player challenge in, in
/// yt-dlp's own order of preference.
///
/// Only `deno` is enabled by default, so anything else has to be named on the
/// command line before yt-dlp will look for it -- which is the whole reason
/// this list exists rather than a bare `deno` lookup.
const JS_RUNTIMES: &[&str] = &["deno", "node", "bun", "quickjs"];

/// A JavaScript runtime found on this machine.
#[derive(Debug, Clone)]
pub struct JsRuntime {
    /// The name yt-dlp knows it by: `deno`, `node`, `bun` or `quickjs`.
    pub name: &'static str,
    path: PathBuf,
}

/// Whichever JavaScript runtime this machine already has, if any.
///
/// Nothing is bundled for this. Deno used to be, and it was 95 MB unpacked --
/// two thirds of the installer -- for a warning line. Measured on 2026-09-02
/// against a 4K YouTube video, `yt-dlp -J` returned the same 53 formats and
/// chose the same 1080p H.264 + m4a pair with the runtime and without it; the
/// only difference was the warning. That is not worth 95 MB in every download
/// of the app, so the runtime is now something we *use* when it is there rather
/// than something we ship.
///
/// It is there more often than the old comment assumed: `node` is on most
/// developer machines and a great many ordinary ones, `bun` and `quickjs`
/// increasingly so. Cached like `resolve`, since a PATH walk per yt-dlp spawn
/// would be pointless work.
pub fn js_runtime(app: &AppHandle) -> Option<JsRuntime> {
    static CACHE: OnceLock<std::sync::Mutex<Option<Option<JsRuntime>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);

    if let Some(hit) = cache.lock().unwrap().clone() {
        return hit;
    }
    let found = JS_RUNTIMES.iter().find_map(|name| {
        find_executable_path(app, &executable_name(name)).map(|path| JsRuntime { name, path })
    });
    *cache.lock().unwrap() = Some(found.clone());
    found
}

/// The same search as `find_binary`, but always answering with a real path.
///
/// `find_binary` deliberately hands back the bare file name for a PATH hit, so
/// the OS keeps resolving it if PATH is reordered mid-session. That is right
/// for a tool this app spawns itself and wrong here: what this produces is the
/// value of `--js-runtimes node:...`, which yt-dlp documents as "the path to
/// the binary or its containing directory" -- and `node:node` is neither.
fn find_executable_path(app: &AppHandle, file: &str) -> Option<PathBuf> {
    if let Some(resolved) = find_binary(app, file) {
        if resolved.path.is_absolute() {
            return Some(resolved.path);
        }
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(file))
        .find(|candidate| candidate.is_file())
}

/// Points yt-dlp at whatever JavaScript runtime this machine has.
///
/// YouTube's player signs its media URLs with a challenge that has to be *run*,
/// not parsed. Without an engine for it yt-dlp prints:
///
///   WARNING: [youtube] No supported JavaScript runtime could be found ...
///   YouTube extraction without a JS runtime has been deprecated, and some
///   formats may be missing
///
/// "May be missing" is the accurate word -- see the measurement on
/// `js_runtime`. Downloads work either way; a runtime that is present removes
/// the one case where they might not.
///
/// Conditional, in the same shape and for the same reason as
/// `--ffmpeg-location`: passing a flag that names nothing is worse than not
/// passing it. The path is given explicitly so a runtime found somewhere PATH
/// does not reach -- an app data dir, a bundled resource someone dropped in --
/// is still used.
pub fn with_js_runtime(app: &AppHandle, cmd: &mut Command) {
    if let Some(runtime) = js_runtime(app) {
        cmd.arg("--js-runtimes");
        cmd.arg(format!("{}:{}", runtime.name, runtime.path.to_string_lossy()));
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

/// Runs the tool and returns the version it reports, or `None` if it will not
/// run at all. Availability is exactly `probe(..).is_some()`.
///
/// Existence is not availability. The shared ffmpeg build we bundle needs its
/// libraries on the search path, and when that broke, `resolve` still said yes
/// while every single job failed with a dynamic-loader error. Going through
/// `command()` exercises the same environment a real job gets, so a linkage
/// problem shows up once, as "unavailable", instead of separately inside every
/// operation.
///
/// One function rather than a separate `is_available` and `version`, because
/// each call is a process spawn and yt-dlp is a PyInstaller bundle that unpacks
/// itself and boots CPython every time -- measured at 1.8-2.1s. Asking the same
/// question twice cost four seconds for one answer.
///
/// Async, and spawned through `process::output`, so this never occupies the
/// thread it was called from.
pub async fn probe(app: &AppHandle, tool: Tool) -> Option<String> {
    let mut cmd = command(app, tool).ok()?;
    cmd.arg(tool.version_arg());

    let stdout = crate::process::output(cmd, tool.name()).await.ok()?;
    // ffmpeg prints a whole banner; yt-dlp prints just the version. Either way
    // the first line is the useful one.
    stdout
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
    find_binary(app, &tool.file_name())
}

/// Where an executable is, by file name.
///
/// App data dir, then the bundled resources, then PATH -- see the note at the
/// top of the file for why that order. Split out from `locate` because the
/// JavaScript runtime lookup needs exactly the same search over names that are
/// not `Tool`s.
fn find_binary(app: &AppHandle, file: &str) -> Option<Resolved> {
    let mut roots = Vec::new();
    if let Ok(data) = app.path().app_data_dir() {
        roots.push(data.join("bin"));
    }
    if let Ok(resources) = app.path().resource_dir() {
        roots.push(resources.join("binaries"));
    }

    for root in roots {
        let candidate = root.join(file);
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
    //
    // A PATH walk rather than running the tool: `resolve` is called from async
    // code on every job, and spawning yt-dlp here to ask whether yt-dlp exists
    // cost two blocking seconds. Nothing is lost by not validating -- `probe`
    // runs the tool immediately afterwards, and a present-but-broken binary
    // *should* report as unavailable, which is what the health check is for.
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(file))
        .find(|candidate| candidate.is_file())
        .map(|_| Resolved {
            // The bare name, not the resolved path: leaving it to the OS keeps
            // this working if PATH is reordered mid-session.
            path: PathBuf::from(file),
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
        if let Some(lib) = lib_dir_for(app, &resolved) {
            let value = match std::env::var_os("LD_LIBRARY_PATH") {
                Some(existing) => {
                    let mut paths = vec![lib];
                    paths.extend(std::env::split_paths(&existing));
                    std::env::join_paths(paths).map_err(|e| AppError::spawn(tool.name(), e))?
                }
                None => lib.into_os_string(),
            };
            cmd.env("LD_LIBRARY_PATH", value);
        }
    }

    Ok(cmd)
}

/// Where the ffmpeg shared libraries live, for a tool that is about to run.
///
/// Not simply `resolved.dir.join("lib")`. That is right for ffmpeg and ffprobe,
/// which sit beside the `lib` folder they need, and wrong for yt-dlp the moment
/// the in-app updater has run: the fresher yt-dlp lands in the app data dir,
/// which holds one file and no `lib`, so the search path was left unset and the
/// ffmpeg yt-dlp spawns died on `libavdevice.so`. yt-dlp reads that as "ffmpeg
/// is not installed", drops to a warning, and leaves the video and audio
/// streams beside each other as two unplayable files -- silently, exit code 0.
///
/// So the answer comes from wherever ffmpeg itself was found, with the tool's
/// own directory tried first for the case where ffprobe and ffmpeg are not
/// installed together.
#[cfg(target_os = "linux")]
fn lib_dir_for(app: &AppHandle, resolved: &Resolved) -> Option<PathBuf> {
    let own = resolved.dir.as_ref().map(|dir| dir.join("lib"));
    if let Some(lib) = own.filter(|lib| lib.is_dir()) {
        return Some(lib);
    }
    let lib = resolve(app, Tool::Ffmpeg).ok()?.dir?.join("lib");
    lib.is_dir().then_some(lib)
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
