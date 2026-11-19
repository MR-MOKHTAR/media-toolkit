//! Audio analysis for the "smart trim" waveform, and preview playback plumbing.
//!
//! The file is decoded exactly once, by ffmpeg, to 8 kHz mono signed 16-bit PCM
//! on stdout. That is plenty for a waveform and for finding silences, and it
//! keeps a two-hour recording at ~115 MB/hour of *throughput* while holding
//! only a few small vectors in memory: the PCM is folded into an `Accumulator`
//! chunk by chunk and dropped.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncReadExt;

use crate::binaries::{self, Tool};
use crate::error::{AppError, AppResult};
use crate::jobs::{CancelSignal, Jobs};
use crate::process;

/// Waveform columns handed to the frontend (min/max pairs, so twice as many numbers).
pub const PEAK_COLUMNS: usize = 4000;
pub const DEFAULT_THRESHOLD_DB: f32 = -35.0;
pub const DEFAULT_MIN_SILENCE_SECS: f64 = 0.4;
const SAMPLE_RATE: u32 = 8000;
const FLOOR_DB: f32 = -90.0;
/// Fine-grained buckets are merged pairwise once there are more than this many,
/// so memory stays bounded whatever the file length.
const MAX_BUCKETS: usize = 16384;

pub const PROGRESS_EVENT: &str = "audio-analysis-progress";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Silence {
    pub start_secs: f64,
    pub end_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAnalysis {
    pub duration_secs: f64,
    /// Seconds per RMS window.
    pub window_secs: f64,
    /// Min/max pairs interleaved, values in -1.0..=1.0.
    pub peaks: Vec<f32>,
    /// Per-window RMS in dBFS, floored at -90, rounded to 0.1 dB.
    pub rms_db: Vec<f32>,
    pub peak_db: f32,
    pub mean_rms_db: f32,
    /// Silences at the default threshold and minimum length.
    pub silences: Vec<Silence>,
    pub silence_total_secs: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    token: String,
    percent: f64,
}

// ------------------------------------------------------------ pure core

/// Finds silences in a series of per-window RMS levels.
///
/// The frontend mirrors this exactly, so the rule is deliberately plain: a run
/// of consecutive windows whose `rms_db` is strictly less than `threshold_db`
/// (a window exactly at the threshold is NOT silent), whose length
/// `run_len * window_secs` is at least `min_silence_secs`, becomes one
/// `Silence { start_secs: run_start * window_secs, end_secs: run_end * window_secs }`
/// where `run_end` is the index one past the last silent window. No
/// hysteresis, no padding, no merging. The caller clamps the end to the
/// duration (the last window may be partial).
pub fn detect_silences(
    rms_db: &[f32],
    window_secs: f64,
    threshold_db: f32,
    min_silence_secs: f64,
) -> Vec<Silence> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    let close = |start: usize, end: usize, out: &mut Vec<Silence>| {
        if (end - start) as f64 * window_secs >= min_silence_secs {
            out.push(Silence {
                start_secs: start as f64 * window_secs,
                end_secs: end as f64 * window_secs,
            });
        }
    };
    for (i, &db) in rms_db.iter().enumerate() {
        if db < threshold_db {
            start.get_or_insert(i);
        } else if let Some(s) = start.take() {
            close(s, i, &mut out);
        }
    }
    if let Some(s) = start {
        close(s, rms_db.len(), &mut out);
    }
    out
}

fn to_db(amplitude: f64) -> f32 {
    if amplitude <= 0.0 {
        return FLOOR_DB;
    }
    (20.0 * amplitude.log10()).max(FLOOR_DB as f64) as f32
}

fn round_tenth(db: f32) -> f32 {
    (db * 10.0).round() / 10.0
}

/// Folds PCM chunks into an analysis without ever holding the whole signal.
///
/// Two accumulations run side by side: per-RMS-window sums of squares, and
/// per-bucket min/max. Buckets start at one sample each and are merged pairwise
/// whenever there are too many, so the number of buckets is bounded without
/// needing to know the length in advance -- which matters because the probed
/// duration and the decoded sample count can disagree. At the end buckets are
/// resampled to `PEAK_COLUMNS` columns from the *actual* sample count.
pub struct Accumulator {
    window_samples: usize,
    window_secs: f64,
    // current window
    win_sum: f64,
    win_n: usize,
    rms_db: Vec<f32>,
    // whole file
    total_sq: f64,
    total_n: u64,
    max_abs: u32,
    // buckets
    bucket_size: u64,
    cur_min: i16,
    cur_max: i16,
    cur_n: u64,
    buckets: Vec<(i16, i16)>,
}

