//! Persistent app settings that must not live in the webview.
//!
//! Theme and language are in localStorage, which is right for them: the webview
//! is the only thing that reads them and neither is a secret. The Groq API key
//! is a secret, and Rust is what makes the HTTP calls -- so the key has no
//! reason to exist on the JavaScript side at all. It goes in a file only this
//! process writes, and the frontend is told nothing about it beyond whether one
//! is set and its last four characters.
//!
//! This is not a keyring. It is a plain file with restrictive permissions, which
//! is the same protection a `.netrc` or an ssh key gets and is honest about what
//! it defends against: another user on the machine, not someone who already has
//! this account.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub groq_api_key: Option<String>,
}

/// What the frontend is allowed to know. Never the key itself.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub present: bool,
    /// The last four characters, so someone with two keys can tell which one
    /// this is without the app ever handing the secret back.
    pub hint: Option<String>,
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
/// refusing to start over -- the only thing in here is a key the user can paste
/// again in ten seconds.
pub fn load(app: &AppHandle) -> Settings {
    let Ok(file) = path(app) else {
        return Settings::default();
    };
    std::fs::read_to_string(file)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
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

/// The stored key, or the error the transcribe tool turns into "add your key in
/// Settings".
pub fn groq_key(app: &AppHandle) -> AppResult<String> {
    load(app)
        .groq_api_key
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| AppError::MissingApiKey {
            service: "Groq".to_string(),
        })
}

pub fn status(app: &AppHandle) -> ApiKeyStatus {
    match load(app).groq_api_key.filter(|k| !k.trim().is_empty()) {
        Some(key) => ApiKeyStatus {
            present: true,
            hint: Some(hint_of(&key)),
        },
        None => ApiKeyStatus {
            present: false,
            hint: None,
        },
    }
}

/// The tail of a key, for telling two of them apart.
///
/// Four characters, and only when there is enough key left that showing them
/// reveals nothing structural -- a short string here is a typo, not a secret
/// worth hinting at.
fn hint_of(key: &str) -> String {
    let key = key.trim();
    let count = key.chars().count();
    if count <= 8 {
        return "…".to_string();
    }
    format!("…{}", key.chars().skip(count - 4).collect::<String>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hint_never_leaks_more_than_the_tail() {
        assert_eq!(hint_of("gsk_abcdefghijklmnop"), "…mnop");
        // A short value is a mistyped key rather than a real one, and four of
        // its eight characters is a meaningful fraction of it.
        assert_eq!(hint_of("short"), "…");
        assert_eq!(hint_of("12345678"), "…");
    }

    #[test]
    fn settings_round_trip_through_json() {
        let settings = Settings {
            groq_api_key: Some("gsk_test".into()),
        };
        let raw = serde_json::to_string(&settings).unwrap();
        // camelCase across the boundary, matching every other serialized type.
        assert!(raw.contains("groqApiKey"), "{raw}");

        let back: Settings = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.groq_api_key.as_deref(), Some("gsk_test"));
    }

    /// The one property that makes a plain file an acceptable place for a key.
    #[cfg(unix)]
    #[test]
    fn the_key_file_is_readable_only_by_its_owner() {
        use std::os::unix::fs::PermissionsExt;

        let file = std::env::temp_dir().join(format!("mt-settings-{}.json", std::process::id()));

        write_private(&file, r#"{"groqApiKey":"gsk_secret"}"#).unwrap();
        let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "world-readable key file: {mode:o}");

        // A file left over from an earlier build could already be 0644, and a
        // second write must not inherit that.
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_private(&file, r#"{"groqApiKey":"gsk_secret2"}"#).unwrap();
        let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "a loose mode survived a rewrite: {mode:o}");

        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            r#"{"groqApiKey":"gsk_secret2"}"#,
            "truncation failed, leaving the old key behind the new one"
        );

        std::fs::remove_file(&file).unwrap();
    }

    #[test]
    fn an_unknown_or_missing_field_still_parses() {
        // `default` on the container is what lets a settings file written by a
        // newer build -- or an empty one -- load instead of resetting.
        let back: Settings = serde_json::from_str("{}").unwrap();
        assert!(back.groq_api_key.is_none());
    }
}
