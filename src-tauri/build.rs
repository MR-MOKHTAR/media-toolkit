//! Provisions the external binaries the app ships with (yt-dlp, ffmpeg, ffprobe)
//! into `src-tauri/binaries/`, which `tauri.conf.json` bundles as a resource.
//!
//! Two rules make this script correct, and both were broken before:
//!
//! 1. `tauri_build::build()` is the last statement of `main`, unconditionally.
//!    Nothing above it may return early. Tauri's codegen is what generates the
//!    capability ACL and registers `cfg(mobile)`; skipping it silently ships an
//!    app whose declared permissions never take effect.
//!
//! 2. Freshness is decided by a manifest (`binaries/.tools.json`), not by
//!    `path.exists()`. Existence alone means a binary downloaded once is frozen
//!    forever -- which is how the bundled yt-dlp went three months stale while
//!    every build reported success.
//!
//! Provisioning is best-effort: a network failure warns and continues, so an
//! offline or rate-limited build still compiles. A missing binary surfaces at
//! runtime as a clear "tool not found" error instead of a mystery spawn failure.
//!
//! Env overrides:
//!   DOWNLOADER_FORCE_TOOL_FETCH=1  re-download everything, ignoring the manifest
//!   DOWNLOADER_SKIP_TOOL_FETCH=1   never touch the network (airgapped dev)

use std::collections::BTreeMap;
use std::env;
use std::error::Error;
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

type Res<T> = Result<T, Box<dyn Error>>;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=tools.lock.json");
    println!("cargo:rerun-if-env-changed=DOWNLOADER_FORCE_TOOL_FETCH");
    println!("cargo:rerun-if-env-changed=DOWNLOADER_SKIP_TOOL_FETCH");

    if let Err(error) = provision() {
        // Never fatal. A build without the binaries still produces a working
        // app; the tools are reported as missing in the UI instead.
        warn(format!("tool provisioning failed: {error}"));
    }

    // MUST stay last, outside every `?`. See rule 1 above.
    tauri_build::build();
}

// ---------------------------------------------------------------- lock file

#[derive(Deserialize)]
struct Lock {
    tools: BTreeMap<String, ToolSpec>,
}

#[derive(Deserialize)]
struct ToolSpec {
    targets: BTreeMap<String, TargetSpec>,
}

#[derive(Deserialize, Clone)]
struct TargetSpec {
    url: String,
    /// `raw` (the download is the binary), `zip`, or `tar.xz`.
    archive: String,
    /// Path inside the archive, matched on a component boundary so the
    /// top-level directory BtbN wraps its builds in needs no strip count.
    /// A trailing `/` means "this whole subtree", and `install_as` then names
    /// a destination directory rather than a file.
    member: Option<String>,
    install_as: String,
    /// Substrings that disqualify an entry during a subtree extraction. Used
    /// to leave out ffplay (~18 MB, and the app never plays media itself) and
    /// the pkgconfig metadata.
    #[serde(default)]
    exclude: Vec<String>,
    /// When set, a mismatch fails the fetch. Left null for sources that
    /// re-publish the same URL (BtbN's `n8.1-latest`, yt-dlp's `latest`),
    /// where a hard pin would break every build within the week.
    sha256: Option<String>,
    /// False for the license text we ship alongside the binaries.
    #[serde(default = "yes")]
    executable: bool,
}

fn yes() -> bool {
    true
}

// ------------------------------------------------------------ local manifest

#[derive(Serialize, Deserialize, Default)]
struct Manifest {
    target: String,
    entries: BTreeMap<String, Entry>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Entry {
    url: String,
    sha256: String,
    bytes: u64,
    install_as: String,
}

// ------------------------------------------------------------------ provision

fn provision() -> Res<()> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let binaries_dir = manifest_dir.join("binaries");
    fs::create_dir_all(&binaries_dir)?;

    let target = target_key()?;
    let lock: Lock = serde_json::from_str(&fs::read_to_string(manifest_dir.join("tools.lock.json"))?)?;

    // ffmpeg and ffprobe live in the same 120 MB archive on Windows and Linux.
    // Group by URL so it is fetched once and both members are extracted from it.
    let mut groups: BTreeMap<String, Vec<(String, TargetSpec)>> = BTreeMap::new();
    for (tool, spec) in &lock.tools {
        match spec.targets.get(&target) {
            Some(t) => groups.entry(t.url.clone()).or_default().push((tool.clone(), t.clone())),
            None => warn(format!("{tool}: no source pinned for target {target}, skipping")),
        }
    }

