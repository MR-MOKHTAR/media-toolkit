//! Reading media metadata with ffprobe.
//!
//! Every tool screen needs this: the duration bounds a trim range, the
//! resolution decides which resize options make sense, and the size and
//! duration together drive the output estimate.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::binaries::{self, Tool};
use crate::error::{AppError, AppResult};
use crate::process;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub container: String,
    pub duration_secs: f64,
    pub size_bytes: u64,
    pub bit_rate: Option<u64>,
    pub video: Option<VideoStream>,
    pub audio: Option<AudioStream>,
}

impl MediaInfo {
    pub fn has_video(&self) -> bool {
        self.video.is_some()
    }

    pub fn has_audio(&self) -> bool {
        self.audio.is_some()
    }

    /// Source audio bitrate in kbps, when the container reports one. Used to
    /// stop a "compress" from re-encoding upwards.
    pub fn audio_kbps(&self) -> Option<u32> {
        self.audio
            .as_ref()
            .and_then(|a| a.bit_rate)
            .map(|bps| (bps / 1000).max(1) as u32)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStream {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub bit_rate: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStream {
    pub codec: String,
    pub channels: u32,
    pub sample_rate: Option<u32>,
    pub bit_rate: Option<u64>,
}

// ---------------------------------------------------------- ffprobe's shape

#[derive(Deserialize)]
struct Probe {
    format: Option<Format>,
    #[serde(default)]
    streams: Vec<Stream>,
}

#[derive(Deserialize)]
struct Format {
    format_name: Option<String>,
    duration: Option<String>,
    size: Option<String>,
    bit_rate: Option<String>,
    #[serde(default)]
    tags: HashMap<String, String>,
}

#[derive(Deserialize)]
struct Stream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    avg_frame_rate: Option<String>,
    channels: Option<u32>,
    sample_rate: Option<String>,
    bit_rate: Option<String>,
    duration: Option<String>,
    #[serde(default)]
    tags: HashMap<String, String>,
}

// ------------------------------------------------------------------- cache

type CacheKey = (PathBuf, Option<SystemTime>);

fn cache() -> &'static Mutex<HashMap<CacheKey, MediaInfo>> {
    static CACHE: OnceLock<Mutex<HashMap<CacheKey, MediaInfo>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Probes `path`, reusing a previous result while the file's mtime is
/// unchanged. Tool screens probe on every selection and re-probe when
/// switching between tools with the same file loaded.
pub async fn probe(app: &AppHandle, path: &Path) -> AppResult<MediaInfo> {
    let modified = std::fs::metadata(path).ok().and_then(|m| m.modified().ok());
    let key = (path.to_path_buf(), modified);

    if let Some(hit) = cache().lock().unwrap().get(&key).cloned() {
        return Ok(hit);
    }

    let info = probe_uncached(app, path).await?;
    cache().lock().unwrap().insert(key, info.clone());
    Ok(info)
}

async fn probe_uncached(app: &AppHandle, path: &Path) -> AppResult<MediaInfo> {
    let mut cmd = binaries::command(app, Tool::Ffprobe)?;
    cmd.args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "--"]);
    cmd.arg(path);

    let stdout = process::output(cmd, Tool::Ffprobe.name()).await?;
    let probe: Probe = serde_json::from_str(&stdout)
        .map_err(|error| AppError::invalid("file", format!("unreadable media: {error}")))?;

    let video = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"))
        // Cover art in an MP3 is a video stream with no frame rate. Treating it
        // as video would offer to resize an audio file.
        .filter(|s| s.width.unwrap_or(0) > 0 && frame_rate(s) > 0.0);

    let audio = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"));

    let size_bytes = probe
        .format
        .as_ref()
        .and_then(|f| f.size.as_deref())
        .and_then(|s| s.parse().ok())
        .or_else(|| std::fs::metadata(path).ok().map(|m| m.len()))
        .unwrap_or(0);

