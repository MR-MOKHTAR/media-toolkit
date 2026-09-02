//! Where the app's own files live.
//!
//! Everything used to be written straight into the user's Downloads folder,
//! mixed in with every installer and PDF they have ever saved. A clip, a
//! transcript and a 4K download landed side by side, and nothing in that folder
//! said which of them this app had produced.
//!
//! So the app owns a folder -- `~/Downloads/Media Toolkit` by default -- and
//! sorts what it writes into one subfolder per tool. Two properties matter more
//! than the layout itself:
//!
//! * The root is a persisted setting, not a per-session choice. Picking a
//!   folder in a tool screen still works and still wins for that run, but the
//!   place the app defaults to survives a restart.
//! * The layout is decided in one place. Every tool asks this module for its
//!   folder rather than hand-building one, which is what keeps "where did my
//!   file go" answerable with a single sentence.
//!
//! Folder names are English and fixed, not localized. A path is a durable thing
//! that scripts, backups and the file manager all refer to; renaming half a
//! library because someone switched the app to Persian would strand every file
//! written before the switch.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::paths;
use crate::settings;

/// Used when the product name sanitizes down to nothing worth reading.
const FALLBACK_FOLDER: &str = "Media Toolkit";

/// One shelf in the library.
///
/// Deliberately not `JobKind`: a download splits by what it produced, so video
/// and audio land apart, and the names read as results ("Compressed") rather
/// than as verbs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Slot {
    Video,
    /// Audio the app produced: a download the user asked for as audio, and a
    /// track lifted out of a video. One shelf rather than two, because in both
    /// cases the result is an audio file and the tool that made it is not what
    /// anyone is looking for it under.
    Audio,
    /// Anything fetched verbatim that is not video or audio -- an installer, an
    /// archive, a PDF. Its own shelf because the alternative was filing a zip
    /// under "Video", which is where it went when a download could only ever be
    /// one of those two.
    Files,
    Compressed,
    Trimmed,
    Converted,
}

impl Slot {
    /// The on-disk name. ASCII, no spaces to quote, stable across releases --
    /// changing one of these strands every file already written under it.
    ///
    /// `Transcripts` was one of these until v1.3. Its folder is not deleted on
    /// upgrade -- an empty one is harmless, and a user who put something there
    /// would not thank us -- it simply stops being created and referenced.
    pub fn dir_name(self) -> &'static str {
        match self {
            Self::Video => "Video",
            Self::Audio => "Audio",
            Self::Files => "Files",
            Self::Compressed => "Compressed",
            Self::Trimmed => "Trimmed",
            Self::Converted => "Converted",
        }
    }

    /// Every shelf, for creating the layout up front.
    pub fn all() -> [Slot; 6] {
        [
            Self::Video,
            Self::Audio,
            Self::Files,
            Self::Compressed,
            Self::Trimmed,
            Self::Converted,
        ]
    }
}

/// What the frontend needs to render the storage section: where files go now,
/// where they would go by default, and the two switches that change it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub root: String,
    pub default_root: String,
    /// So Settings can hide "reset" when there is nothing to reset to.
    pub is_default: bool,
    pub organize_by_tool: bool,
    pub save_next_to_input: bool,
}

/// The app's folder name, taken from the bundle's product name so a rename in
/// `tauri.conf.json` carries here without a second edit.
fn app_folder_name(app: &AppHandle) -> String {
    let raw = app.package_info().name.clone();
    let cleaned = paths::sanitize_stem(&raw);
    // `sanitize_stem` answers "media" for anything with no alphanumerics left,
    // which is a poor name for a folder in someone's Downloads.
    if cleaned.eq_ignore_ascii_case("media") && !raw.eq_ignore_ascii_case("media") {
        return FALLBACK_FOLDER.to_string();
    }
    cleaned
}

/// `<Downloads>/Media Toolkit`, resolved through the platform's real Downloads
/// folder -- see `paths::default_download_dir`.
pub fn default_root(app: &AppHandle) -> PathBuf {
    PathBuf::from(paths::default_download_dir(app)).join(app_folder_name(app))
}

/// The configured root, or the default when nothing is configured.
fn root_from(app: &AppHandle, settings: &settings::Settings) -> PathBuf {
    settings
        .library_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| default_root(app))
}

/// Where a `slot`'s output belongs, given a root and the organize switch.
///
/// Pure, so the layout can be tested without an `AppHandle` or a filesystem.
fn resolve(root: &Path, slot: Slot, organize_by_tool: bool) -> PathBuf {
    if organize_by_tool {
        root.join(slot.dir_name())
    } else {
        root.to_path_buf()
    }
}

/// The folder a tool should write into, created if it is not there yet.
pub fn folder(app: &AppHandle, slot: Slot) -> AppResult<PathBuf> {
    let settings = settings::load(app);
    let dir = resolve(&root_from(app, &settings), slot, settings.organize_by_tool);
    std::fs::create_dir_all(&dir).map_err(|error| AppError::io(&dir, error))?;
    Ok(dir)
}

/// Creates the library so it exists before the first job -- someone who opens
/// the app, reads "files are saved to ~/Downloads/Media Toolkit" and goes
/// looking should find it there.
///
/// Best effort: a root on a disconnected drive is a real situation, and it is
/// not a reason to refuse to start. The next job reports it properly, with the
/// path in the message.
pub fn ensure_layout(app: &AppHandle) {
    let settings = settings::load(app);
    let root = root_from(app, &settings);
    if std::fs::create_dir_all(&root).is_err() {
        return;
    }
    if settings.organize_by_tool {
        for slot in Slot::all() {
            let _ = std::fs::create_dir_all(root.join(slot.dir_name()));
        }
    }
}