    let mut manifest = load_manifest(&binaries_dir);
    if manifest.target != target {
        // Cross-compiling into a directory that holds another target's binaries.
        manifest = Manifest { target: target.clone(), entries: BTreeMap::new() };
    }

    let force = env::var_os("DOWNLOADER_FORCE_TOOL_FETCH").is_some();
    let skip = env::var_os("DOWNLOADER_SKIP_TOOL_FETCH").is_some();

    for (url, members) in groups {
        if !force && !needs_fetch(&binaries_dir, &manifest, &url, &members) {
            continue;
        }
        if skip {
            warn(format!("DOWNLOADER_SKIP_TOOL_FETCH set, not fetching {url}"));
            continue;
        }
        // One failing tool must not stop the others.
        match fetch_group(&binaries_dir, &url, &members) {
            Ok(fetched) => {
                for (tool, entry) in fetched {
                    manifest.entries.insert(tool, entry);
                }
                save_manifest(&binaries_dir, &manifest);
            }
            Err(error) => warn(format!("failed to provision from {url}: {error}")),
        }
    }

    for (tool, spec) in &lock.tools {
        if let Some(t) = spec.targets.get(&target) {
            if !binaries_dir.join(&t.install_as).exists() {
                warn(format!("{tool} is MISSING -- the app will report it as unavailable"));
            }
        }
    }

    Ok(())
}

fn needs_fetch(
    binaries_dir: &Path,
    manifest: &Manifest,
    url: &str,
    members: &[(String, TargetSpec)],
) -> bool {
    members.iter().any(|(tool, spec)| {
        if !binaries_dir.join(&spec.install_as).exists() {
            return true;
        }
        match manifest.entries.get(tool) {
            None => true,
            Some(entry) => {
                entry.url != url
                    || spec
                        .sha256
                        .as_deref()
                        .is_some_and(|want| !want.eq_ignore_ascii_case(&entry.sha256))
            }
        }
    })
}

/// Downloads `url` once and installs every member extracted from it.
fn fetch_group(
    binaries_dir: &Path,
    url: &str,
    members: &[(String, TargetSpec)],
) -> Res<Vec<(String, Entry)>> {
    let out_dir = PathBuf::from(env::var("OUT_DIR")?);
    let stage = out_dir.join("tool-stage");
    fs::create_dir_all(&stage)?;

    let names: Vec<&str> = members.iter().map(|(t, _)| t.as_str()).collect();
    println!("cargo:warning=fetching {} from {url}", names.join(" + "));

    let archive_path = stage.join("download.tmp");
    let (sha256, bytes) = download(url, &archive_path)?;

    // The whole group shares one archive, so one pinned digest covers all of it.
    if let Some(want) = members.iter().find_map(|(_, s)| s.sha256.as_deref()) {
        if !want.eq_ignore_ascii_case(&sha256) {
            return Err(format!("sha256 mismatch: expected {want}, got {sha256}").into());
        }
    }

    let mut installed = Vec::new();
    for (tool, spec) in members {
        let staged = stage.join(format!("{tool}.part"));
        let _ = fs::remove_dir_all(&staged);
        let _ = fs::remove_file(&staged);

        extract(&archive_path, spec, &staged)
            .map_err(|e| format!("{tool}: extracting {:?}: {e}", spec.member))?;

        let size = tree_size(&staged)?;
        if size == 0 {
            return Err(format!("{tool}: extracted nothing").into());
        }
        if spec.executable && staged.is_file() {
            make_executable(&staged)?;
        }

        // `.` means "drop these next to the binaries" -- the Windows DLLs, which
        // the loader finds in the executable's own directory. It must merge, not
        // replace, or it would wipe binaries/ wholesale.
        let merge = spec.install_as == ".";
        let dest = if merge { binaries_dir.to_path_buf() } else { binaries_dir.join(&spec.install_as) };
        install_atomically(&staged, &dest, merge)?;

        println!("cargo:warning=  installed {} ({} MiB)", spec.install_as, size / 1_048_576);
        installed.push((
            tool.clone(),
            Entry {
                url: url.to_string(),
                sha256: sha256.clone(),
                bytes,
                install_as: spec.install_as.clone(),
            },
        ));
    }

    let _ = fs::remove_file(&archive_path);
    Ok(installed)
}

