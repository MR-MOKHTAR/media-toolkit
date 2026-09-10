//! Persistent app settings that must not live in the webview.
//!
//! Theme and language are in localStorage, which is right for them: the webview
//! is the only thing that reads them and neither is a secret. What is here is
//! what Rust itself has to know before the webview has said anything -- the
//! library layout, which `library::ensure_layout` applies at startup.
//!
//! The file is still written 0600. It held a Groq API key until the
//! transcription tool was removed, and the mode is kept because a settings file
//! full of a user's own paths is nobody else's business either -- the same
//! protection a `.netrc` gets, and honest about what it defends against:
//! another user on the machine, not someone who already has this account.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// The field an install from before v1.3 holds. Read for one reason only: to
/// notice it and rewrite the file without it. See `load`.
const LEGACY_KEY_FIELD: &str = "groqApiKey";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Where the app keeps what it produces. `None` means the default,
    /// `<Downloads>/Media Toolkit` -- storing the resolved path instead would
    /// freeze a Downloads folder the user is still free to move.
    pub library_root: Option<String>,

    /// One subfolder per tool inside the root.
    pub organize_by_tool: bool,

    /// Media tools default their output to the source file's folder rather than
    /// to the library. Off by default: keeping the app's output together is the
    /// point of having a library at all.
    pub save_next_to_input: bool,
}

/// Written by hand because `derive(Default)` would make `organize_by_tool`
/// false, and `#[serde(default)]` fills every missing field from here -- so a
/// settings file written before these fields existed would silently opt out of
/// the layout instead of getting it.
impl Default for Settings {
    fn default() -> Self {
        Self {
            library_root: None,
            organize_by_tool: true,
            save_next_to_input: false,
        }
    }
}

fn path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::io(std::path::Path::new("app config dir"), e))?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::io(&dir, e))?;
    Ok(dir.join("settings.json"))
}

/// Reads the settings, treating every failure as "no settings yet".
///
/// A missing file is the normal first-run state, and a corrupt one is not worth
/// refusing to start over -- what is in here is a folder choice and two
/// switches, all of them re-made in seconds.
///
/// It also does one write. An install from before v1.3 has a Groq API key in
/// this file, and the tool that used it is gone: dropping the field from
/// `Settings` makes serde ignore it, which leaves the secret sitting on disk
/// forever. Noticing it here and saving the parsed settings back is what
/// actually removes it, on the next launch, without asking anyone.
pub fn load(app: &AppHandle) -> Settings {
    let Ok(file) = path(app) else {
        return Settings::default();
    };
    let Ok(raw) = std::fs::read_to_string(&file) else {
        return Settings::default();
    };

    let settings: Settings = serde_json::from_str(&raw).unwrap_or_default();

    if carries_legacy_key(&raw) {
        // Best effort. A settings file that cannot be rewritten is not a reason
        // to fail a launch, and the next one tries again.
        let _ = save(app, &settings);
    }

    settings
}

/// Whether this file still holds the removed API key field.
///
/// Parsed rather than searched for as a substring, so a library path that
/// happens to contain the words does not trigger a pointless rewrite.
fn carries_legacy_key(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|value| value.get(LEGACY_KEY_FIELD).cloned())
        .is_some_and(|key| !key.is_null())
}

pub fn save(app: &AppHandle, settings: &Settings) -> AppResult<()> {
    let file = path(app)?;
    let body =
        serde_json::to_string_pretty(settings).map_err(|e| AppError::io(&file, e))?;
    write_private(&file, &body)
}

