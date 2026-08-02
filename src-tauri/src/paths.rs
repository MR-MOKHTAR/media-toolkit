//! Output path construction.
//!
//! The previous code built paths with `format!("{}/{}.mp3", dir, name)`, which
//! produces `C:\Users\x\Downloads/name.mp3` on Windows, and wrote straight over
//! whatever was already there.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// Characters Windows forbids in a file name, plus the control range. Applied
/// on every platform: a name typed on Linux can still end up on a mounted
/// Windows share, and it keeps behaviour identical everywhere.
const FORBIDDEN: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Reserved DOS device names. `CON.mp4` is still CON on Windows.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Longest stem we keep. Most filesystems cap a component at 255 bytes, and a
/// video title can be far longer than that.
const MAX_STEM: usize = 120;

/// Makes `raw` safe to use as a file name stem, without an extension.
pub fn sanitize_stem(raw: &str) -> String {
    let mut cleaned: String = raw
        .chars()
        .map(|c| {
            if FORBIDDEN.contains(&c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();

    // Windows silently strips trailing dots and spaces, so a name ending in one
    // resolves to something other than what was asked for.
    cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();

    if cleaned.chars().count() > MAX_STEM {
        cleaned = cleaned.chars().take(MAX_STEM).collect::<String>();
        cleaned = cleaned.trim_end().to_string();
    }

    let stem_upper = cleaned.to_ascii_uppercase();
    if RESERVED.contains(&stem_upper.as_str()) {
        cleaned.push('_');
    }

    // A name made entirely of replaced characters -- "///" becomes "___" --
    // is technically valid and useless to read, so it gets the fallback too.
    // `is_alphanumeric` is Unicode-aware, so Persian and Arabic names pass.
    if !cleaned.chars().any(char::is_alphanumeric) {
        return "media".to_string();
    }
    cleaned
}

/// Joins `dir`, a sanitized `stem` and `ext` into a path that does not yet
/// exist, appending " (2)", " (3)" and so on as needed.
///
/// Overwriting silently is data loss, and these tools write next to a user's
/// own files by default.
pub fn unique_output(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let stem = sanitize_stem(stem);
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    for n in 2..1000 {
        let candidate = dir.join(format!("{stem} ({n}).{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    // Pathological, but never return a path we know collides.
    dir.join(format!("{stem} ({}).{ext}", std::process::id()))
}

pub fn ensure_dir(dir: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(dir);
    if path.as_os_str().is_empty() {
        return Err(AppError::invalid("outputDir", "no folder selected"));
    }
    if !path.is_dir() {
        std::fs::create_dir_all(&path).map_err(|error| AppError::io(&path, error))?;
    }
    Ok(path)
}

pub fn require_file(path: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err(AppError::invalid("input", "file does not exist"));
    }
    Ok(path)
}

/// The user's Downloads folder. Goes through XDG on Linux and
/// SHGetKnownFolderPath on Windows, so a relocated or localized Downloads
/// folder resolves correctly -- the old code hand-built `%USERPROFILE%\Downloads`.
pub fn default_download_dir(app: &AppHandle) -> String {
    if let Ok(dir) = app.path().download_dir() {
        return dir.to_string_lossy().into_owned();
    }
    if let Ok(home) = app.path().home_dir() {
        return home.join("Downloads").to_string_lossy().into_owned();
    }
    ".".to_string()
}

/// The stem of a path, for naming a job's output after its input.
pub fn stem_of(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "media".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_characters_windows_rejects() {
        assert_eq!(sanitize_stem("a/b\\c:d*e?f"), "a_b_c_d_e_f");
    }

    #[test]
    fn strips_trailing_dots_and_spaces() {
        // Windows resolves "name..." to "name", so the name we chose and the
        // file that appears would otherwise disagree.
        assert_eq!(sanitize_stem("name... "), "name");
    }

    #[test]
    fn escapes_dos_device_names() {
        assert_eq!(sanitize_stem("CON"), "CON_");
        assert_eq!(sanitize_stem("con"), "con_");
        assert_eq!(sanitize_stem("CONCERT"), "CONCERT");
    }

    #[test]
    fn never_returns_empty() {
        assert_eq!(sanitize_stem("   "), "media");
        assert_eq!(sanitize_stem("///"), "media");
    }

    #[test]
    fn truncates_on_character_boundaries() {
        // Byte-slicing a multi-byte title here would panic.
        let long = "ویدیوی".repeat(50);
        let out = sanitize_stem(&long);
        assert!(out.chars().count() <= MAX_STEM);
    }

    #[test]
    fn keeps_non_latin_names_intact() {
        assert_eq!(sanitize_stem("ویدیوی تست"), "ویدیوی تست");
        assert_eq!(sanitize_stem("فيديو"), "فيديو");
    }

    #[test]
    fn avoids_collisions() {
        let dir = std::env::temp_dir().join(format!("dl-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let first = unique_output(&dir, "clip", "mp4");
        assert_eq!(first.file_name().unwrap(), "clip.mp4");
        std::fs::write(&first, b"x").unwrap();

        let second = unique_output(&dir, "clip", "mp4");
        assert_eq!(second.file_name().unwrap(), "clip (2).mp4");

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
