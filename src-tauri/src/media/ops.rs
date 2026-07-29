//! Building the ffmpeg arguments for each tool.
//!
//! These functions are pure: they take a request and a probe result and return
//! a `Plan`. That is deliberate -- it is what makes the argument shapes
//! testable without running anything.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::probe::MediaInfo;
use super::runner::{arg, path_arg, Pass, Plan};
use crate::error::{AppError, AppResult};
use crate::paths;

/// Three words, not numbers. A CRF field would be meaningless to the people
/// this app is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompressPreset {
    Small,
    Balanced,
    High,
}

impl CompressPreset {
    /// Constant Rate Factor: quality-targeted, single pass. Preferred over
    /// two-pass bitrate targeting because it gives better quality per byte and
    /// takes half the time; the only reason to want two-pass is hitting an
    /// exact file size, which is what `target_size_mb` is for.
    fn crf(self) -> u32 {
        match self {
            Self::Small => 30,
            Self::Balanced => 26,
            Self::High => 21,
        }
    }

    fn speed(self) -> &'static str {
        match self {
            Self::Small => "veryfast",
            Self::Balanced => "medium",
            Self::High => "slow",
        }
    }

    fn audio_kbps(self) -> u32 {
        match self {
            Self::Small => 96,
            Self::Balanced => 128,
            Self::High => 192,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressRequest {
    pub input: String,
    pub output_dir: String,
    pub output_name: Option<String>,
    pub preset: CompressPreset,
    /// Advanced escape hatch. Switches to two-pass, which is the only way to
    /// land near a specific size. Covers "fit under 25 MB for Telegram".
    pub target_size_mb: Option<f64>,
    /// Cap the height, for when the source is larger than it needs to be.
    pub max_height: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimRequest {
    pub input: String,
    pub output_dir: String,
    pub output_name: Option<String>,
    pub start_secs: f64,
    pub end_secs: f64,
    /// Re-encode for a frame-accurate cut instead of snapping to a keyframe.
    #[serde(default)]
    pub exact: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertRequest {
    pub input: String,
    pub output_dir: String,
    pub output_name: Option<String>,
    /// mp4 | mkv | mov | webm | mp3 | m4a | wav
    pub format: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeRequest {
    pub input: String,
    pub output_dir: String,
    pub output_name: Option<String>,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GifRequest {
    pub input: String,
    pub output_dir: String,
    pub output_name: Option<String>,
    pub start_secs: f64,
    pub end_secs: f64,
    /// 360p/10fps or 480p/15fps.
    #[serde(default)]
    pub smooth: bool,
}

/// A 30-second 720p GIF is roughly 200 MB. The cap is a guard rail, not a
/// preference.
const MAX_GIF_SECONDS: f64 = 15.0;

fn output_for(dir: &str, name: &Option<String>, input: &Path, ext: &str) -> AppResult<PathBuf> {
    let dir = paths::ensure_dir(dir)?;
    let stem = name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| paths::stem_of(input));
    Ok(paths::unique_output(&dir, &stem, ext))
}

/// Even dimensions: yuv420p subsamples chroma by two, so an odd width or
/// height makes the encoder fail outright. `-2` rounds to the nearest even
/// number while preserving aspect; `-1` does not and is the classic mistake.
fn scale_to_height(height: u32) -> String {
    format!("scale=-2:{height}:flags=lanczos")
}

// -------------------------------------------------------------- compress

pub fn compress(request: &CompressRequest, info: &MediaInfo) -> AppResult<Plan> {
    let input = paths::require_file(&request.input)?;
    if !info.has_video() {
        return Err(AppError::invalid("file", "this tool needs a video"));
    }
    let output = output_for(&request.output_dir, &request.output_name, &input, "mp4")?;
    let duration = Some(info.duration_secs);

    // Small caps at 720p on top of its CRF; the others keep the source size
    // unless the user asked otherwise.
    let height_cap = request.max_height.or(match request.preset {
        CompressPreset::Small => Some(720),
        _ => None,
    });
    let source_height = info.video.as_ref().map(|v| v.height).unwrap_or(0);
    let scale = height_cap
        .filter(|cap| source_height > *cap)
        .map(scale_to_height);

    if let Some(target_mb) = request.target_size_mb {
        return two_pass(request, info, &input, output, target_mb, scale);
    }

    let mut args = vec![arg("-i"), path_arg(&input)];
    if let Some(scale) = scale {
        args.extend([arg("-vf"), scale]);
    }
    args.extend(
        [
            "-c:v", "libx264",
            "-crf", &request.preset.crf().to_string(),
            "-preset", request.preset.speed(),
            "-pix_fmt", "yuv420p",
            // Puts the index at the front so the result starts playing before
            // it has fully downloaded, which is what most people do with these.
            "-movflags", "+faststart",
            "-c:a", "aac",
            "-b:a", &format!("{}k", request.preset.audio_kbps()),
            "-ac", "2",
        ]
        .iter()
        .map(arg),
    );
    args.push(path_arg(&output));

    Ok(Plan {
        passes: vec![Pass { args, duration_secs: duration, label: "compress" }],
        output,
        temp_files: Vec::new(),
    })
}

fn two_pass(
    request: &CompressRequest,
    info: &MediaInfo,
    input: &Path,
    output: PathBuf,
    target_mb: f64,
    scale: Option<String>,
) -> AppResult<Plan> {
    if info.duration_secs <= 0.0 {
        return Err(AppError::invalid("file", "duration unknown, cannot target a size"));
    }

    let audio_kbps = request.preset.audio_kbps() as f64;
    // 3% off the target for container overhead, so the result lands under the
    // limit rather than a hair over it -- the whole point of a target size.
    let budget_kbits = target_mb * 8.0 * 1024.0 * 0.97;
    let video_kbps = (budget_kbits / info.duration_secs) - audio_kbps;
    // Below about 100 kbps the output is unwatchable; better a slightly larger
    // file than a smear.
    let video_kbps = video_kbps.max(100.0).round() as u64;

    let log = std::env::temp_dir().join(format!("mt-2pass-{}", std::process::id()));
    let null = if cfg!(windows) { "NUL" } else { "/dev/null" };

    let mut first = vec![arg("-i"), path_arg(input)];
    let mut second = vec![arg("-i"), path_arg(input)];
    if let Some(scale) = &scale {
        first.extend([arg("-vf"), scale.clone()]);
        second.extend([arg("-vf"), scale.clone()]);
    }

    first.extend(
        [
            "-c:v", "libx264",
            "-b:v", &format!("{video_kbps}k"),
            "-preset", request.preset.speed(),
            "-pass", "1",
            "-passlogfile", &log.to_string_lossy(),
            "-an",
            "-f", "mp4",
        ]
        .iter()
        .map(arg),
    );
    first.push(arg(null));

    second.extend(
        [
            "-c:v", "libx264",
            "-b:v", &format!("{video_kbps}k"),
            "-preset", request.preset.speed(),
            "-pass", "2",
            "-passlogfile", &log.to_string_lossy(),
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-c:a", "aac",
            "-b:a", &format!("{audio_kbps}k"),
            "-ac", "2",
        ]
        .iter()
        .map(arg),
    );
    second.push(path_arg(&output));

    Ok(Plan {
        passes: vec![
            Pass { args: first, duration_secs: Some(info.duration_secs), label: "analyse" },
            Pass { args: second, duration_secs: Some(info.duration_secs), label: "encode" },
        ],
        output,
        temp_files: vec![
            log.with_extension("log"),
            log.with_extension("log.mbtree"),
        ],
    })
}

// ------------------------------------------------------------------ trim

pub fn trim(request: &TrimRequest, info: &MediaInfo) -> AppResult<Plan> {
    let input = paths::require_file(&request.input)?;
    let start = request.start_secs.max(0.0);
    let end = if info.duration_secs > 0.0 {
        request.end_secs.min(info.duration_secs)
    } else {
        request.end_secs
    };
    let duration = end - start;
    if duration <= 0.0 {
        return Err(AppError::invalid("range", "the end must come after the start"));
    }

    let ext = input
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_else(|| "mp4".to_string());
    let ext = if request.exact { "mp4".to_string() } else { ext };
    let output = output_for(&request.output_dir, &request.output_name, &input, &ext)?;

    // -ss before -i is an input seek: ffmpeg jumps straight there instead of
    // decoding from the start.
    let mut args = vec![
        arg("-ss"), arg(format!("{start:.3}")),
        arg("-i"), path_arg(&input),
        // -t, never -to. With -ss ahead of -i, what -to is relative to has
        // varied between ffmpeg versions; a duration is unambiguous.
        arg("-t"), arg(format!("{duration:.3}")),
    ];

    if request.exact {
        args.extend(
            ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
             "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
             "-movflags", "+faststart"].iter().map(arg),
        );
    } else {
        // Stream copy: instant and lossless, but the cut lands on the nearest
        // preceding keyframe, so the clip can start up to a few seconds early.
        // The UI labels this honestly and keeps `exact` one click away.
        args.extend(["-c", "copy", "-map", "0"].iter().map(arg));
    }
    args.extend([arg("-avoid_negative_ts"), arg("make_zero")]);
    args.push(path_arg(&output));

    Ok(Plan {
        passes: vec![Pass { args, duration_secs: Some(duration), label: "trim" }],
        output,
        temp_files: Vec::new(),
    })
}

// --------------------------------------------------------------- convert

/// Whether the source streams can be dropped into the target container
/// untouched. When they can, the conversion is instant and lossless, and the
/// UI says so.
pub fn can_stream_copy(info: &MediaInfo, format: &str) -> bool {
    let video = info.video.as_ref().map(|v| v.codec.as_str());
    let audio = info.audio.as_ref().map(|a| a.codec.as_str());
    match format {
        "mp4" | "mov" => {
            matches!(video, Some("h264") | Some("hevc") | None)
                && matches!(audio, Some("aac") | Some("mp3") | None)
        }
        // Matroska takes essentially anything.
        "mkv" => true,
        _ => false,
    }
}

pub fn convert(request: &ConvertRequest, info: &MediaInfo) -> AppResult<Plan> {
    let input = paths::require_file(&request.input)?;
    let format = request.format.to_ascii_lowercase();
    let output = output_for(&request.output_dir, &request.output_name, &input, &format)?;

    let mut args = vec![arg("-i"), path_arg(&input)];

    match format.as_str() {
        // Picking an audio format IS "extract audio". There is no separate
        // mode and no separate tool -- collapsing those two ideas is the
        // biggest simplification available in this app.
        "mp3" => args.extend(["-vn", "-c:a", "libmp3lame", "-q:a", "2"].iter().map(arg)),
        "m4a" => args.extend(
            ["-vn", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"].iter().map(arg),
        ),
        "wav" => args.extend(["-vn", "-c:a", "pcm_s16le"].iter().map(arg)),
        "webm" => args.extend(
            ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1",
             "-c:a", "libopus", "-b:a", "128k"].iter().map(arg),
        ),
        "mp4" | "mov" | "mkv" => {
            if can_stream_copy(info, &format) {
                args.extend(["-c", "copy"].iter().map(arg));
            } else {
                args.extend(
                    ["-c:v", "libx264", "-crf", "23", "-preset", "medium",
                     "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k"].iter().map(arg),
                );
            }
            args.extend(["-map", "0:v:0?", "-map", "0:a?"].iter().map(arg));
            if format == "mkv" {
                args.extend(["-map", "0:s?", "-c:s", "copy"].iter().map(arg));
            } else {
                // mp4 and mov cannot hold SubRip. Converting is better than
                // failing the whole job over a subtitle track.
                args.extend(["-map", "0:s?", "-c:s", "mov_text"].iter().map(arg));
            }
            if format == "mp4" || format == "mov" {
                args.extend(["-movflags", "+faststart"].iter().map(arg));
            }
        }
        other => return Err(AppError::invalid("format", format!("unsupported: {other}"))),
    }

    args.push(path_arg(&output));

    Ok(Plan {
        passes: vec![Pass {
            args,
            duration_secs: Some(info.duration_secs),
            label: "convert",
        }],
        output,
        temp_files: Vec::new(),
    })
}

// ---------------------------------------------------------------- resize

pub fn resize(request: &ResizeRequest, info: &MediaInfo) -> AppResult<Plan> {
    let input = paths::require_file(&request.input)?;
    let video = info
        .video
        .as_ref()
        .ok_or_else(|| AppError::invalid("file", "this tool needs a video"))?;
    if request.height >= video.height {
        // Upscaling produces a bigger file that looks no better. The UI also
        // disables these options, but a request could still arrive.
        return Err(AppError::invalid("height", "the video is already this small"));
    }
    let output = output_for(&request.output_dir, &request.output_name, &input, "mp4")?;

    let mut args = vec![arg("-i"), path_arg(&input), arg("-vf"), scale_to_height(request.height)];
    args.extend(
        ["-c:v", "libx264", "-crf", "23", "-preset", "medium", "-pix_fmt", "yuv420p",
         // Re-encoding audio for a resize is pure waste; nothing about it changed.
         "-c:a", "copy", "-movflags", "+faststart"].iter().map(arg),
    );
    args.push(path_arg(&output));

    Ok(Plan {
        passes: vec![Pass {
            args,
            duration_secs: Some(info.duration_secs),
            label: "resize",
        }],
        output,
        temp_files: Vec::new(),
    })
}

// ------------------------------------------------------------------- gif

pub fn gif(request: &GifRequest, info: &MediaInfo) -> AppResult<Plan> {
    let input = paths::require_file(&request.input)?;
    if !info.has_video() {
        return Err(AppError::invalid("file", "this tool needs a video"));
    }
    let start = request.start_secs.max(0.0);
    let end = request.end_secs.min(start + MAX_GIF_SECONDS);
    let duration = end - start;
    if duration <= 0.0 {
        return Err(AppError::invalid("range", "the end must come after the start"));
    }

    let (width, fps) = if request.smooth { (480, 15) } else { (360, 10) };
    let output = output_for(&request.output_dir, &request.output_name, &input, "gif")?;
    let palette = std::env::temp_dir().join(format!(
        "mt-palette-{}-{}.png",
        std::process::id(),
        output.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
    ));

    let filters = format!("fps={fps},scale={width}:-1:flags=lanczos");

    // A GIF holds 256 colours. Letting ffmpeg pick them from the actual clip
    // rather than a fixed palette is the difference between a usable result
    // and a banded mess. stats_mode=diff weights colours in the moving parts.
    let palettegen = vec![
        arg("-ss"), arg(format!("{start:.3}")),
        arg("-t"), arg(format!("{duration:.3}")),
        arg("-i"), path_arg(&input),
        arg("-vf"), format!("{filters},palettegen=stats_mode=diff"),
        path_arg(&palette),
    ];

    let paletteuse = vec![
        arg("-ss"), arg(format!("{start:.3}")),
        arg("-t"), arg(format!("{duration:.3}")),
        arg("-i"), path_arg(&input),
        arg("-i"), path_arg(&palette),
        arg("-lavfi"),
        format!("{filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"),
        arg("-loop"), arg("0"),
        path_arg(&output),
    ];

    Ok(Plan {
        passes: vec![
            Pass { args: palettegen, duration_secs: Some(duration), label: "palette" },
            Pass { args: paletteuse, duration_secs: Some(duration), label: "gif" },
        ],
        output,
        temp_files: vec![palette],
    })
}

// -------------------------------------------------------------- estimates

/// Rough output size for the hint under the compress presets.
///
/// Deliberately approximate: it exists so "Small" versus "Balanced" is a
/// decision someone can make without running both.
pub fn estimate_compressed_bytes(info: &MediaInfo, preset: CompressPreset, max_height: Option<u32>) -> u64 {
    let Some(video) = &info.video else {
        return info.size_bytes;
    };
    if info.duration_secs <= 0.0 {
        return info.size_bytes;
    }

    let height = max_height
        .filter(|cap| video.height > *cap)
        .unwrap_or(video.height)
        .max(1) as f64;
    let pixels = height * height * (video.width as f64 / video.height.max(1) as f64);
    let fps = if video.fps > 0.0 { video.fps } else { 30.0 };

    // Bits per pixel per frame, from measured x264 output at each CRF. Rough,
    // but it tracks the right direction and rough magnitude.
    let bpp = match preset {
        CompressPreset::Small => 0.030,
        CompressPreset::Balanced => 0.055,
        CompressPreset::High => 0.110,
    };

    let video_bps = pixels * fps * bpp;
    let audio_bps = preset.audio_kbps() as f64 * 1000.0;
    (((video_bps + audio_bps) * info.duration_secs) / 8.0) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::probe::{AudioStream, VideoStream};

    fn sample(width: u32, height: u32, duration: f64) -> MediaInfo {
        MediaInfo {
            path: "/tmp/in.mp4".into(),
            container: "mov,mp4".into(),
            duration_secs: duration,
            size_bytes: 84 * 1024 * 1024,
            bit_rate: Some(5_000_000),
            video: Some(VideoStream {
                codec: "h264".into(),
                width,
                height,
                fps: 30.0,
                bit_rate: None,
            }),
            audio: Some(AudioStream {
                codec: "aac".into(),
                channels: 2,
                sample_rate: Some(48_000),
                bit_rate: None,
            }),
        }
    }

    fn joined(plan: &Plan, pass: usize) -> String {
        plan.passes[pass].args.join(" ")
    }

    #[test]
    fn scaling_keeps_dimensions_even() {
        // -1 preserves aspect but can produce an odd number, which yuv420p
        // rejects outright. -2 rounds to even.
        let filter = scale_to_height(720);
        assert!(filter.starts_with("scale=-2:720"), "{filter}");
    }

    #[test]
    fn trim_uses_duration_not_end_timestamp() {
        let request = TrimRequest {
            input: "/tmp/in.mp4".into(),
            output_dir: std::env::temp_dir().to_string_lossy().into(),
            output_name: Some("cut".into()),
            start_secs: 10.0,
            end_secs: 25.0,
            exact: false,
        };
        // require_file needs a real file.
        let path = std::env::temp_dir().join("mt-trim-test.mp4");
        std::fs::write(&path, b"x").unwrap();
        let request = TrimRequest { input: path.to_string_lossy().into(), ..request };

        let plan = trim(&request, &sample(1920, 1080, 60.0)).unwrap();
        let args = joined(&plan, 0);
        assert!(args.contains("-ss 10.000"), "{args}");
        assert!(args.contains("-t 15.000"), "{args}");
        assert!(!args.contains("-to"), "-to is ambiguous after -ss: {args}");
        // Fast path is a stream copy.
        assert!(args.contains("-c copy"), "{args}");

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn trim_clamps_the_end_to_the_real_duration() {
        let path = std::env::temp_dir().join("mt-trim-clamp.mp4");
        std::fs::write(&path, b"x").unwrap();
        let request = TrimRequest {
            input: path.to_string_lossy().into(),
            output_dir: std::env::temp_dir().to_string_lossy().into(),
            output_name: Some("cut2".into()),
            start_secs: 0.0,
            end_secs: 9999.0,
            exact: false,
        };
        let plan = trim(&request, &sample(1920, 1080, 60.0)).unwrap();
        assert!(joined(&plan, 0).contains("-t 60.000"), "{}", joined(&plan, 0));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn container_swaps_stream_copy_when_the_codecs_fit() {
        let info = sample(1920, 1080, 60.0);
        assert!(can_stream_copy(&info, "mp4"));
        assert!(can_stream_copy(&info, "mkv"));
        // VP9 in mp4 is not something to hand to a stream copy.
        let mut vp9 = info.clone();
        vp9.video.as_mut().unwrap().codec = "vp9".into();
        assert!(!can_stream_copy(&vp9, "mp4"));
        assert!(can_stream_copy(&vp9, "mkv"));
    }

    #[test]
    fn resize_refuses_to_upscale() {
        let path = std::env::temp_dir().join("mt-resize.mp4");
        std::fs::write(&path, b"x").unwrap();
        let request = ResizeRequest {
            input: path.to_string_lossy().into(),
            output_dir: std::env::temp_dir().to_string_lossy().into(),
            output_name: Some("r".into()),
            height: 1080,
        };
        // Source is already 720 tall.
        assert!(resize(&request, &sample(1280, 720, 10.0)).is_err());
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn resize_copies_the_audio_untouched() {
        let path = std::env::temp_dir().join("mt-resize2.mp4");
        std::fs::write(&path, b"x").unwrap();
        let request = ResizeRequest {
            input: path.to_string_lossy().into(),
            output_dir: std::env::temp_dir().to_string_lossy().into(),
            output_name: Some("r2".into()),
            height: 720,
        };
        let plan = resize(&request, &sample(1920, 1080, 10.0)).unwrap();
        assert!(joined(&plan, 0).contains("-c:a copy"), "{}", joined(&plan, 0));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn gif_is_two_passes_and_capped_in_length() {
        let path = std::env::temp_dir().join("mt-gif.mp4");
        std::fs::write(&path, b"x").unwrap();
        let request = GifRequest {
            input: path.to_string_lossy().into(),
            output_dir: std::env::temp_dir().to_string_lossy().into(),
            output_name: Some("g".into()),
            start_secs: 0.0,
            end_secs: 60.0,
            smooth: false,
        };
        let plan = gif(&request, &sample(1920, 1080, 120.0)).unwrap();
        assert_eq!(plan.passes.len(), 2);
        assert!(joined(&plan, 0).contains("palettegen"));
        assert!(joined(&plan, 1).contains("paletteuse"));
        // Capped at 15 s, not the 60 that was asked for.
        assert!(joined(&plan, 1).contains("-t 15.000"), "{}", joined(&plan, 1));
        // The palette is temporary and must be cleaned up.
        assert_eq!(plan.temp_files.len(), 1);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn audio_formats_drop_the_video_stream() {
        let path = std::env::temp_dir().join("mt-convert.mp4");
        std::fs::write(&path, b"x").unwrap();
        for (format, marker) in [("mp3", "libmp3lame"), ("m4a", "aac"), ("wav", "pcm_s16le")] {
            let request = ConvertRequest {
                input: path.to_string_lossy().into(),
                output_dir: std::env::temp_dir().to_string_lossy().into(),
                output_name: Some(format!("c-{format}")),
                format: format.into(),
            };
            let plan = convert(&request, &sample(1920, 1080, 10.0)).unwrap();
            let args = joined(&plan, 0);
            assert!(args.contains("-vn"), "{format}: {args}");
            assert!(args.contains(marker), "{format}: {args}");
        }
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn estimates_shrink_as_the_preset_gets_smaller() {
        let info = sample(1920, 1080, 134.0);
        let small = estimate_compressed_bytes(&info, CompressPreset::Small, Some(720));
        let balanced = estimate_compressed_bytes(&info, CompressPreset::Balanced, None);
        let high = estimate_compressed_bytes(&info, CompressPreset::High, None);
        assert!(small < balanced, "{small} !< {balanced}");
        assert!(balanced < high, "{balanced} !< {high}");
    }

    #[test]
    fn estimating_an_audio_file_falls_back_to_its_size() {
        let mut audio_only = sample(0, 0, 200.0);
        audio_only.video = None;
        assert_eq!(
            estimate_compressed_bytes(&audio_only, CompressPreset::Balanced, None),
            audio_only.size_bytes
        );
    }
}