impl Accumulator {
    /// `duration_hint_secs` only picks the window size; the result's
    /// `duration_secs` comes from the samples actually seen.
    pub fn new(duration_hint_secs: f64) -> Self {
        let wanted = (duration_hint_secs / 60000.0).max(0.02);
        // A whole number of samples, so windows tile the stream exactly.
        let window_samples = ((wanted * SAMPLE_RATE as f64).round() as usize).max(1);
        Self {
            window_samples,
            window_secs: window_samples as f64 / SAMPLE_RATE as f64,
            win_sum: 0.0,
            win_n: 0,
            rms_db: Vec::new(),
            total_sq: 0.0,
            total_n: 0,
            max_abs: 0,
            bucket_size: 1,
            cur_min: i16::MAX,
            cur_max: i16::MIN,
            cur_n: 0,
            buckets: Vec::new(),
        }
    }

    pub fn feed(&mut self, samples: &[i16]) {
        for &s in samples {
            let v = s as f64;
            let sq = v * v;
            self.win_sum += sq;
            self.win_n += 1;
            self.total_sq += sq;
            self.total_n += 1;
            self.max_abs = self.max_abs.max((s as i32).unsigned_abs());

            self.cur_min = self.cur_min.min(s);
            self.cur_max = self.cur_max.max(s);
            self.cur_n += 1;
            if self.cur_n == self.bucket_size {
                self.push_bucket();
            }
            if self.win_n == self.window_samples {
                self.push_window();
            }
        }
    }

    fn push_bucket(&mut self) {
        self.buckets.push((self.cur_min, self.cur_max));
        self.cur_min = i16::MAX;
        self.cur_max = i16::MIN;
        self.cur_n = 0;
        if self.buckets.len() > MAX_BUCKETS {
            self.buckets = self
                .buckets
                .chunks(2)
                .map(|pair| {
                    let lo = pair.iter().map(|b| b.0).min().unwrap();
                    let hi = pair.iter().map(|b| b.1).max().unwrap();
                    (lo, hi)
                })
                .collect();
            self.bucket_size *= 2;
        }
    }

    fn push_window(&mut self) {
        let rms = (self.win_sum / self.win_n as f64).sqrt() / 32768.0;
        self.rms_db.push(round_tenth(to_db(rms)));
        self.win_sum = 0.0;
        self.win_n = 0;
    }

    pub fn samples(&self) -> u64 {
        self.total_n
    }

    pub fn finish(mut self) -> AudioAnalysis {
        if self.cur_n > 0 {
            self.push_bucket();
        }
        if self.win_n > 0 {
            self.push_window();
        }
        let duration_secs = self.total_n as f64 / SAMPLE_RATE as f64;

        let n = self.buckets.len();
        let columns = n.min(PEAK_COLUMNS);
        let mut peaks = Vec::with_capacity(columns * 2);
        for c in 0..columns {
            let from = c * n / columns;
            let to = ((c + 1) * n / columns).max(from + 1).min(n);
            let lo = self.buckets[from..to].iter().map(|b| b.0).min().unwrap();
            let hi = self.buckets[from..to].iter().map(|b| b.1).max().unwrap();
            peaks.push((lo as f32 / 32768.0).clamp(-1.0, 1.0));
            peaks.push((hi as f32 / 32768.0).clamp(-1.0, 1.0));
        }

        let mean_rms = if self.total_n == 0 {
            0.0
        } else {
            (self.total_sq / self.total_n as f64).sqrt() / 32768.0
        };
        let mut silences = detect_silences(
            &self.rms_db,
            self.window_secs,
            DEFAULT_THRESHOLD_DB,
            DEFAULT_MIN_SILENCE_SECS,
        );
        for s in &mut silences {
            s.end_secs = s.end_secs.min(duration_secs);
        }
        let silence_total_secs = silences.iter().map(|s| s.end_secs - s.start_secs).sum();

        AudioAnalysis {
            duration_secs,
            window_secs: self.window_secs,
            peaks,
            rms_db: self.rms_db,
            peak_db: to_db(self.max_abs as f64 / 32768.0),
            mean_rms_db: to_db(mean_rms),
            silences,
            silence_total_secs,
        }
    }
}

