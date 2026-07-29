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
    /// Path inside the archive; matched on a component boundary so the
    /// top-level directory BtbN wraps its builds in needs no strip count.
    member: Option<String>,
    install_as: String,
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
        let staged = stage.join(format!("{}.part", spec.install_as));
        extract(&archive_path, spec, &staged)
            .map_err(|e| format!("{tool}: extracting {:?}: {e}", spec.member))?;

        let size = fs::metadata(&staged)?.len();
        if size == 0 {
            return Err(format!("{tool}: extracted an empty file").into());
        }
        if spec.executable {
            make_executable(&staged)?;
        }
        install_atomically(&staged, &binaries_dir.join(&spec.install_as))?;

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

/// Streams `url` to `dest`, returning its hex sha256 and byte count. Streaming
/// rather than buffering matters: the Windows ffmpeg archive is 161 MB.
fn download(url: &str, dest: &Path) -> Res<(String, u64)> {
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
    match spec.archive.as_str() {
        "raw" => {
            fs::copy(archive, dest)?;
            Ok(())
        }
        "zip" => {
            let member = spec.member.as_deref().ok_or("zip source needs a `member`")?;
            let mut zip = zip::ZipArchive::new(File::open(archive)?)?;
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i)?;
                if entry.is_file() && path_matches(entry.name(), member) {
                    let mut out = BufWriter::new(File::create(dest)?);
                    io::copy(&mut entry, &mut out)?;
                    out.flush()?;
                    return Ok(());
                }
            }
            Err(format!("`{member}` not found in archive").into())
        }
        "tar.xz" => {
            let member = spec.member.as_deref().ok_or("tar.xz source needs a `member`")?;
            let reader = liblzma::read::XzDecoder::new(BufReader::new(File::open(archive)?));
            let mut tar = tar::Archive::new(reader);
            for entry in tar.entries()? {
                let mut entry = entry?;
                if !entry.header().entry_type().is_file() {
                    continue;
                }
                let path = entry.path()?.to_string_lossy().into_owned();
                if path_matches(&path, member) {
                    let mut out = BufWriter::new(File::create(dest)?);
                    io::copy(&mut entry, &mut out)?;
                    out.flush()?;
                    return Ok(());
                }
            }
            Err(format!("`{member}` not found in archive").into())
        }
        other => Err(format!("unknown archive kind `{other}`").into()),
    }
}

/// True when `entry` is `member`, or ends with `member` on a path boundary.
///
/// BtbN wraps its builds in a versioned top-level directory
/// (`ffmpeg-n8.1-latest-linux64-gpl-8.1/bin/ffmpeg`) while the macOS zips are
/// flat (`ffmpeg`). Matching on a boundary handles both without the lock file
/// having to encode a strip count per source.
fn path_matches(entry: &str, member: &str) -> bool {
    let entry = entry.replace('\\', "/");
    let entry = entry.trim_start_matches("./");
    entry == member || entry.ends_with(&format!("/{member}"))
}

fn install_atomically(staged: &Path, dest: &Path) -> Res<()> {
    // Rename is atomic, so an interrupted build never leaves a half-written
    // binary in place. Falls back to copy when OUT_DIR is on another mount.
    if fs::rename(staged, dest).is_ok() {
        return Ok(());
    }
    fs::copy(staged, dest)?;
    fs::remove_file(staged)?;
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
