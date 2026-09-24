//! Output path construction.
//!
//! The previous code built paths with `format!("{}/{}.mp3", dir, name)`, which
//! produces `C:\Users\x\Downloads/name.mp3` on Windows, and wrote straight over
//! whatever was already there.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

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

/// Output paths handed out to jobs that have not written them yet.
fn claimed() -> &'static Mutex<HashSet<PathBuf>> {
    static CLAIMED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    CLAIMED.get_or_init(Default::default)
}

/// An output path that belongs to one job until this is dropped.
///
/// "Does not exist yet" was the whole test for a free name, and it is not a
/// test two jobs can share: two compressions of the same clip both found
/// `clip.mp4` free, both were given it, and the second one's `-y` wrote over the
/// first. A claim is what the second one now sees instead, and it gets
/// `clip (2).mp4`. Held for as long as the job is writing; once the file exists
/// the ordinary existence check takes over.
#[derive(Debug)]
pub struct OutputClaim {
    path: PathBuf,
}

impl OutputClaim {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for OutputClaim {
    fn drop(&mut self) {
        if let Ok(mut claimed) = claimed().lock() {
            claimed.remove(&self.path);
        }
    }
}

/// Joins `dir`, a sanitized `stem` and `ext` into a path that neither exists
/// nor is claimed by another running job, appending " (2)", " (3)" and so on as
/// needed -- and claims it.
///
/// Overwriting silently is data loss, and these tools write next to a user's
/// own files by default.
pub fn claim_output(dir: &Path, stem: &str, ext: &str) -> OutputClaim {
    let stem = sanitize_stem(stem);
    // A poisoned lock only means another thread panicked while holding it; the
    // set itself is still a valid set of paths.
    let mut claimed = claimed().lock().unwrap_or_else(|poison| poison.into_inner());
    let free = |candidate: &PathBuf| !candidate.exists() && !claimed.contains(candidate);

    let path = std::iter::once(dir.join(format!("{stem}.{ext}")))
        .chain((2..1000).map(|n| dir.join(format!("{stem} ({n}).{ext}"))))
        .find(free)
        // Pathological, but never return a path we know collides.
        .unwrap_or_else(|| dir.join(format!("{stem} ({}).{ext}", fallback_suffix())));

    claimed.insert(path.clone());
    OutputClaim { path }
}

/// A suffix no other call in this process has returned.
fn fallback_suffix() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// Held while a job writes a file whose name is not unique per job.
///
/// Most output is named by `claim_output`, which never gives two jobs the same
/// path. Partial files cannot be: a `.part` is found again by name so that a
/// retry continues from it, which means the same download asked for twice at
/// once -- or two links that happen to share a file name -- lands on the same
/// `.part`. Two engines then wrote into one file, both counted the bytes, and
/// neither result was right: the downloaded figure climbed past the size of the
/// file, and the one that finished second renamed a file that was no longer
/// there. Holding this serializes them instead. The second waits, then finds
/// the first one's file finished and saves its own copy beside it.
pub struct PathLock {
    _guard: tokio::sync::OwnedMutexGuard<()>,
}

/// Waits until no other job holds `key`, then holds it.
pub async fn lock_path(key: PathBuf) -> PathLock {
    let mutex = {
        let mut locks = locks().lock().unwrap_or_else(|poison| poison.into_inner());
        // Entries whose last holder is gone are dropped as a side effect, so
        // the map is only ever as large as the set of files being written.
        locks.retain(|_, weak| weak.strong_count() > 0);
        match locks.get(&key).and_then(Weak::upgrade) {
            Some(mutex) => mutex,
            None => {
                let mutex = Arc::new(tokio::sync::Mutex::new(()));
                locks.insert(key, Arc::downgrade(&mutex));
                mutex
            }
        }
    };
    PathLock {
        _guard: mutex.lock_owned().await,
    }
}

type LockMap = HashMap<PathBuf, Weak<tokio::sync::Mutex<()>>>;

fn locks() -> &'static Mutex<LockMap> {
    static LOCKS: OnceLock<Mutex<LockMap>> = OnceLock::new();
    LOCKS.get_or_init(Default::default)
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

        let first = claim_output(&dir, "clip", "mp4");
        assert_eq!(first.path().file_name().unwrap(), "clip.mp4");
        std::fs::write(first.path(), b"x").unwrap();
        drop(first);

        let second = claim_output(&dir, "clip", "mp4");
        assert_eq!(second.path().file_name().unwrap(), "clip (2).mp4");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The bug: two jobs started together both found `clip.mp4` free, both
    /// were given it, and the second one's ffmpeg overwrote the first one's
    /// output. Nothing is on disk yet at that point, so only the claim can
    /// tell them apart.
    #[test]
    fn two_running_jobs_never_share_an_output() {
        let dir = std::env::temp_dir().join(format!("dl-claim-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let first = claim_output(&dir, "clip", "mp4");
        let second = claim_output(&dir, "clip", "mp4");
        assert_eq!(first.path().file_name().unwrap(), "clip.mp4");
        assert_eq!(second.path().file_name().unwrap(), "clip (2).mp4");

        // A job that ended without writing gives its name back.
        drop(first);
        let third = claim_output(&dir, "clip", "mp4");
        assert_eq!(third.path().file_name().unwrap(), "clip.mp4");

        drop((second, third));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Two jobs on one partial file take turns rather than writing into it
    /// together -- and a different file is never held up by either.
    #[tokio::test]
    async fn a_path_lock_serializes_jobs_on_the_same_file() {
        let key = std::env::temp_dir().join("dl-lock-test.part");
        let held = lock_path(key.clone()).await;

        let waiting = tokio::spawn(lock_path(key.clone()));
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!waiting.is_finished(), "the second job must wait its turn");

        // Unrelated files are not serialized behind it.
        let other = tokio::time::timeout(
            std::time::Duration::from_millis(200),
            lock_path(key.with_extension("other")),
        )
        .await;
        assert!(other.is_ok());

        drop(held);
        tokio::time::timeout(std::time::Duration::from_millis(500), waiting)
            .await
            .expect("released once the first job lets go")
            .expect("the task itself does not panic");
    }
}