/// Writes a file only this user can read.
///
/// The mode is set *as the file is created*, not chmod'ed afterwards: writing
/// first and tightening second leaves a window in which the key is world
/// readable, which is precisely what this is for. It also has to be applied on
/// every write, because an existing file keeps whatever mode it already had.
///
/// Windows has no portable equivalent; the file inherits the user profile's
/// ACL, which is the same protection the rest of the app data gets.
fn write_private(file: &std::path::Path, body: &str) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;

        let mut handle = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(file)
            .map_err(|e| AppError::io(file, e))?;
        handle
            .write_all(body.as_bytes())
            .map_err(|e| AppError::io(file, e))?;

        // An existing file keeps its old mode, and one written by an earlier
        // build -- or restored from a backup -- can be 0644. Re-asserting it is
        // cheap and is the only thing that fixes those.
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    std::fs::write(file, body).map_err(|e| AppError::io(file, e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip_through_json() {
        let settings = Settings {
            library_root: Some("/srv/media".into()),
            organize_by_tool: false,
            save_next_to_input: true,
        };
        let raw = serde_json::to_string(&settings).unwrap();
        // camelCase across the boundary, matching every other serialized type.
        assert!(raw.contains("libraryRoot"), "{raw}");
        assert!(raw.contains("organizeByTool"), "{raw}");

        let back: Settings = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.library_root.as_deref(), Some("/srv/media"));
        assert!(!back.organize_by_tool);
        assert!(back.save_next_to_input);
    }

    /// The one property that makes a plain file an acceptable place for the
    /// user's own paths -- and, until v1.3, for an API key.
    #[cfg(unix)]
    #[test]
    fn the_settings_file_is_readable_only_by_its_owner() {
        use std::os::unix::fs::PermissionsExt;

        let file = std::env::temp_dir().join(format!("mt-settings-{}.json", std::process::id()));

        write_private(&file, r#"{"libraryRoot":"/srv/one"}"#).unwrap();
        let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "world-readable settings file: {mode:o}");

        // A file left over from an earlier build could already be 0644, and a
        // second write must not inherit that.
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_private(&file, r#"{"libraryRoot":"/srv/two"}"#).unwrap();
        let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "a loose mode survived a rewrite: {mode:o}");

        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            r#"{"libraryRoot":"/srv/two"}"#,
            "truncation failed, leaving the old contents behind the new"
        );

        std::fs::remove_file(&file).unwrap();
    }

    #[test]
    fn an_unknown_or_missing_field_still_parses() {
        // `default` on the container is what lets a settings file written by a
        // newer build -- or an empty one -- load instead of resetting.
        let back: Settings = serde_json::from_str("{}").unwrap();
        assert!(back.library_root.is_none());
        assert!(back.organize_by_tool, "the layout defaulted to off");
    }

    /// A file written before the library existed holds only `groqApiKey`, and
    /// that install must still get the organized layout rather than a flat
    /// folder it never asked for. The unknown field is ignored rather than
    /// fatal, which is what makes the rewrite in `load` the only thing standing
    /// between that key and staying on disk forever.
    #[test]
    fn an_older_settings_file_still_gets_the_layout() {
        let back: Settings = serde_json::from_str(r#"{"groqApiKey":"gsk_test"}"#).unwrap();
        assert!(back.organize_by_tool, "the layout defaulted to off");
        assert!(!back.save_next_to_input);
        assert!(back.library_root.is_none(), "a root appeared from nowhere");
    }

    /// What triggers the one-time rewrite, and what must not.
    #[test]
    fn only_a_real_leftover_key_asks_for_a_rewrite() {
        assert!(carries_legacy_key(r#"{"groqApiKey":"gsk_test"}"#));
        assert!(carries_legacy_key(
            r#"{"libraryRoot":"/srv","groqApiKey":"gsk_test"}"#
        ));

        assert!(!carries_legacy_key("{}"));
        assert!(!carries_legacy_key(r#"{"groqApiKey":null}"#));
        // A path is not a key. Substring matching would have rewritten this
        // file on every single launch, for nothing.
        assert!(!carries_legacy_key(r#"{"libraryRoot":"/home/a/groqApiKey"}"#));
        assert!(!carries_legacy_key("not json at all"));
    }
}