// ------------------------------------------------------- registry & cache

fn registry() -> &'static Mutex<HashMap<String, CancelSignal>> {
    static R: OnceLock<Mutex<HashMap<String, CancelSignal>>> = OnceLock::new();
    R.get_or_init(Default::default)
}

type CacheKey = (PathBuf, Option<SystemTime>, u64);
const CACHE_CAP: usize = 16;

fn cache() -> &'static Mutex<HashMap<CacheKey, Arc<AudioAnalysis>>> {
    static C: OnceLock<Mutex<HashMap<CacheKey, Arc<AudioAnalysis>>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn cache_key(path: &Path) -> CacheKey {
    let meta = std::fs::metadata(path).ok();
    (
        path.to_path_buf(),
        meta.as_ref().and_then(|m| m.modified().ok()),
        meta.map(|m| m.len()).unwrap_or(0),
    )
}

/// Removes the registry entry on every exit path, including early returns.
struct RegistryGuard(String);
impl Drop for RegistryGuard {
    fn drop(&mut self) {
        registry().lock().unwrap().remove(&self.0);
    }
}

// --------------------------------------------------------------- commands

/// Arguments for the single decode pass. Shared with the ignored integration test.
fn decode_args() -> [&'static str; 15] {
    [
        "-hide_banner", "-nostdin", "-loglevel", "error", "-map", "0:a:0", "-vn", "-ac", "1",
        "-ar", "8000", "-f", "s16le", "-y", "-",
    ]
}

/// Streams raw PCM from `child_out` into an accumulator, calling `progress`
/// with a 0..100 percentage. Returns on EOF.
async fn pump<R: tokio::io::AsyncRead + Unpin>(
    mut out: R,
    acc: &mut Accumulator,
    expected_samples: f64,
    mut progress: impl FnMut(f64),
) -> std::io::Result<()> {
    let mut buf = vec![0u8; 64 * 1024];
    // An odd trailing byte from one read belongs with the next.
    let mut carry: Option<u8> = None;
    let mut samples: Vec<i16> = Vec::with_capacity(buf.len() / 2 + 1);
    let mut last = Instant::now() - Duration::from_secs(1);
    loop {
        let n = out.read(&mut buf).await?;
        if n == 0 {
            return Ok(());
        }
        samples.clear();
        let mut bytes = &buf[..n];
        if let Some(lo) = carry.take() {
            samples.push(i16::from_le_bytes([lo, bytes[0]]));
            bytes = &bytes[1..];
        }
        let (pairs, rest) = bytes.as_chunks::<2>();
        if let [b] = rest {
            carry = Some(*b);
        }
        samples.extend(pairs.iter().map(|p| i16::from_le_bytes(*p)));
        acc.feed(&samples);

        if last.elapsed() >= Duration::from_millis(100) && expected_samples > 0.0 {
            last = Instant::now();
            progress((acc.samples() as f64 / expected_samples * 100.0).min(99.0));
        }
    }
}