    Ok(MediaInfo {
        path: path.to_string_lossy().into_owned(),
        container: probe
            .format
            .as_ref()
            .and_then(|f| f.format_name.clone())
            .unwrap_or_default(),
        duration_secs: duration_of(&probe, video.or(audio)),
        size_bytes,
        bit_rate: probe
            .format
            .as_ref()
            .and_then(|f| f.bit_rate.as_deref())
            .and_then(|s| s.parse().ok()),
        video: video.map(|s| VideoStream {
            codec: s.codec_name.clone().unwrap_or_default(),
            width: s.width.unwrap_or(0),
            height: s.height.unwrap_or(0),
            fps: frame_rate(s),
            bit_rate: s.bit_rate.as_deref().and_then(|v| v.parse().ok()),
        }),
        audio: audio.map(|s| AudioStream {
            codec: s.codec_name.clone().unwrap_or_default(),
            channels: s.channels.unwrap_or(0),
            sample_rate: s.sample_rate.as_deref().and_then(|v| v.parse().ok()),
            bit_rate: s.bit_rate.as_deref().and_then(|v| v.parse().ok()),
        }),
    })
}

/// ffprobe reports frame rate as a rational string like "30000/1001", which is
/// 29.97 rather than anything you can parse as a float directly.
fn parse_rational(raw: &str) -> Option<f64> {
    let (num, den) = raw.split_once('/')?;
    let num: f64 = num.trim().parse().ok()?;
    let den: f64 = den.trim().parse().ok()?;
    (den != 0.0).then_some(num / den)
}

fn frame_rate(stream: &Stream) -> f64 {
    stream
        .avg_frame_rate
        .as_deref()
        .and_then(parse_rational)
        .filter(|fps| *fps > 0.0)
        .or_else(|| {
            stream
                .r_frame_rate
                .as_deref()
                .and_then(parse_rational)
                .filter(|fps| *fps > 0.0)
        })
        .unwrap_or(0.0)
}

/// Duration is often missing from `format` on Matroska, and sometimes only
/// present as a `DURATION` tag in `HH:MM:SS.nnnnnnnnn` form.
fn duration_of(probe: &Probe, stream: Option<&Stream>) -> f64 {
    let from_format = probe
        .format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|d| *d > 0.0);
    if let Some(duration) = from_format {
        return duration;
    }

    if let Some(stream) = stream {
        if let Some(duration) = stream
            .duration
            .as_deref()
            .and_then(|d| d.parse::<f64>().ok())
            .filter(|d| *d > 0.0)
        {
            return duration;
        }
        if let Some(duration) = tag_duration(&stream.tags) {
            return duration;
        }
    }

    probe
        .format
        .as_ref()
        .and_then(|f| tag_duration(&f.tags))
        .unwrap_or(0.0)
}

fn tag_duration(tags: &HashMap<String, String>) -> Option<f64> {
    let raw = tags
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("DURATION"))
        .map(|(_, value)| value.as_str())?;

    let mut seconds = 0.0;
    for part in raw.split(':') {
        seconds = seconds * 60.0 + part.trim().parse::<f64>().ok()?;
    }
    (seconds > 0.0).then_some(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ntsc_frame_rates() {
        // 30000/1001 is 29.97. Parsing it as a float would fail outright.
        let fps = parse_rational("30000/1001").unwrap();
        assert!((fps - 29.97).abs() < 0.01, "{fps}");
        assert_eq!(parse_rational("30/1"), Some(30.0));
    }

    #[test]
    fn rejects_the_zero_denominator_ffprobe_uses_for_no_rate() {
        assert_eq!(parse_rational("0/0"), None);
    }

    #[test]
    fn reads_matroska_duration_tags() {
        let mut tags = HashMap::new();
        tags.insert("DURATION".to_string(), "00:02:14.500000000".to_string());
        let seconds = tag_duration(&tags).unwrap();
        assert!((seconds - 134.5).abs() < 0.001, "{seconds}");
    }

    #[test]
    fn duration_tag_lookup_is_case_insensitive() {
        let mut tags = HashMap::new();
        tags.insert("duration".to_string(), "00:00:10".to_string());
        assert_eq!(tag_duration(&tags), Some(10.0));
    }
}