/// Streams `url` to `dest`, returning its hex sha256 and byte count.
///
/// Retried, because these are 40-160 MB transfers and one dropped connection
/// would otherwise cost the build its entire ffmpeg.
fn download(url: &str, dest: &Path) -> Res<(String, u64)> {
    const ATTEMPTS: u32 = 3;
    let mut last = String::new();
    for attempt in 1..=ATTEMPTS {
        match download_once(url, dest) {
            Ok(result) => return Ok(result),
            Err(error) => {
                last = error.to_string();
                if attempt < ATTEMPTS {
                    warn(format!("  attempt {attempt}/{ATTEMPTS} failed ({last}), retrying"));
                    std::thread::sleep(std::time::Duration::from_secs(2 * attempt as u64));
                }
            }
        }
    }
    Err(format!("gave up after {ATTEMPTS} attempts: {last}").into())
}

/// Streaming rather than buffering matters: the Windows archive is 76 MB
/// compressed and expands well past that.
fn download_once(url: &str, dest: &Path) -> Res<(String, u64)> {
    let mut response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .user_agent("downloader-build-script")
        .build()?
        .get(url)
        .send()?
        .error_for_status()?;

    let mut file = BufWriter::new(File::create(dest)?);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut total = 0u64;

    loop {
        let read = response.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
        file.write_all(&buf[..read])?;
        total += read as u64;
    }
    file.flush()?;

    Ok((hex(&hasher.finalize()), total))
}

fn extract(archive: &Path, spec: &TargetSpec, dest: &Path) -> Res<()> {
    if spec.archive == "raw" {
        fs::copy(archive, dest)?;
        return Ok(());
    }

    let member = spec.member.as_deref().ok_or("archive source needs a `member`")?;
    let subtree = member.ends_with('/');
    let mut found = 0usize;

    match spec.archive.as_str() {
        "zip" => {
            let mut zip = zip::ZipArchive::new(File::open(archive)?)?;
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i)?;
                if !entry.is_file() {
                    continue;
                }
                let name = entry.name().to_string();
                let Some(out_path) = target_for(&name, member, subtree, dest, &spec.exclude) else {
                    continue;
                };
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut out = BufWriter::new(File::create(&out_path)?);
                io::copy(&mut entry, &mut out)?;
                out.flush()?;
                found += 1;
                if !subtree {
                    break;
                }
            }
        }
        "tar.xz" => {
            let reader = liblzma::read::XzDecoder::new(BufReader::new(File::open(archive)?));
            let mut tar = tar::Archive::new(reader);
            for entry in tar.entries()? {
                let mut entry = entry?;
                let kind = entry.header().entry_type();
                // Symlinks matter: the shared ffmpeg build ships the real
                // library as libavcodec.so.62.28.102 and the SONAME the loader
                // actually looks for, libavcodec.so.62, as a link to it.
                if !kind.is_file() && !kind.is_symlink() {
                    continue;
                }
                let name = entry.path()?.to_string_lossy().into_owned();
                let Some(out_path) = target_for(&name, member, subtree, dest, &spec.exclude) else {
                    continue;
                };
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                entry.unpack(&out_path)?;
                found += 1;
                if !subtree {
                    break;
                }
            }
        }
        other => return Err(format!("unknown archive kind `{other}`").into()),
    }

    if found == 0 {
        return Err(format!("`{member}` matched nothing in the archive").into());
    }
    if subtree {
        collapse_symlinks(dest)?;
    }
    Ok(())
}

/// Replaces each `libfoo.so.N` symlink with the real file it points at, and
/// drops every other link and the now-orphaned versioned original.
///
/// Tauri dereferences symlinks when it copies resources into a bundle, so
/// shipping the archive's layout verbatim writes three full copies of every
/// library: `libavcodec.so`, `libavcodec.so.62` and `libavcodec.so.62.28.102`
/// are one 96 MB file and two links, and all three land in the installer as
/// 96 MB files. That took the .deb to 257 MB.
///
/// `libavcodec.so.62` is the SONAME the loader actually asks for, so that is
/// the name the real file gets. The bare `.so` is a link-time convenience the
/// app never needs, and the fully versioned name is only reachable through it.
fn collapse_symlinks(dir: &Path) -> Res<()> {
    if !dir.is_dir() {
        return Ok(());
    }

    let mut links = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_type()?.is_symlink() {
            let target = fs::read_link(entry.path())?;
            links.push((entry.path(), target));
        }
    }

    for (link, target) in &links {
        let Some(name) = link.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        // Only the SONAME form: exactly one numeric component after `.so`.
        let is_soname = name
            .split_once(".so.")
            .is_some_and(|(_, rest)| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()));

        // Links point at a sibling, so the target is relative to `dir`.
        let resolved = dir.join(target.file_name().unwrap_or(target.as_os_str()));
        fs::remove_file(link)?;
        if is_soname && resolved.is_file() {
            fs::rename(&resolved, link)?;
        }
    }

    // Anything still carrying a full version number is unreachable now.
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let orphan = name
            .split_once(".so.")
            .is_some_and(|(_, rest)| rest.contains('.'));
        if orphan && entry.file_type()?.is_file() {
            fs::remove_file(entry.path())?;
        }
    }

    Ok(())
}