#[tauri::command]
pub async fn analyze_audio(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    path: String,
    token: String,
) -> AppResult<AudioAnalysis> {
    let file = crate::paths::require_file(&path)?;
    let emit = |percent: f64| {
        let _ = app.emit(PROGRESS_EVENT, Progress { token: token.clone(), percent });
    };

    let key = cache_key(&file);
    if let Some(hit) = cache().lock().unwrap().get(&key).cloned() {
        emit(100.0);
        return Ok((*hit).clone());
    }

    let cancel = CancelSignal::default();
    registry().lock().unwrap().insert(token.clone(), cancel.clone());
    let _registered = RegistryGuard(token.clone());

    // Lane: unknown id, so this only waits for the semaphore; our own signal
    // makes the wait cancellable too.
    let _permit = tokio::select! {
        biased;
        () = cancel.cancelled() => return Err(AppError::Cancelled),
        permit = jobs.acquire_cpu(&token) => permit?,
    };

    let info = crate::media::probe(&app, &file).await?;
    if !info.has_audio() {
        return Err(AppError::invalid("file", "this file has no audio track"));
    }
    let expected = info.duration_secs.max(0.0) * SAMPLE_RATE as f64;

    let mut cmd = binaries::command(&app, Tool::Ffmpeg)?;
    cmd.args(&decode_args()[..4]); // up to -loglevel error
    cmd.arg("-i").arg(&file);
    cmd.args(&decode_args()[4..]);
    let mut running = process::spawn_raw(cmd, Tool::Ffmpeg.name())?;

    let mut acc = Accumulator::new(info.duration_secs);
    // Take stdout out so `running` can still be waited on afterwards.
    let stdout = &mut running.stdout;
    let result = tokio::select! {
        biased;
        () = cancel.cancelled() => None,
        r = pump(stdout, &mut acc, expected, &emit) => Some(r),
    };
    let Some(read) = result else {
        // Dropping `running` kills the tree; kill now so wait() returns promptly.
        process::kill_tree(&mut running.child);
        let _ = running.wait(Tool::Ffmpeg.name()).await;
        return Err(AppError::Cancelled);
    };
    read.map_err(|e| AppError::io(&file, e))?;

    let (status, tail) = running.wait(Tool::Ffmpeg.name()).await?;
    if !status.success() {
        return Err(AppError::Tool {
            tool: Tool::Ffmpeg.name().to_string(),
            code: status.code(),
            tail,
        });
    }

    let analysis = Arc::new(acc.finish());
    {
        let mut cache = cache().lock().unwrap();
        if cache.len() >= CACHE_CAP {
            if let Some(evict) = cache.keys().next().cloned() {
                cache.remove(&evict);
            }
        }
        cache.insert(key, analysis.clone());
    }
    emit(100.0);
    Ok((*analysis).clone())
}

#[tauri::command]
pub async fn cancel_analysis(token: String) -> AppResult<()> {
    if let Some(signal) = registry().lock().unwrap().get(&token) {
        signal.cancel();
    }
    Ok(())
}

/// Whitelists exactly one file for the asset protocol, so the webview can
/// stream it into an `<audio>`/`<video>` element without a broad fs scope.
#[tauri::command]
pub async fn allow_preview(app: AppHandle, path: String) -> AppResult<()> {
    let file = crate::paths::require_file(&path)?;
    app.asset_protocol_scope()
        .allow_file(&file)
        .map_err(|e| AppError::io(&file, e))
}