/// Rejects a root the app cannot actually write to.
///
/// Creating the directory is not proof: a read-only mount, a full disk or a
/// folder owned by another user all create-or-exist happily and then fail on
/// the first real write -- by which point the user has started a download and
/// waited for it. Writing and removing a probe file costs a millisecond and
/// moves that failure into the picker, where it can still be corrected.
fn verify_writable(dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dir).map_err(|error| AppError::io(dir, error))?;

    let probe = dir.join(format!(".mt-write-test-{}", std::process::id()));
    std::fs::write(&probe, b"").map_err(|error| AppError::io(dir, error))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

fn info(app: &AppHandle) -> LibraryInfo {
    let settings = settings::load(app);
    let root = root_from(app, &settings);
    let default_root = default_root(app);
    LibraryInfo {
        is_default: root == default_root,
        root: root.to_string_lossy().into_owned(),
        default_root: default_root.to_string_lossy().into_owned(),
        organize_by_tool: settings.organize_by_tool,
        save_next_to_input: settings.save_next_to_input,
    }
}

/// Reads `settings`, applies `change`, writes it back, and answers with the
/// state the frontend should now render. Every setter here is that shape.
fn update(app: &AppHandle, change: impl FnOnce(&mut settings::Settings)) -> AppResult<LibraryInfo> {
    let mut settings = settings::load(app);
    change(&mut settings);
    settings::save(app, &settings)?;
    Ok(info(app))
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub fn library_info(app: AppHandle) -> LibraryInfo {
    info(&app)
}

/// The folder for one tool. Called by every screen on mount, which is also what
/// creates the subfolder the first time that tool is opened.
#[tauri::command]
pub fn library_folder(app: AppHandle, slot: Slot) -> AppResult<String> {
    Ok(folder(&app, slot)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn set_library_root(app: AppHandle, path: String) -> AppResult<LibraryInfo> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid("libraryRoot", "no folder selected"));
    }
    let dir = PathBuf::from(trimmed);
    verify_writable(&dir)?;

    let info = update(&app, |settings| {
        settings.library_root = Some(dir.to_string_lossy().into_owned());
    })?;
    // Moving the library should leave the same shelves waiting at the new
    // address, not an empty folder that fills in one tool at a time.
    ensure_layout(&app);
    Ok(info)
}

#[tauri::command]
pub fn reset_library_root(app: AppHandle) -> AppResult<LibraryInfo> {
    let info = update(&app, |settings| settings.library_root = None)?;
    ensure_layout(&app);
    Ok(info)
}

#[tauri::command]
pub fn set_library_organize(app: AppHandle, enabled: bool) -> AppResult<LibraryInfo> {
    let info = update(&app, |settings| settings.organize_by_tool = enabled)?;
    ensure_layout(&app);
    Ok(info)
}

/// Whether the media tools default their output to the source file's folder.
///
/// That was the old unconditional behaviour, and for someone editing files in
/// place it is the right one -- but it is the opposite of keeping the app's
/// output together, so it is now a choice and defaults to off.
#[tauri::command]
pub fn set_save_next_to_input(app: AppHandle, enabled: bool) -> AppResult<LibraryInfo> {
    update(&app, |settings| settings.save_next_to_input = enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn organizing_puts_each_tool_on_its_own_shelf() {
        let root = Path::new("/home/x/Downloads/Media Toolkit");
        assert_eq!(
            resolve(root, Slot::Compressed, true),
            root.join("Compressed"),
            "the Compressed shelf moved"
        );
        assert_eq!(resolve(root, Slot::Audio, true), root.join("Audio"));
    }

    #[test]
    fn turning_organizing_off_writes_into_the_root() {
        let root = Path::new("/library");
        for slot in Slot::all() {
            assert_eq!(resolve(root, slot, false), root);
        }
    }

    /// These names are on disk in installs that already exist. A rename here is
    /// a silent split: new files go to the new folder, old ones stay where the
    /// user last saw them.
    #[test]
    fn shelf_names_are_fixed() {
        let names: Vec<&str> = Slot::all().iter().map(|slot| slot.dir_name()).collect();
        assert_eq!(
            names,
            vec![
                "Video",
                "Audio",
                "Files",
                "Compressed",
                "Trimmed",
                "Converted",
            ]
        );
    }

    #[test]
    fn slots_cross_the_bridge_as_camel_case() {
        assert_eq!(
            serde_json::to_string(&Slot::Compressed).unwrap(),
            "\"compressed\""
        );
        let back: Slot = serde_json::from_str("\"compressed\"").unwrap();
        assert_eq!(back, Slot::Compressed);
    }

    /// A shelf that no longer exists must be refused rather than silently
    /// resolving to something else. `transcripts` is the one the frontend could
    /// still ask for, from a route or a stored job written by an older build.
    #[test]
    fn a_retired_slot_is_no_longer_accepted() {
        assert!(serde_json::from_str::<Slot>("\"transcripts\"").is_err());
    }

    #[test]
    fn a_writable_folder_passes_and_leaves_nothing_behind() {
        let dir = std::env::temp_dir().join(format!("mt-lib-{}", std::process::id()));
        verify_writable(&dir).unwrap();

        let leftovers: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().collect();
        assert!(
            leftovers.is_empty(),
            "the probe file was left in the library"
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_cannot_be_written_is_refused() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let dir = std::env::temp_dir().join(format!("mt-lib-ro-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        // Root ignores the mode bits -- every write succeeds -- so under a root
        // test runner this would assert the opposite of what it means.
        if std::fs::metadata(&dir).unwrap().uid() == 0 {
            std::fs::remove_dir_all(&dir).unwrap();
            return;
        }

        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();

        let refused = verify_writable(&dir);

        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(
            refused.is_err(),
            "a read-only folder was accepted as the library root"
        );
    }
}