/// Where an archive entry should land, or `None` if it is not wanted.
///
/// BtbN wraps its builds in a versioned top-level directory
/// (`ffmpeg-n8.1-latest-linux64-gpl-8.1/bin/ffmpeg`) while the macOS zips are
/// flat (`ffmpeg`). Matching on a component boundary handles both without the
/// lock file having to encode a strip count per source.
fn target_for(
    entry: &str,
    member: &str,
    subtree: bool,
    dest: &Path,
    exclude: &[String],
) -> Option<PathBuf> {
    let entry = entry.replace('\\', "/");
    let entry = entry.trim_start_matches("./");
    if exclude.iter().any(|pattern| entry.contains(pattern.as_str())) {
        return None;
    }

    if !subtree {
        let hit = entry == member || entry.ends_with(&format!("/{member}"));
        return hit.then(|| dest.to_path_buf());
    }

    let rest = if let Some(rest) = entry.strip_prefix(member) {
        rest
    } else {
        let boundary = format!("/{member}");
        let at = entry.find(&boundary)?;
        &entry[at + boundary.len()..]
    };
    if rest.is_empty() || rest.contains("..") {
        return None;
    }
    Some(dest.join(rest))
}

fn tree_size(path: &Path) -> Res<u64> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_dir() {
        return Ok(meta.len());
    }
    let mut total = 0;
    for entry in fs::read_dir(path)? {
        total += tree_size(&entry?.path())?;
    }
    Ok(total)
}

fn install_atomically(staged: &Path, dest: &Path, merge: bool) -> Res<()> {
    if merge {
        // Move the staged children in one at a time. Never touch `dest` itself:
        // it is the shared binaries directory.
        fs::create_dir_all(dest)?;
        for entry in fs::read_dir(staged)? {
            let entry = entry?;
            let target = dest.join(entry.file_name());
            let _ = fs::remove_file(&target);
            let _ = fs::remove_dir_all(&target);
            if fs::rename(entry.path(), &target).is_err() {
                if entry.metadata()?.is_dir() {
                    copy_tree(&entry.path(), &target)?;
                } else {
                    fs::copy(entry.path(), &target)?;
                }
            }
        }
        let _ = fs::remove_dir_all(staged);
        return Ok(());
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    // Rename is atomic, so an interrupted build never leaves a half-written
    // binary in place.
    let _ = fs::remove_dir_all(dest);
    if fs::rename(staged, dest).is_ok() {
        return Ok(());
    }
    // OUT_DIR can sit on a different mount, where rename fails with EXDEV.
    if staged.is_dir() {
        copy_tree(staged, dest)?;
        fs::remove_dir_all(staged)?;
    } else {
        fs::copy(staged, dest)?;
        fs::remove_file(staged)?;
    }
    Ok(())
}

fn copy_tree(from: &Path, to: &Path) -> Res<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let meta = entry.metadata()?;
        if meta.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Res<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
    Ok(())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Res<()> {
    Ok(())
}

// ------------------------------------------------------------------- helpers

fn target_key() -> Res<String> {
    let os = env::var("CARGO_CFG_TARGET_OS")?;
    let arch = env::var("CARGO_CFG_TARGET_ARCH")?;
    Ok(format!("{os}-{arch}"))
}

fn load_manifest(binaries_dir: &Path) -> Manifest {
    fs::read_to_string(binaries_dir.join(".tools.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_manifest(binaries_dir: &Path, manifest: &Manifest) {
    match serde_json::to_string_pretty(manifest) {
        Ok(text) => {
            if let Err(error) = fs::write(binaries_dir.join(".tools.json"), text) {
                warn(format!("could not write tool manifest: {error}"));
            }
        }
        Err(error) => warn(format!("could not serialize tool manifest: {error}")),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn warn(message: String) {
    println!("cargo:warning={message}");
}