/// Transcodes the first audio track to a small mono mp3 for browsers that
/// cannot play the original (WebKitGTK is picky about codecs). Named by a hash
/// of (path, mtime) so an unchanged file is transcoded once.
#[tauri::command]
pub async fn make_preview(app: AppHandle, path: String) -> AppResult<String> {
    use std::hash::{Hash, Hasher};
    let file = crate::paths::require_file(&path)?;
    let modified = std::fs::metadata(&file).ok().and_then(|m| m.modified().ok());
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    file.hash(&mut hasher);
    modified.hash(&mut hasher);

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::io("cache dir", e))?
        .join("previews");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::io(&dir, e))?;
    let out = dir.join(format!("preview-{:016x}.mp3", hasher.finish()));

    if !out.is_file() {
        // Written beside the target and renamed, so a half-written file is
        // never mistaken for a finished preview.
        let tmp = out.with_extension("part.mp3");
        let mut cmd = binaries::command(&app, Tool::Ffmpeg)?;
        cmd.args(["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i"]);
        cmd.arg(&file);
        cmd.args(["-vn", "-map", "0:a:0", "-ac", "1", "-b:a", "64k"]);
        cmd.arg(&tmp);
        if let Err(e) = process::output(cmd, Tool::Ffmpeg.name()).await {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        std::fs::rename(&tmp, &out).map_err(|e| AppError::io(&out, e))?;
    }

    app.asset_protocol_scope()
        .allow_file(&out)
        .map_err(|e| AppError::io(&out, e))?;
    Ok(out.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: f64 = 0.1;

    #[test]
    fn no_silence() {
        assert!(detect_silences(&[-10.0; 20], W, -35.0, 0.4).is_empty());
    }

    #[test]
    fn one_in_the_middle() {
        let mut v = vec![-10.0f32; 30];
        for x in &mut v[10..20] {
            *x = -60.0;
        }
        let s = detect_silences(&v, W, -35.0, 0.4);
        assert_eq!(s.len(), 1);
        assert!((s[0].start_secs - 1.0).abs() < 1e-9 && (s[0].end_secs - 2.0).abs() < 1e-9);
    }

    #[test]
    fn leading_and_trailing() {
        let mut v = vec![-60.0f32; 10];
        v.extend([-10.0; 10]);
        v.extend([-60.0; 10]);
        let s = detect_silences(&v, W, -35.0, 0.4);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].start_secs, 0.0);
        assert!((s[1].end_secs - 3.0).abs() < 1e-9);
    }

    #[test]
    fn short_runs_are_ignored() {
        let mut v = vec![-10.0f32; 20];
        for x in &mut v[5..8] {
            *x = -60.0; // 0.3 s < 0.4 s
        }
        assert!(detect_silences(&v, W, -35.0, 0.4).is_empty());
    }

    #[test]
    fn threshold_is_strict() {
        assert!(detect_silences(&[-35.0; 20], W, -35.0, 0.4).is_empty());
        assert_eq!(detect_silences(&[-35.1; 20], W, -35.0, 0.4).len(), 1);
    }

    fn sine(n: usize, offset: usize) -> Vec<i16> {
        (0..n)
            .map(|i| {
                let t = (i + offset) as f64 / SAMPLE_RATE as f64;
                (0.5 * (2.0 * std::f64::consts::PI * 440.0 * t).sin() * 32767.0) as i16
            })
            .collect()
    }

    fn synthetic() -> Vec<i16> {
        let mut s = sine(8000, 0);
        s.extend(vec![0i16; 8000]);
        s.extend(sine(8000, 0));
        s
    }

    #[test]
    fn accumulator_finds_the_gap() {
        let pcm = synthetic();
        let mut acc = Accumulator::new(3.0);
        // Odd chunk sizes, to prove chunk boundaries do not matter.
        for chunk in pcm.chunks(997) {
            acc.feed(chunk);
        }
        let a = acc.finish();
        assert!((a.duration_secs - 3.0).abs() < 1e-6);
        assert_eq!(a.peaks.len(), PEAK_COLUMNS * 2);
        assert!((a.peak_db + 6.0).abs() < 0.2, "peak {}", a.peak_db);
        assert_eq!(a.silences.len(), 1);
        assert!((a.silences[0].start_secs - 1.0).abs() < 0.05);
        assert!((a.silences[0].end_secs - 2.0).abs() < 0.05);
        assert!((a.silence_total_secs - 1.0).abs() < 0.05);
        assert!(a.peaks.iter().all(|p| (-1.0..=1.0).contains(p)));
    }

    #[test]
    fn empty_input_is_quiet_not_a_panic() {
        let a = Accumulator::new(0.0).finish();
        assert_eq!(a.duration_secs, 0.0);
        assert!(a.peaks.is_empty() && a.silences.is_empty());
        assert_eq!(a.peak_db, FLOOR_DB);
    }

    /// End to end with the bundled ffmpeg: generate a wav, run the same decode
    /// arguments, pump the stdout through the accumulator. Needs the binaries
    /// symlink, so ignored by default (`cargo test -- --ignored`).
    #[tokio::test]
    #[ignore]
    async fn decodes_a_real_file() {
        let bins = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let ffmpeg = bins.join("ffmpeg");
        let wav = std::env::temp_dir().join(format!("mt-analyze-{}.wav", std::process::id()));
        let lib = bins.join("lib");

        let mut gen = std::process::Command::new(&ffmpeg);
        gen.env("LD_LIBRARY_PATH", &lib)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=1,apad=pad_dur=1", "-t", "2"])
            .arg(&wav);
        assert!(gen.status().expect("ffmpeg runs").success());

        let mut cmd = std::process::Command::new(&ffmpeg);
        cmd.env("LD_LIBRARY_PATH", &lib);
        cmd.args(&decode_args()[..4]).arg("-i").arg(&wav).args(&decode_args()[4..]);
        let mut running = process::spawn_raw(cmd, "ffmpeg").unwrap();
        let mut acc = Accumulator::new(2.0);
        pump(&mut running.stdout, &mut acc, 16000.0, |_| {}).await.unwrap();
        let (status, _) = running.wait("ffmpeg").await.unwrap();
        assert!(status.success());
        let a = acc.finish();
        let _ = std::fs::remove_file(&wav);
        assert!((a.duration_secs - 2.0).abs() < 0.1);
        assert_eq!(a.silences.len(), 1);
        assert!(a.silences[0].start_secs > 0.9 && a.silences[0].start_secs < 1.2);
    }
}
