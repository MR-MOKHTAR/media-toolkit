//! Building the ffmpeg arguments for each tool.
//!
//! These functions are pure: they take a request and a probe result and return
//! a `Plan`. That is deliberate -- it is what makes the argument shapes
//! testable without running anything.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::probe::{AudioStream, MediaInfo};
use super::runner::{arg, path_arg, Pass, Plan};
use crate::error::{AppError, AppResult};
use crate::paths;

// ------------------------------------------------------------ shared audio

/// The audio codecs the UI offers. One enum for every tool, so the encoder
/// flags live in exactly one place (`audio_args`) and cannot drift apart.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioCodec {
    Aac,
    Opus,
    Mp3,
    Flac,
    Wav,
    Vorbis,
}

impl AudioCodec {
    fn encoder(self) -> &'static str {
        match self {
            Self::Aac => "aac",
            Self::Opus => "libopus",
            Self::Mp3 => "libmp3lame",
            Self::Flac => "flac",
            Self::Wav => "pcm_s16le",
            Self::Vorbis => "libvorbis",
        }
    }

    /// Extension of an audio-only file in this codec.
    fn ext(self) -> &'static str {
        match self {
            Self::Aac => "m4a",
            Self::Opus => "opus",
            Self::Mp3 => "mp3",
            Self::Flac => "flac",
            Self::Wav => "wav",
            Self::Vorbis => "ogg",
        }
    }

    fn is_lossless(self) -> bool {
        matches!(self, Self::Flac | Self::Wav)
    }

    /// The codec an audio-only extension implies (`None` for ones we do not
    /// encode, like ac3).
    fn from_ext(ext: &str) -> Option<Self> {
        match ext {
            "m4a" => Some(Self::Aac),
            "opus" => Some(Self::Opus),
            "mp3" => Some(Self::Mp3),
            "flac" => Some(Self::Flac),
            "wav" => Some(Self::Wav),
            "ogg" => Some(Self::Vorbis),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Channels {
    #[default]
    Auto,
    Mono,
    Stereo,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOpts {
    /// `None` = the tool's default for the target.
    pub codec: Option<AudioCodec>,
    /// `None` = automatic.
    pub bitrate_kbps: Option<u32>,
    #[serde(default)]
    pub channels: Channels,
    /// `None` = keep the source rate (opus excepted, see `resolve_audio`).
    pub sample_rate: Option<u32>,
}

impl AudioOpts {
    /// Whether these options ask for anything that forces a re-encode. A stream
    /// copy cannot change bitrate, channel layout or sample rate.
    fn changes_stream(&self) -> bool {
        self.bitrate_kbps.is_some() || self.sample_rate.is_some() || self.channels != Channels::Auto
    }
}

/// Codecs whose bitrate says nothing about a ceiling, because there is none.
fn source_is_lossless(codec: &str) -> bool {
    codec.starts_with("pcm_")
        || matches!(codec, "flac" | "alac" | "truehd" | "mlp" | "wavpack" | "ape" | "tta")
}

/// Lowest bitrate the lossy encoders are asked for; below this they either
/// refuse the layout or produce something nobody wants to hear.
const MIN_LOSSY_KBPS: u32 = 24;

/// What `audio_args` decided, kept as data so the size estimate and the
/// target-size math can use the *same* bitrate the encoder will get instead of
/// re-deriving it (the old code budgeted the preset's bitrate while encoding
/// something else).
#[derive(Debug, Clone, PartialEq)]
struct AudioPlan {
    codec: AudioCodec,
    /// Constant/average bitrate, when the codec is lossy and one applies.
    kbps: Option<u32>,
    /// libmp3lame / libvorbis `-q:a`, used when no bitrate applies.
    quality: Option<u32>,
    channels: Option<u32>,
    sample_rate: Option<u32>,
}

/// Opus only runs at these rates; ffmpeg errors on anything else.
const OPUS_RATES: [u32; 5] = [48_000, 24_000, 16_000, 12_000, 8_000];

fn resolve_audio(opts: &AudioOpts, default_codec: AudioCodec, source: Option<&AudioStream>) -> AudioPlan {
    let codec = opts.codec.unwrap_or(default_codec);

    // The ceiling only exists when the source is lossy and reports a bitrate:
    // re-encoding a 96k file at 192k makes it bigger and no better.
    let source_kbps = source
        .filter(|s| !source_is_lossless(&s.codec))
        .and_then(|s| s.bit_rate)
        .map(|bps| (bps / 1000).max(1) as u32);
    let clamp = |wanted: u32, floor: u32| match source_kbps {
        Some(src) => wanted.min(src).max(floor),
        None => wanted.max(floor),
    };

    let (kbps, quality) = match codec {
        AudioCodec::Flac | AudioCodec::Wav => (None, None),
        AudioCodec::Aac => (Some(clamp(opts.bitrate_kbps.unwrap_or(160), MIN_LOSSY_KBPS)), None),
        AudioCodec::Opus => (Some(clamp(opts.bitrate_kbps.unwrap_or(128), MIN_LOSSY_KBPS)), None),
        AudioCodec::Mp3 => match (opts.bitrate_kbps, source_kbps) {
            (Some(wanted), _) => (Some(clamp(wanted, MIN_LOSSY_KBPS)), None),
            // VBR q2 averages ~190k; a lossy source below that gets a bitrate
            // instead, so the result cannot outgrow it.
            (None, Some(src)) if src <= 190 => (Some(src.max(MIN_LOSSY_KBPS)), None),
            _ => (None, Some(2)),
        },
        AudioCodec::Vorbis => match opts.bitrate_kbps {
            Some(wanted) => (Some(clamp(wanted, 32)), None),
            None => (None, Some(5)),
        },
    };

    let source_channels = source.map(|s| s.channels).unwrap_or(0);
    let channels = match opts.channels {
        // Mono stays mono, stereo stays stereo, surround is folded to stereo.
        Channels::Auto => (source_channels > 2).then_some(2),
        Channels::Mono => Some(1),
        // Never upmix: a mono source asked for "stereo" stays mono.
        Channels::Stereo => (source_channels >= 2).then_some(2),
    };

    let sample_rate = opts.sample_rate.map(|rate| {
        if codec == AudioCodec::Opus && !OPUS_RATES.contains(&rate) {
            48_000
        } else {
            rate
        }
    });

    AudioPlan { codec, kbps, quality, channels, sample_rate }
}

/// Bitrate the plan spends, for budgets and estimates. VBR and lossless have no
/// fixed bitrate, so a typical figure stands in.
fn plan_kbps(plan: &AudioPlan, source: Option<&AudioStream>) -> u32 {
    if let Some(kbps) = plan.kbps {
        return kbps;
    }
    match plan.codec {
        AudioCodec::Mp3 => 190,
        AudioCodec::Vorbis => 160,
        AudioCodec::Flac | AudioCodec::Wav => {
            let channels = plan.channels.or(source.map(|s| s.channels)).unwrap_or(2).max(1);
            let rate = plan.sample_rate.or(source.and_then(|s| s.sample_rate)).unwrap_or(44_100);
            let pcm = rate * channels * 16 / 1000;
            if plan.codec == AudioCodec::Flac { pcm * 6 / 10 } else { pcm }
        }
        _ => 128,
    }
}

/// The encoder arguments for one audio output. The only place they are written.
///
/// Container flags (`+faststart` for m4a/mp4) are the caller's business.
pub fn audio_args(opts: &AudioOpts, default_codec: AudioCodec, source: Option<&AudioStream>) -> Vec<String> {
    audio_args_from(&resolve_audio(opts, default_codec, source))
}

fn audio_args_from(plan: &AudioPlan) -> Vec<String> {
    let mut args = vec![arg("-c:a"), arg(plan.codec.encoder())];
    match plan.codec {
        AudioCodec::Flac => args.extend([arg("-compression_level"), arg("5")]),
        AudioCodec::Wav => {}
        _ => {
            if let Some(kbps) = plan.kbps {
                args.extend([arg("-b:a"), format!("{kbps}k")]);
            } else if let Some(q) = plan.quality {
                args.extend([arg("-q:a"), q.to_string()]);
            }
        }
    }
    if let Some(channels) = plan.channels {
        args.extend([arg("-ac"), channels.to_string()]);
    }
    if let Some(rate) = plan.sample_rate {
        args.extend([arg("-ar"), rate.to_string()]);
    }
    args
}

// ------------------------------------------------------------ video options

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoCodec {
    H264,
    H265,
    Av1,
}

/// Quality word for a converter re-encode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Same,
    #[default]
    High,
    Balanced,
    Small,
}

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
    ///
    /// Each codec has its own scale: the same number means very different
    /// quality in x264, x265 and SVT-AV1, so the values are matched by look.
    fn crf(self, codec: VideoCodec) -> u32 {
        match (codec, self) {
            (VideoCodec::H264, Self::Small) => 30,
            (VideoCodec::H264, Self::Balanced) => 26,
            (VideoCodec::H264, Self::High) => 21,
            (VideoCodec::H265, Self::Small) => 32,
            (VideoCodec::H265, Self::Balanced) => 28,
            (VideoCodec::H265, Self::High) => 23,
            (VideoCodec::Av1, Self::Small) => 42,
            (VideoCodec::Av1, Self::Balanced) => 36,
            (VideoCodec::Av1, Self::High) => 30,
        }
    }

    fn speed(self) -> &'static str {
        match self {
            Self::Small => "veryfast",
            Self::Balanced => "medium",
            Self::High => "slow",
        }
    }

    /// SVT-AV1 takes a number, not a name; higher is faster.
    fn av1_preset(self) -> &'static str {
        match self {
            Self::Small => "10",
            Self::Balanced => "8",
            Self::High => "6",
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

// ---------------------------------------------------------------- requests

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
    /// Overrides the preset's audio.
    #[serde(default)]
    pub audio: Option<AudioOpts>,
    /// Default h264. Ignored by target-size mode, which is x264 only.
    #[serde(default)]
    pub video_codec: Option<VideoCodec>,
    /// Frame-rate cap; only applied when the source is faster.
    #[serde(default)]
    pub max_fps: Option<u32>,
    #[serde(default)]
    pub drop_audio: bool,
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
    /// "Remove silences": the segments to keep, `[start, end]` seconds. When
    /// present and non-empty, `start_secs`/`end_secs` are ignored.
    #[serde(default)]
    pub keep: Option<Vec<[f64; 2]>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertRequest {
    pub input: String,
    pub output_dir: String,
    pub output_name: Option<String>,
    /// video: mp4 | mkv | mov | webm | avi; audio: mp3 | m4a | opus | ogg |
    /// flac | wav | aiff; animation: gif | webp
    pub format: String,
    #[serde(default)]
    pub audio: Option<AudioOpts>,
    #[serde(default)]
    pub quality: Option<Quality>,
    #[serde(default)]
    pub max_height: Option<u32>,
    /// gif/webp output width.
    #[serde(default)]
    pub width: Option<u32>,
    /// gif/webp frame rate; a frame-rate cap for video targets.
    #[serde(default)]
    pub fps: Option<u32>,
    #[serde(default)]
    pub start_secs: Option<f64>,
    #[serde(default)]
    pub end_secs: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractAudioRequest {
    pub input: String,
    pub output_dir: String,
    pub output_name: Option<String>,
    /// mp3 | m4a | opus | ogg | flac | wav, or `original` to lift the track out
    /// untouched.
    pub format: String,
    #[serde(default)]
    pub audio: Option<AudioOpts>,
    /// Index into `MediaInfo.audio_streams`; default 0.
    #[serde(default)]
    pub stream_index: Option<usize>,
}

/// The value the extract-audio screen sends for "leave the track alone".
///
/// Not a format name, because which format comes out is the file's answer and
/// not the user's -- see `copy_audio_ext`.
const ORIGINAL: &str = "original";

/// The job's output path, claimed for as long as the plan lives -- see
/// `paths::OutputClaim` for the overwrite this prevents.
fn output_for(
    dir: &str,
    name: &Option<String>,
    input: &Path,
    ext: &str,
) -> AppResult<paths::OutputClaim> {
    let dir = paths::ensure_dir(dir)?;
    let stem = name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| paths::stem_of(input));
    Ok(paths::claim_output(&dir, &stem, ext))
}

/// Even dimensions: yuv420p subsamples chroma by two, so an odd width or
/// height makes the encoder fail outright. `-2` rounds to the nearest even
/// number while preserving aspect; `-1` does not and is the classic mistake.
fn scale_to_height(height: u32) -> String {
    format!("scale=-2:{height}:flags=lanczos")
}

/// Every audio stream in the file, falling back to `audio` for a probe result
/// that only filled the single-stream field.
fn audio_list(info: &MediaInfo) -> Vec<&AudioStream> {
    if info.audio_streams.is_empty() {
        info.audio.iter().collect()
    } else {
        info.audio_streams.iter().collect()
    }
}

/// `-vf` value combining an fps cap and a height cap in one filter chain, or
/// `None` when neither applies. Order matters for speed: dropping frames first
/// means the scaler touches fewer of them.
fn video_filter(info: &MediaInfo, max_height: Option<u32>, max_fps: Option<u32>) -> Option<String> {
    let mut parts = Vec::new();
    if fps_cap_applies(info, max_fps) {
        parts.push(format!("fps={}", max_fps.unwrap_or(0)));
    }
    let source_height = info.video.as_ref().map(|v| v.height).unwrap_or(0);
    if let Some(cap) = max_height.filter(|cap| source_height > *cap) {
        parts.push(scale_to_height(cap));
    }
    (!parts.is_empty()).then(|| parts.join(","))
}

fn fps_cap_applies(info: &MediaInfo, max_fps: Option<u32>) -> bool {
    match (max_fps, info.video.as_ref()) {
        (Some(cap), Some(video)) => cap > 0 && video.fps > cap as f64 + 0.01,
        _ => false,
    }
}

// -------------------------------------------------------------- compress

/// Target audio bitrate for a preset, guaranteed to shrink the file.
///
/// Re-encoding a 128k MP3 at the High preset's 192k produces a file half again
/// as large, which is the exact opposite of what a tool called "compress"
/// promises. Clamping to the source bitrate is not enough either: measured on a
/// 30s 96k MP3, re-encoding at the same 96k came out 1.6% *bigger*, because the
/// bitrate is only the audio payload and M4A adds its own container overhead.
///
/// So the ceiling is three quarters of the source. That also happens to be
/// roughly where AAC matches MP3 perceptually -- AAC is the more efficient
/// codec -- so the guarantee costs very little quality.
fn audio_target_kbps(preset: CompressPreset, info: &MediaInfo) -> u32 {
    let wanted = preset.audio_kbps();
    match info.audio_kbps() {
        // 32k is about where AAC stops being listenable, so never go under it
        // even if the source is lower -- at that point the file is tiny anyway.
        Some(source) => wanted.min((source * 3 / 4).max(32)),
        // No reported bitrate: trust the preset. Lossless sources (WAV, FLAC)
        // land here and always shrink anyway.
        None => wanted,
    }
}

/// The audio options a *video* compression uses.
///
/// Defaults to AAC at the preset's bitrate. A user-chosen codec is honoured when
/// MP4 can hold it; FLAC, WAV and Vorbis cannot go in an MP4 sensibly, so they
/// fall back to AAC rather than failing the job. An unset bitrate takes the
/// preset's, so "Small" stays small whichever codec was picked.
fn video_audio_opts(audio: &Option<AudioOpts>, preset: CompressPreset) -> AudioOpts {
    let mut opts = audio.clone().unwrap_or_default();
    if !matches!(opts.codec, Some(AudioCodec::Aac | AudioCodec::Opus | AudioCodec::Mp3)) {
        opts.codec = Some(AudioCodec::Aac);
    }
    if opts.bitrate_kbps.is_none() {
        opts.bitrate_kbps = Some(preset.audio_kbps());
    }
    opts
}

/// The audio options an *audio-only* compression uses (bitrate resolved).
fn audio_only_opts(audio: &Option<AudioOpts>, preset: CompressPreset, info: &MediaInfo) -> AudioOpts {
    let mut opts = audio.clone().unwrap_or_default();
    if opts.bitrate_kbps.is_none() && !opts.codec.is_some_and(AudioCodec::is_lossless) {
        opts.bitrate_kbps = Some(audio_target_kbps(preset, info));
    }
    opts
}

pub fn compress(request: &CompressRequest, info: &MediaInfo) -> AppResult<Plan> {
    let input = paths::require_file(&request.input)?;

    // Audio-only input is a legitimate thing to compress, and the file picker
    // has always offered audio extensions. Requiring a video stream here meant
    // the app handed the user an MP3 it then refused.
    if !info.has_video() {
        if !info.has_audio() {
            return Err(AppError::invalid("file", "no audio or video stream"));
        }
        return compress_audio(request, info, &input);
    }

    let claim = output_for(&request.output_dir, &request.output_name, &input, "mp4")?;

    // The request is the only thing that decides resolution. The Small preset
    // used to cap itself at 720p here, which was invisible from the screen and
    // fought with the resolution control that replaced the resize tool: picking
    // "original" still handed back 720p.
    let filter = video_filter(info, request.max_height, request.max_fps);

    // Audio settings, resolved against the first track so the clamp to the
    // source bitrate applies.
    let audio_plan = resolve_audio(
        &video_audio_opts(&request.audio, request.preset),
        AudioCodec::Aac,
        info.audio.as_ref(),
    );

    if let Some(target_mb) = request.target_size_mb {
        return two_pass(request, info, &input, claim, target_mb, filter, &audio_plan);
    }

    let codec = request.video_codec.unwrap_or(VideoCodec::H264);
    let preset = request.preset;
    let output = claim.path().to_path_buf();
    let mut args = vec![arg("-i"), path_arg(&input)];
    if let Some(filter) = filter {
        args.extend([arg("-vf"), filter]);
    }
    let crf = preset.crf(codec).to_string();
    match codec {
        VideoCodec::H264 => {
            args.extend(["-c:v", "libx264", "-crf", &crf, "-preset", preset.speed()].iter().map(arg))
        }
        // hvc1 is the tag Apple players need; ffmpeg's default hev1 will not
        // play in QuickTime or Safari.
        VideoCodec::H265 => args.extend(
            ["-c:v", "libx265", "-crf", &crf, "-preset", preset.speed(), "-tag:v", "hvc1"]
                .iter()
                .map(arg),
        ),
        VideoCodec::Av1 => args.extend(
            ["-c:v", "libsvtav1", "-crf", &crf, "-preset", preset.av1_preset()].iter().map(arg),
        ),
    }
    args.extend(
        [
            "-pix_fmt", "yuv420p",
            // Puts the index at the front so the result starts playing before
            // it has fully downloaded, which is what most people do with these.
            "-movflags", "+faststart",
        ]
        .iter()
        .map(arg),
    );
    if request.drop_audio {
        args.push(arg("-an"));
    } else {
        args.extend(audio_args_from(&audio_plan));
    }
    args.push(path_arg(&output));

    Ok(Plan {
        passes: vec![Pass { args, duration_secs: Some(info.duration_secs), label: "compress" }],
        output,
        temp_files: Vec::new(),
        claim: Some(claim),
    })
}

/// Audio-only compression: re-encode to a lower bitrate.
///
/// Single pass regardless of `target_size_mb`. Two-pass exists to let x264
/// distribute a bitrate budget across frames, which means nothing without a
/// video stream; for audio, a target size is just a bitrate, so it is solved
/// arithmetically instead.
fn compress_audio(
    request: &CompressRequest,
    info: &MediaInfo,
    input: &Path,
) -> AppResult<Plan> {
    let mut opts = audio_only_opts(&request.audio, request.preset, info);
    let codec = opts.codec.unwrap_or(AudioCodec::Aac);

    match request.target_size_mb {
        Some(target_mb) if info.duration_secs > 0.0 && !codec.is_lossless() => {
            let budget_kbits = target_mb * 8.0 * 1024.0 * 0.97;
            // 32k is about where AAC stops being listenable.
            opts.bitrate_kbps = Some(((budget_kbits / info.duration_secs).round() as u32).max(32));
        }
        Some(_) => {}
        None => {
            // A source already at or below the floor has nothing left to give:
            // measured, a 32k MP3 re-encoded at 32k AAC came out 5% larger on
            // container overhead. Saying so beats handing back a bigger file
            // from a button labelled "compress". Only when the user asked for
            // nothing specific: an explicit bitrate or another codec is an
            // instruction, not a hope of shrinking.
            let asked = request.audio.as_ref();
            let explicit_bitrate = asked.is_some_and(|a| a.bitrate_kbps.is_some());
            let codec_unchanged = asked.and_then(|a| a.codec).is_none_or(|c| c == AudioCodec::Aac);
            if !explicit_bitrate
                && codec_unchanged
                && info.audio_kbps().is_some_and(|source| opts.bitrate_kbps.unwrap_or(0) >= source)
            {
                return Err(AppError::invalid("file", "already at its smallest"));
            }
        }
    }

    let claim = output_for(&request.output_dir, &request.output_name, input, codec.ext())?;
    let output = claim.path().to_path_buf();

    let mut args = vec![
        arg("-i"),
        path_arg(input),
        // Drops cover art as well as video. Without it a podcast's embedded
        // artwork gets re-encoded as a one-frame video stream.
        arg("-vn"),
    ];
    args.extend(audio_args(&opts, AudioCodec::Aac, info.audio.as_ref()));
    if codec == AudioCodec::Aac {
        args.extend([arg("-movflags"), arg("+faststart")]);
    }
    args.push(path_arg(&output));

    Ok(Plan {
        passes: vec![Pass {
            args,
            duration_secs: Some(info.duration_secs),
            label: "compress",
        }],
        output,
        temp_files: Vec::new(),
        claim: Some(claim),
    })
}

/// Video bitrate (kbps) that makes the finished file land at `target_mb`.
///
/// 3% comes off the target for container overhead, so the result lands under
/// the limit rather than a hair over it -- the whole point of a target size.
/// Below about 100 kbps the output is unwatchable; better a slightly larger
/// file than a smear.
pub fn target_video_kbps(target_mb: f64, duration: f64, audio_kbps: u32) -> f64 {
    let budget_kbits = target_mb * 8.0 * 1024.0 * 0.97;
    ((budget_kbits / duration) - audio_kbps as f64).max(100.0)
}

/// Two-pass is a libx264 feature in this app: x264's pass/stats flow is the one
/// the rate-control math here was tuned for, so `video_codec` is deliberately
/// ignored in this mode.
fn two_pass(
    request: &CompressRequest,
    info: &MediaInfo,
    input: &Path,
    claim: paths::OutputClaim,
    target_mb: f64,
    filter: Option<String>,
    audio_plan: &AudioPlan,
) -> AppResult<Plan> {
    let output = claim.path().to_path_buf();
    if info.duration_secs <= 0.0 {
        return Err(AppError::invalid("file", "duration unknown, cannot target a size"));
    }

    // The bitrate the encoder will really get, not the preset's: the two used
    // to differ once the source clamp existed, and the budget came out wrong.
    let with_audio = info.has_audio() && !request.drop_audio;
    let audio_kbps = if with_audio { plan_kbps(audio_plan, info.audio.as_ref()) } else { 0 };
    let video_kbps = target_video_kbps(target_mb, info.duration_secs, audio_kbps).round() as u64;

    // One prefix per job, not per process. With the process id alone, two
    // target-size compressions running side by side -- the CPU lane allows up to
    // three -- wrote their first-pass statistics into the same file, and each
    // second pass then read a log that described the other video.
    let log = std::env::temp_dir().join(format!(
        "mt-2pass-{}-{}",
        std::process::id(),
        crate::jobs::new_id()
    ));
    let null = if cfg!(windows) { "NUL" } else { "/dev/null" };

    let mut first = vec![arg("-i"), path_arg(input)];
    let mut second = vec![arg("-i"), path_arg(input)];
    if let Some(filter) = &filter {
        first.extend([arg("-vf"), filter.clone()]);
        second.extend([arg("-vf"), filter.clone()]);
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
        ]
        .iter()
        .map(arg),
    );
    if with_audio {
        second.extend(audio_args_from(audio_plan));
    } else {
        second.push(arg("-an"));
    }
    second.push(path_arg(&output));

    Ok(Plan {
        passes: vec![
            Pass { args: first, duration_secs: Some(info.duration_secs), label: "analyse" },
            Pass { args: second, duration_secs: Some(info.duration_secs), label: "encode" },
        ],
        output,
        temp_files: two_pass_logs(&log),
        claim: Some(claim),
    })
}

/// The files a two-pass encode leaves behind for `-passlogfile <prefix>`.
///
/// ffmpeg appends the output stream's index -- `<prefix>-0.log`, not
/// `<prefix>.log` -- and x264 keeps its macroblock tree beside that, writing both
/// under a `.temp` name until the pass ends. The list used to name
/// `<prefix>.log`, which ffmpeg never writes, so every target-size compression
/// left its statistics in the temp directory for good, and a cancelled one left
/// the `.temp` pair as well.
fn two_pass_logs(prefix: &Path) -> Vec<PathBuf> {
    let base = prefix.to_string_lossy();
    ["-0.log", "-0.log.mbtree", "-0.log.temp", "-0.log.mbtree.temp"]
        .iter()
        .map(|suffix| PathBuf::from(format!("{base}{suffix}")))
        .collect()
}

// ------------------------------------------------------------------ trim

/// Most segments "remove silences" accepts. Each adds a `between()` term to
/// the filter expression; 400 of them stay around 15 KB, comfortably inline on
/// every platform's argv limit, so no filter-script file is needed.
const MAX_KEEP_SEGMENTS: usize = 400;

/// Validates the keep list: sorted, non-overlapping, clamped to the duration,
/// zero-length segments dropped.
fn clean_segments(keep: &[[f64; 2]], duration: f64) -> AppResult<Vec<[f64; 2]>> {
    if keep.len() > MAX_KEEP_SEGMENTS {
        return Err(AppError::invalid(
            "keep",
            format!("too many segments ({} > {MAX_KEEP_SEGMENTS})", keep.len()),
        ));
    }
    let mut cleaned: Vec<[f64; 2]> = Vec::new();
    let mut previous_end = 0.0_f64;
    for [start, end] in keep.iter().copied() {
        if !start.is_finite() || !end.is_finite() || end < start {
            return Err(AppError::invalid("keep", "each segment needs start <= end"));
        }
        if start < previous_end - 1e-6 {
            return Err(AppError::invalid("keep", "segments must be sorted and must not overlap"));
        }
        previous_end = previous_end.max(end);
        let start = start.max(0.0);
        let end = if duration > 0.0 { end.min(duration) } else { end };
        if end - start > 0.001 {
            cleaned.push([start, end]);
        }
    }
    if cleaned.is_empty() {
        return Err(AppError::invalid("keep", "nothing left to keep"));
    }
    Ok(cleaned)
}

/// The audio family a "re-encode to match the source" should use: aac->m4a,
/// mp3->mp3, opus->opus, vorbis->ogg, flac->flac, pcm->wav, falling back to AAC
/// in m4a for anything else.
fn source_family(info: &MediaInfo) -> AudioCodec {
    copy_audio_ext(info).and_then(AudioCodec::from_ext).unwrap_or(AudioCodec::Aac)
}

pub fn trim(request: &TrimRequest, info: &MediaInfo) -> AppResult<Plan> {
    let input = paths::require_file(&request.input)?;

    if let Some(keep) = request.keep.as_ref().filter(|k| !k.is_empty()) {
        return trim_keep(request, info, &input, keep);
    }

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
    // An exact cut re-encodes. For video that lands in MP4/x264/AAC; for an
    // audio file it must stay audio, in the source's own family -- it used to
    // turn an MP3 into a video-container .mp4.
    let audio_only = !info.has_video();
    let family = source_family(info);
    let ext = match (request.exact, audio_only) {
        (true, true) => family.ext().to_string(),
        (true, false) => "mp4".to_string(),
        _ => ext,
    };
    let claim = output_for(&request.output_dir, &request.output_name, &input, &ext)?;
    let output = claim.path().to_path_buf();

    // -ss before -i is an input seek: ffmpeg jumps straight there instead of
    // decoding from the start.
    let mut args = vec![
        arg("-ss"), arg(format!("{start:.3}")),
        arg("-i"), path_arg(&input),
        // -t, never -to. With -ss ahead of -i, what -to is relative to has
        // varied between ffmpeg versions; a duration is unambiguous.
        arg("-t"), arg(format!("{duration:.3}")),
    ];

    if request.exact && audio_only {
        args.push(arg("-vn"));
        args.extend(audio_args(&AudioOpts::default(), family, info.audio.as_ref()));
        if family == AudioCodec::Aac {
            args.extend([arg("-movflags"), arg("+faststart")]);
        }
    } else if request.exact {
        args.extend(
            ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
                .iter()
                .map(arg),
        );
        args.extend(audio_args(&AudioOpts::default(), AudioCodec::Aac, info.audio.as_ref()));
        args.extend([arg("-movflags"), arg("+faststart")]);
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
        claim: Some(claim),
    })
}

/// "Remove silences": keep only the listed segments and glue them together.
///
/// Always a re-encode, because the cuts fall between keyframes. `select` /
/// `aselect` drop everything outside the segments and `setpts`/`asetpts`
/// renumber what is left so there are no gaps. The progress denominator is the
/// kept duration, since that is how much media the encoder will produce.
fn trim_keep(
    request: &TrimRequest,
    info: &MediaInfo,
    input: &Path,
    keep: &[[f64; 2]],
) -> AppResult<Plan> {
    let segments = clean_segments(keep, info.duration_secs)?;
    let kept: f64 = segments.iter().map(|[a, b]| b - a).sum();
    let expr = segments
        .iter()
        .map(|[a, b]| format!("between(t,{a:.3},{b:.3})"))
        .collect::<Vec<_>>()
        .join("+");

    let has_video = info.has_video();
    if !has_video && !info.has_audio() {
        return Err(AppError::invalid("file", "no audio or video stream"));
    }
    let family = source_family(info);
    let ext = if has_video { "mp4" } else { family.ext() };
    let claim = output_for(&request.output_dir, &request.output_name, input, ext)?;
    let output = claim.path().to_path_buf();

    let mut args = vec![arg("-i"), path_arg(input)];
    if has_video {
        args.extend([arg("-vf"), format!("select='{expr}',setpts=N/FRAME_RATE/TB")]);
    } else {
        args.push(arg("-vn"));
    }
    if info.has_audio() {
        args.extend([arg("-af"), format!("aselect='{expr}',asetpts=N/SR/TB")]);
    }
    if has_video {
        args.extend(
            ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
                .iter()
                .map(arg),
        );
        args.extend(audio_args(&AudioOpts::default(), AudioCodec::Aac, info.audio.as_ref()));
        args.extend([arg("-movflags"), arg("+faststart")]);
    } else {
        args.extend(audio_args(&AudioOpts::default(), family, info.audio.as_ref()));
        if family == AudioCodec::Aac {
            args.extend([arg("-movflags"), arg("+faststart")]);
        }
    }
    args.push(path_arg(&output));

    Ok(Plan {
        passes: vec![Pass { args, duration_secs: Some(kept), label: "trim" }],
        output,
        temp_files: Vec::new(),
        claim: Some(claim),
    })
}

// --------------------------------------------------------------- convert

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamAction {
    Copy,
    Encode,
    None,
}

/// What a conversion will do, for the UI's "instant / re-encoding" badge.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertPreview {
    pub video: StreamAction,
    pub audio: StreamAction,
    pub dropped_subtitles: u32,
}

/// How subtitles are carried into the target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SubMode {
    /// Copy every subtitle stream.
    Copy,
    /// Convert text subtitles to this codec, drop bitmap ones.
    Text(&'static str),
    /// The container has no subtitle support.
    None,
}

const VIDEO_FORMATS: [&str; 5] = ["mp4", "mkv", "mov", "webm", "avi"];
const AUDIO_FORMATS: [&str; 7] = ["mp3", "m4a", "opus", "ogg", "flac", "wav", "aiff"];

type CodecList = &'static [&'static str];

/// Which source codecs each container may carry untouched. Conservative on
/// purpose: a codec that is "technically allowed" but unplayable in common
/// players is better re-encoded than copied. `None` means anything (Matroska).
fn container_codecs(format: &str) -> Option<(CodecList, CodecList)> {
    match format {
        "mp4" => Some((
            &["h264", "hevc", "av1", "mpeg4"],
            &["aac", "mp3", "ac3", "eac3", "alac", "opus", "flac"],
        )),
        "mov" => Some((
            &["h264", "hevc", "mpeg4", "prores"],
            &["aac", "mp3", "alac", "pcm_s16le", "pcm_s24le"],
        )),
        "webm" => Some((&["vp8", "vp9", "av1"], &["opus", "vorbis"])),
        "avi" => Some((&["mpeg4", "h264", "mjpeg"], &["mp3", "ac3", "pcm_s16le"])),
        _ => None,
    }
}

fn sub_mode(format: &str) -> SubMode {
    match format {
        "mkv" => SubMode::Copy,
        "mp4" | "mov" => SubMode::Text("mov_text"),
        "webm" => SubMode::Text("webvtt"),
        _ => SubMode::None,
    }
}

/// Whether a source track already is what the audio target would encode.
fn audio_target_copies(format: &str, codec: &str) -> bool {
    matches!(
        (format, codec),
        ("m4a", "aac")
            | ("mp3", "mp3")
            | ("opus", "opus")
            | ("ogg", "vorbis")
            | ("flac", "flac")
            | ("wav", "pcm_s16le")
            | ("aiff", "pcm_s16be")
    )
}

/// The one decision function: `convert` builds arguments from it and the UI
/// badge reads it, so they cannot disagree.
pub fn convert_preview(
    format: &str,
    audio: Option<&AudioOpts>,
    max_height: Option<u32>,
    fps: Option<u32>,
    info: &MediaInfo,
) -> AppResult<ConvertPreview> {
    let format = format.to_ascii_lowercase();
    let changed = audio.is_some_and(AudioOpts::changes_stream);
    let tracks = audio_list(info);

    if AUDIO_FORMATS.contains(&format.as_str()) {
        let Some(first) = tracks.first() else {
            return Err(AppError::invalid("file", "no audio stream"));
        };
        let copy = !changed && audio_target_copies(&format, &first.codec);
        return Ok(ConvertPreview {
            video: StreamAction::None,
            audio: if copy { StreamAction::Copy } else { StreamAction::Encode },
            dropped_subtitles: 0,
        });
    }
    if format == "gif" || format == "webp" {
        if !info.has_video() {
            return Err(AppError::invalid("file", "this format needs a video"));
        }
        return Ok(ConvertPreview {
            video: StreamAction::Encode,
            audio: StreamAction::None,
            dropped_subtitles: 0,
        });
    }
    if !VIDEO_FORMATS.contains(&format.as_str()) {
        return Err(AppError::invalid("format", format!("unsupported: {format}")));
    }

    let allowed = container_codecs(&format);
    let video = match info.video.as_ref() {
        None => StreamAction::None,
        Some(v) => {
            let fits = allowed.is_none_or(|(codecs, _)| codecs.contains(&v.codec.as_str()));
            if fits && video_filter(info, max_height, fps).is_none() {
                StreamAction::Copy
            } else {
                StreamAction::Encode
            }
        }
    };
    let audio_action = if tracks.is_empty() {
        StreamAction::None
    } else {
        let fits = allowed
            .is_none_or(|(_, codecs)| tracks.iter().all(|t| codecs.contains(&t.codec.as_str())));
        if fits && !changed { StreamAction::Copy } else { StreamAction::Encode }
    };
    let dropped = match sub_mode(&format) {
        SubMode::Copy => 0,
        SubMode::Text(_) => info.subtitles.iter().filter(|s| s.bitmap).count(),
        SubMode::None => info.subtitles.len(),
    } as u32;

    Ok(ConvertPreview { video, audio: audio_action, dropped_subtitles: dropped })
}

/// Whether a conversion would be a plain container swap, so the UI can promise
/// "instant, no quality loss" only when that is true.
pub fn can_stream_copy(info: &MediaInfo, format: &str) -> bool {
    convert_preview(format, None, None, None, info)
        .map(|p| p.video != StreamAction::Encode && p.audio != StreamAction::Encode)
        .unwrap_or(false)
}

/// Codecs a container accepts for a *re-encode*, with the default.
fn audio_choices(format: &str) -> (&'static [AudioCodec], AudioCodec) {
    match format {
        "webm" => (&[AudioCodec::Opus, AudioCodec::Vorbis], AudioCodec::Opus),
        "avi" => (&[AudioCodec::Mp3], AudioCodec::Mp3),
        "mkv" => (
            &[AudioCodec::Aac, AudioCodec::Opus, AudioCodec::Mp3, AudioCodec::Flac, AudioCodec::Vorbis],
            AudioCodec::Aac,
        ),
        "mov" => (&[AudioCodec::Aac, AudioCodec::Mp3], AudioCodec::Aac),
        _ => (&[AudioCodec::Aac, AudioCodec::Opus, AudioCodec::Mp3], AudioCodec::Aac),
    }
}

/// Re-encode settings for the video stream of a conversion.
fn convert_video_encoder(format: &str, quality: Quality) -> Vec<String> {
    let pick = |same, high, balanced, small| match quality {
        Quality::Same => same,
        Quality::High => high,
        Quality::Balanced => balanced,
        Quality::Small => small,
    };
    match format {
        "webm" => {
            let crf = pick(24, 28, 32, 38).to_string();
            ["-c:v", "libvpx-vp9", "-crf", &crf, "-b:v", "0", "-row-mt", "1", "-pix_fmt", "yuv420p"]
                .iter()
                .map(arg)
                .collect()
        }
        // -q:v is MPEG-4's quality scale, where lower is better.
        "avi" => {
            let q = pick(2, 3, 5, 8).to_string();
            ["-c:v", "mpeg4", "-q:v", &q, "-pix_fmt", "yuv420p"].iter().map(arg).collect()
        }
        _ => {
            let crf = pick(18, 20, 23, 28).to_string();
            ["-c:v", "libx264", "-crf", &crf, "-preset", "medium", "-pix_fmt", "yuv420p"]
                .iter()
                .map(arg)
                .collect()
        }
    }
}

pub fn convert(request: &ConvertRequest, info: &MediaInfo) -> AppResult<Plan> {
    let input = paths::require_file(&request.input)?;
    let format = request.format.to_ascii_lowercase();
    let preview = convert_preview(
        &format,
        request.audio.as_ref(),
        request.max_height,
        request.fps,
        info,
    )?;

    // Range, honoured for every target.
    let start = request.start_secs.unwrap_or(0.0).max(0.0);
    let end = request
        .end_secs
        .map(|e| if info.duration_secs > 0.0 { e.min(info.duration_secs) } else { e });
    let span = match end {
        Some(end) => {
            if end - start <= 0.0 {
                return Err(AppError::invalid("range", "the end must come after the start"));
            }
            Some(end - start)
        }
        None if info.duration_secs > 0.0 => Some(info.duration_secs - start),
        None => None,
    };
    let ranged = start > 0.0 || request.end_secs.is_some();

    let claim = output_for(&request.output_dir, &request.output_name, &input, &format)?;
    let output = claim.path().to_path_buf();

    // `-ss` ahead of `-i` seeks the input; `-t` is a duration, as in trim.
    let mut head = Vec::new();
    if start > 0.0 {
        head.extend([arg("-ss"), arg(format!("{start:.3}"))]);
    }
    head.extend([arg("-i"), path_arg(&input)]);
    let mut tail = Vec::new();
    if let (true, Some(span)) = (ranged, span) {
        tail.extend([arg("-t"), arg(format!("{span:.3}"))]);
    }
    let opts = request.audio.clone().unwrap_or_default();

    // ---- audio targets
    if AUDIO_FORMATS.contains(&format.as_str()) {
        let source = audio_list(info).first().copied();
        let mut args = head;
        args.extend(tail);
        // The first track only, and no picture: this is the same operation the
        // extract-audio tool performs.
        args.extend(["-map", "0:a:0", "-vn"].iter().map(arg));
        if preview.audio == StreamAction::Copy {
            args.extend([arg("-c:a"), arg("copy")]);
        } else if format == "aiff" {
            let wav = AudioOpts { codec: Some(AudioCodec::Wav), ..opts };
            args.extend(
                audio_args(&wav, AudioCodec::Wav, source)
                    .into_iter()
                    .map(|a| if a == "pcm_s16le" { arg("pcm_s16be") } else { a }),
            );
        } else {
            let codec = AudioCodec::from_ext(&format).unwrap_or(AudioCodec::Aac);
            args.extend(audio_args(&AudioOpts { codec: Some(codec), ..opts }, codec, source));
        }
        if format == "m4a" {
            args.extend([arg("-movflags"), arg("+faststart")]);
        }
        args.push(path_arg(&output));
        return Ok(single_pass(args, output, claim, span, "convert"));
    }

    // ---- animations
    if format == "gif" || format == "webp" {
        let video = info.video.as_ref().ok_or_else(|| AppError::invalid("file", "no video stream"))?;
        // Never upscale: a wider output than the source only adds bytes.
        let mut width = request.width.unwrap_or(480).max(16);
        if video.width > 0 {
            width = width.min(video.width);
        }
        // Nor invent frames the source does not have.
        let mut fps = request.fps.unwrap_or(12).max(1);
        if video.fps > 0.0 {
            fps = fps.min(video.fps.ceil() as u32).max(1);
        }
        let filters = format!("fps={fps},scale={width}:-1:flags=lanczos");

        if format == "webp" {
            let mut args = head;
            args.extend(tail);
            args.extend(
                ["-an", "-vf", &filters, "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "70", "-loop", "0"]
                    .iter()
                    .map(arg),
            );
            args.push(path_arg(&output));
            return Ok(single_pass(args, output, claim, span, "convert"));
        }

        // A GIF holds 256 colours. Letting ffmpeg pick them from the actual clip
        // rather than a fixed palette is the difference between a usable result
        // and a banded mess. stats_mode=diff weights colours in the moving parts.
        let palette = std::env::temp_dir().join(format!(
            "mt-palette-{}-{}.png",
            std::process::id(),
            crate::jobs::new_id()
        ));
        let mut first = head.clone();
        first.extend(tail.clone());
        first.extend([
            arg("-an"),
            arg("-vf"),
            format!("{filters},palettegen=stats_mode=diff"),
            arg("-frames:v"),
            arg("1"),
            arg("-update"),
            arg("1"),
            path_arg(&palette),
        ]);
        let mut second = head;
        second.extend([arg("-i"), path_arg(&palette)]);
        second.extend(tail);
        second.extend([
            arg("-an"),
            arg("-lavfi"),
            format!("{filters}[x];[x][1:v]paletteuse=dither=sierra2_4a"),
            arg("-loop"),
            arg("0"),
            path_arg(&output),
        ]);
        return Ok(Plan {
            passes: vec![
                Pass { args: first, duration_secs: span, label: "palette" },
                Pass { args: second, duration_secs: span, label: "gif" },
            ],
            output,
            temp_files: vec![palette],
            claim: Some(claim),
        });
    }

    // ---- video containers
    let quality = request.quality.unwrap_or_default();
    let mut args = head;
    args.extend(tail);
    if info.video.is_some() {
        args.extend([arg("-map"), arg("0:v:0?")]);
    }
    if preview.audio != StreamAction::None {
        args.extend([arg("-map"), arg("0:a?")]);
    }
    match sub_mode(&format) {
        // Explicit stream types rather than `-map 0`: a blanket map would also
        // pull in cover-art "video" streams and push them through the encoder.
        SubMode::Copy => args.extend(
            ["-map", "0:s?", "-map", "0:t?", "-c:s", "copy", "-c:t", "copy"].iter().map(arg),
        ),
        SubMode::Text(codec) => {
            // Text subtitles only, picked one by one: bitmap tracks cannot be
            // converted and would otherwise fail the whole job.
            let text: Vec<usize> = info
                .subtitles
                .iter()
                .enumerate()
                .filter(|(_, s)| !s.bitmap)
                .map(|(i, _)| i)
                .collect();
            for i in &text {
                args.extend([arg("-map"), format!("0:s:{i}")]);
            }
            if !text.is_empty() {
                args.extend([arg("-c:s"), arg(codec)]);
            }
        }
        SubMode::None => {}
    }

    match preview.video {
        StreamAction::Copy => {
            args.extend([arg("-c:v"), arg("copy")]);
            // QuickTime and Safari only play HEVC tagged hvc1.
            if matches!(format.as_str(), "mp4" | "mov")
                && info.video.as_ref().is_some_and(|v| v.codec == "hevc")
            {
                args.extend([arg("-tag:v"), arg("hvc1")]);
            }
        }
        StreamAction::Encode => {
            if let Some(filter) = video_filter(info, request.max_height, request.fps) {
                args.extend([arg("-vf"), filter]);
            }
            args.extend(convert_video_encoder(&format, quality));
        }
        StreamAction::None => {}
    }

    match preview.audio {
        StreamAction::Copy => args.extend([arg("-c:a"), arg("copy")]),
        StreamAction::Encode => {
            let (allowed, default) = audio_choices(&format);
            let mut opts = opts;
            if !opts.codec.is_some_and(|c| allowed.contains(&c)) {
                opts.codec = Some(default);
            }
            // AVI's MP3 default is 192k rather than the VBR the other tools use.
            if format == "avi" && opts.bitrate_kbps.is_none() {
                opts.bitrate_kbps = Some(192);
            }
            let source = audio_list(info).first().copied();
            args.extend(audio_args(&opts, default, source));
        }
        StreamAction::None => {}
    }
    if format == "mp4" || format == "mov" {
        args.extend([arg("-movflags"), arg("+faststart")]);
    }
    args.push(path_arg(&output));

    Ok(single_pass(args, output, claim, span, "convert"))
}

fn single_pass(
    args: Vec<String>,
    output: PathBuf,
    claim: paths::OutputClaim,
    duration: Option<f64>,
    label: &'static str,
) -> Plan {
    Plan {
        passes: vec![Pass { args, duration_secs: duration, label }],
        output,
        temp_files: Vec::new(),
        claim: Some(claim),
    }
}

// --------------------------------------------------------- extract audio

/// The extension of the container this stream can be lifted into without being
/// re-encoded, or `None` when the app knows no container for that codec.
///
/// This is what makes the tool worth having beside Convert: the audio inside an
/// MP4 is already a finished AAC file, so handing it over is a copy that takes
/// a moment and loses nothing. Re-encoding it to MP3 -- the thing everybody
/// does by habit -- spends a minute to make it measurably worse.
///
/// Conservative on purpose. A codec that is not listed falls back to a real
/// encode, which always works; guessing a container that cannot hold the codec
/// would fail the job instead.
fn copy_ext_for(stream: &AudioStream) -> Option<&'static str> {
    match stream.codec.as_str() {
        // ALAC in an M4A is what Apple writes and what everything reads.
        "aac" | "alac" => Some("m4a"),
        "mp3" => Some("mp3"),
        "opus" => Some("opus"),
        "vorbis" => Some("ogg"),
        "flac" => Some("flac"),
        "ac3" => Some("ac3"),
        "eac3" => Some("eac3"),
        // Only the PCM flavours a WAV header can describe. pcm_s24be and the
        // float variants are deliberately absent.
        "pcm_s16le" | "pcm_s24le" | "pcm_s32le" | "pcm_u8" => Some("wav"),
        _ => None,
    }
}

/// `copy_ext_for` for the file's first audio track.
pub fn copy_audio_ext(info: &MediaInfo) -> Option<&'static str> {
    copy_ext_for(info.audio.as_ref()?)
}

pub fn extract_audio(request: &ExtractAudioRequest, info: &MediaInfo) -> AppResult<Plan> {
    let input = paths::require_file(&request.input)?;
    if !info.has_audio() {
        return Err(AppError::invalid("file", "no audio stream"));
    }
    let format = request.format.to_ascii_lowercase();
    let tracks = audio_list(info);
    let index = request.stream_index.unwrap_or(0);
    let stream = *tracks
        .get(index)
        .ok_or_else(|| AppError::invalid("streamIndex", "no such audio track"))?;
    let opts = request.audio.clone().unwrap_or_default();

    // -vn is the whole of what makes this extraction rather than conversion:
    // the picture is dropped, and cover art in the source cannot end up as a
    // video stream in an audio file.
    let mut args = vec![
        arg("-i"),
        path_arg(&input),
        arg("-map"),
        format!("0:a:{index}"),
        arg("-vn"),
    ];

    let (extension, encode) = if format == ORIGINAL {
        // A request for `original` that reaches here after the file changed
        // under the screen falls back to AAC rather than failing: the user asked
        // for the audio, and refusing to hand it over on a technicality would
        // be the worse answer.
        match copy_ext_for(stream) {
            Some(ext) => (ext.to_string(), vec![arg("-c:a"), arg("copy")]),
            None => (
                "m4a".to_string(),
                audio_args(&AudioOpts::default(), AudioCodec::Aac, Some(stream)),
            ),
        }
    } else {
        let codec = AUDIO_FORMATS
            .contains(&format.as_str())
            .then(|| AudioCodec::from_ext(&format))
            .flatten()
            .ok_or_else(|| AppError::invalid("format", format!("unsupported: {format}")))?;
        let opts = AudioOpts { codec: Some(codec), ..opts };
        (format, audio_args(&opts, codec, Some(stream)))
    };

    let claim = output_for(&request.output_dir, &request.output_name, &input, &extension)?;
    let output = claim.path().to_path_buf();
    let copying = encode.iter().any(|a| a == "copy");
    args.extend(encode);
    if extension == "m4a" && !copying {
        args.extend([arg("-movflags"), arg("+faststart")]);
    }
    args.push(path_arg(&output));

    Ok(single_pass(args, output, claim, Some(info.duration_secs), "audio"))
}

// -------------------------------------------------------------- estimates

/// Rough output size for the hint under the compress presets.
///
/// Deliberately approximate: it exists so "Small" versus "Balanced" is a
/// decision someone can make without running both.
pub fn estimate_compressed_bytes(
    info: &MediaInfo,
    preset: CompressPreset,
    max_height: Option<u32>,
    audio: &Option<AudioOpts>,
    video_codec: Option<VideoCodec>,
    max_fps: Option<u32>,
    drop_audio: bool,
) -> u64 {
    if info.duration_secs <= 0.0 {
        return info.size_bytes;
    }

    // Audio-only: the output is exactly the target bitrate for the duration,
    // so this is arithmetic rather than an estimate. Returning size_bytes here
    // used to make all three presets read as "no change".
    let Some(video) = &info.video else {
        if !info.has_audio() {
            return info.size_bytes;
        }
        let opts = audio_only_opts(audio, preset, info);
        let plan = resolve_audio(&opts, AudioCodec::Aac, info.audio.as_ref());
        let kbps = plan_kbps(&plan, info.audio.as_ref()) as f64;
        return ((kbps * 1000.0 * info.duration_secs) / 8.0) as u64;
    };

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
    let codec_factor = match video_codec.unwrap_or(VideoCodec::H264) {
        VideoCodec::H264 => 1.0,
        VideoCodec::H265 => 0.62,
        VideoCodec::Av1 => 0.5,
    };
    // Fewer frames cost less, but not proportionally: the frames that remain
    // are further apart and so compress worse.
    let fps_factor = match max_fps {
        Some(cap) if cap > 0 && (cap as f64) < fps => (cap as f64 / fps).powf(0.7),
        _ => 1.0,
    };

    let video_bps = pixels * fps * bpp * codec_factor * fps_factor;
    let audio_bps = if drop_audio || !info.has_audio() {
        0.0
    } else {
        let plan = resolve_audio(
            &video_audio_opts(audio, preset),
            AudioCodec::Aac,
            info.audio.as_ref(),
        );
        plan_kbps(&plan, info.audio.as_ref()) as f64 * 1000.0
    };
    (((video_bps + audio_bps) * info.duration_secs) / 8.0) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::probe::{AudioStream, SubtitleStream, VideoStream};

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
            audio: Some(aud("aac", 2, None)),
            audio_streams: vec![aud("aac", 2, None)],
            subtitles: Vec::new(),
        }
    }

    fn aud(codec: &str, channels: u32, kbps: Option<u64>) -> AudioStream {
        AudioStream {
            index: 0,
            language: None,
            title: None,
            codec: codec.into(),
            channels,
            sample_rate: Some(48_000),
            bit_rate: kbps.map(|k| k * 1000),
        }
    }

    fn est(info: &MediaInfo, preset: CompressPreset, h: Option<u32>) -> u64 {
        estimate_compressed_bytes(info, preset, h, &None, None, None, false)
    }

    fn convert_defaults() -> ConvertRequest {
        ConvertRequest {
            input: String::new(),
            output_dir: std::env::temp_dir().to_string_lossy().into(),
            output_name: None,
            format: String::new(),
            audio: None,
            quality: None,
            max_height: None,
            width: None,
            fps: None,
            start_secs: None,
            end_secs: None,
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

    /// The resolution control replaced the resize tool, so `max_height` is now
    /// the only thing that scales a compression -- no preset does it quietly.
    #[test]
    fn compress_scales_only_when_the_request_asks() {
        let path = std::env::temp_dir().join(format!("mt-compress-{}.mp4", std::process::id()));
        std::fs::write(&path, b"x").unwrap();
        let base = CompressRequest {
            input: path.to_string_lossy().into(),
            output_dir: std::env::temp_dir().to_string_lossy().into(),
            output_name: Some("c".into()),
            preset: CompressPreset::Small,
            target_size_mb: None,
            max_height: None,
            audio: None,
            video_codec: None,
            max_fps: None,
            drop_audio: false,
        };
        let source = sample(1920, 1080, 10.0);

        // Smallest preset, no height asked for: the frames keep their size.
        let plan = compress(&base, &source).unwrap();
        assert!(!joined(&plan, 0).contains("scale="), "{}", joined(&plan, 0));

        let capped = CompressRequest { max_height: Some(720), ..base };
        let plan = compress(&capped, &source).unwrap();
        assert!(joined(&plan, 0).contains("scale=-2:720"), "{}", joined(&plan, 0));

        // A cap above the source is not an upscale, it is a no-op.
        let taller = CompressRequest { max_height: Some(1440), ..capped };
        let plan = compress(&taller, &source).unwrap();
        assert!(!joined(&plan, 0).contains("scale="), "{}", joined(&plan, 0));

        std::fs::remove_file(&path).unwrap();
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
            keep: None,
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
            keep: None,
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

    fn extract_request(input: &Path, name: &str, format: &str) -> ExtractAudioRequest {
        ExtractAudioRequest {
            input: input.to_string_lossy().into(),
            output_dir: std::env::temp_dir().to_string_lossy().into(),
            output_name: Some(name.into()),
            format: format.into(),
            audio: None,
            stream_index: None,
        }
    }

    /// The point of the tool: the AAC track inside an MP4 is already a finished
    /// audio file, so `original` hands it over instead of encoding it again.
    #[test]
    fn extracting_the_original_copies_the_track_into_its_own_container() {
        let path = std::env::temp_dir().join("mt-extract-copy.mp4");
        std::fs::write(&path, b"x").unwrap();

        let plan = extract_audio(
            &extract_request(&path, "a", "original"),
            &sample(1920, 1080, 30.0),
        )
        .unwrap();
        let args = joined(&plan, 0);
        assert!(args.contains("-vn"), "{args}");
        assert!(args.contains("-c:a copy"), "{args}");
        assert_eq!(plan.output.extension().unwrap(), "m4a", "aac belongs in m4a");

        std::fs::remove_file(&path).unwrap();
    }

    /// A codec with no container the app trusts still has to produce audio, so
    /// `original` degrades to an encode rather than to an error.
    #[test]
    fn an_uncopyable_track_falls_back_to_encoding() {
        let path = std::env::temp_dir().join("mt-extract-fallback.mkv");
        std::fs::write(&path, b"x").unwrap();
        let mut info = sample(1920, 1080, 30.0);
        info.audio.as_mut().unwrap().codec = "truehd".into();
        info.audio_streams = info.audio.iter().cloned().collect();
        assert_eq!(copy_audio_ext(&info), None);

        let plan =
            extract_audio(&extract_request(&path, "b", "original"), &info).unwrap();
        let args = joined(&plan, 0);
        assert!(!args.contains("copy"), "{args}");
        assert!(args.contains("-c:a aac"), "{args}");
        assert_eq!(plan.output.extension().unwrap(), "m4a");

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn extracting_a_named_format_encodes_into_it() {
        let path = std::env::temp_dir().join("mt-extract-mp3.mp4");
        std::fs::write(&path, b"x").unwrap();

        let plan = extract_audio(
            &extract_request(&path, "c", "mp3"),
            &sample(1920, 1080, 30.0),
        )
        .unwrap();
        let args = joined(&plan, 0);
        assert!(args.contains("-c:a libmp3lame"), "{args}");
        assert_eq!(plan.output.extension().unwrap(), "mp3");

        // A file with no audio has nothing to extract, and saying so beats
        // running ffmpeg to produce an empty container.
        let mut silent = sample(1920, 1080, 30.0);
        silent.audio = None;
        assert!(extract_audio(&extract_request(&path, "d", "mp3"), &silent).is_err());

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn audio_formats_drop_the_video_stream() {
        let path = std::env::temp_dir().join("mt-convert.mp4");
        std::fs::write(&path, b"x").unwrap();
        // The sample is AAC, so an m4a target is a stream copy now.
        for (format, marker) in [("mp3", "libmp3lame"), ("m4a", "-c:a copy"), ("wav", "pcm_s16le")] {
            let request = ConvertRequest {
                input: path.to_string_lossy().into(),
                output_dir: std::env::temp_dir().to_string_lossy().into(),
                output_name: Some(format!("c-{format}")),
                format: format.into(),
                ..convert_defaults()
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
        let small = est(&info, CompressPreset::Small, Some(720));
        let balanced = est(&info, CompressPreset::Balanced, None);
        let high = est(&info, CompressPreset::High, None);
        assert!(small < balanced, "{small} !< {balanced}");
        assert!(balanced < high, "{balanced} !< {high}");
    }

    // ---------------------------------------------------------- audio-only

    fn audio_sample(duration: f64, source_kbps: Option<u64>) -> MediaInfo {
        let mut info = sample(0, 0, duration);
        info.path = "/tmp/in.mp3".into();
        info.container = "mp3".into();
        info.video = None;
        info.audio = Some(aud("mp3", 2, source_kbps));
        info.audio_streams = info.audio.iter().cloned().collect();
        info
    }

    fn audio_request(preset: CompressPreset, target_size_mb: Option<f64>) -> CompressRequest {
        CompressRequest {
            input: String::new(), // filled in per test with a real temp file
            output_dir: std::env::temp_dir().to_string_lossy().into_owned(),
            output_name: Some(format!("mt-audio-test-{}", std::process::id())),
            preset,
            target_size_mb,
            max_height: None,
            audio: None,
            video_codec: None,
            max_fps: None,
            drop_audio: false,
        }
    }

    /// compress() calls require_file, so the input has to exist on disk.
    fn with_temp_input<T>(name: &str, body: impl FnOnce(&str) -> T) -> T {
        let path = std::env::temp_dir().join(format!("{name}-{}.mp3", std::process::id()));
        std::fs::write(&path, b"not really an mp3").unwrap();
        let result = body(&path.to_string_lossy());
        let _ = std::fs::remove_file(&path);
        result
    }

    #[test]
    fn compressing_audio_drops_video_and_writes_m4a() {
        // The file picker has always accepted audio extensions, so refusing an
        // MP3 here was the app contradicting itself.
        with_temp_input("mt-audio-plan", |input| {
            let mut request = audio_request(CompressPreset::Balanced, None);
            request.input = input.to_string();
            let plan = compress(&request, &audio_sample(200.0, Some(320))).unwrap();

            let args = joined(&plan, 0);
            assert!(args.contains("-vn"), "{args}");
            assert!(args.contains("-c:a aac"), "{args}");
            assert!(!args.contains("libx264"), "{args}");
            assert_eq!(plan.passes.len(), 1, "audio never needs two passes");
            assert_eq!(plan.output.extension().unwrap(), "m4a");
        });
    }

    #[test]
    fn audio_bitrate_always_lands_below_the_source() {
        // A 128k source at the High preset's 192k would come out half again as
        // large. Clamping to 128 is still not enough -- measured, re-encoding a
        // 96k MP3 at 96k AAC grew 1.6% on container overhead alone -- so the
        // ceiling is three quarters of the source.
        let source = audio_sample(200.0, Some(128));
        assert_eq!(audio_target_kbps(CompressPreset::High, &source), 96);
        assert_eq!(audio_target_kbps(CompressPreset::Balanced, &source), 96);
        assert_eq!(audio_target_kbps(CompressPreset::Small, &source), 96);

        // A high-bitrate source leaves the presets room to be themselves.
        let big = audio_sample(200.0, Some(320));
        assert_eq!(audio_target_kbps(CompressPreset::High, &big), 192);
        assert_eq!(audio_target_kbps(CompressPreset::Small, &big), 96);

        // Never below listenable, even from an already-tiny source. That the
        // floor equals the source is exactly the case compress() refuses.
        let tiny = audio_sample(200.0, Some(32));
        assert_eq!(audio_target_kbps(CompressPreset::Small, &tiny), 32);

        // No reported bitrate (WAV, FLAC): trust the preset, it always shrinks.
        let lossless = audio_sample(200.0, None);
        assert_eq!(audio_target_kbps(CompressPreset::High, &lossless), 192);
    }

    #[test]
    fn audio_estimates_shrink_and_beat_the_source_size() {
        let info = audio_sample(200.0, Some(320));
        let small = est(&info, CompressPreset::Small, None);
        let balanced = est(&info, CompressPreset::Balanced, None);
        let high = est(&info, CompressPreset::High, None);

        assert!(small < balanced, "{small} !< {balanced}");
        assert!(balanced < high, "{balanced} !< {high}");
        // Used to return size_bytes unchanged, which made all three presets
        // read as "no change" and the estimate useless.
        assert!(high < info.size_bytes, "{high} !< {}", info.size_bytes);
    }

    #[test]
    fn audio_already_at_the_floor_is_refused_rather_than_inflated() {
        with_temp_input("mt-audio-floor", |input| {
            let mut request = audio_request(CompressPreset::Small, None);
            request.input = input.to_string();
            // 32k source: the 75% ceiling floors at 32k, so re-encoding would
            // only add container overhead. Measured 5% larger.
            let err = compress(&request, &audio_sample(30.0, Some(32)));
            assert!(err.is_err(), "a 32k source has nothing left to compress");

            // But a target size is an explicit instruction, so it still runs.
            let mut sized = audio_request(CompressPreset::Small, Some(0.05));
            sized.input = input.to_string();
            assert!(compress(&sized, &audio_sample(30.0, Some(32))).is_ok());
        });
    }

    #[test]
    fn a_file_with_neither_stream_is_rejected() {
        with_temp_input("mt-empty-plan", |input| {
            let mut info = audio_sample(200.0, Some(128));
            info.audio = None;
            let mut request = audio_request(CompressPreset::Balanced, None);
            request.input = input.to_string();
            assert!(compress(&request, &info).is_err());
        });
    }

    // ------------------------------------------------- shared audio options

    #[test]
    fn audio_args_never_exceed_a_lossy_source_bitrate() {
        let src = aud("mp3", 2, Some(96));
        let opts = AudioOpts { bitrate_kbps: Some(192), ..Default::default() };
        let args = audio_args(&opts, AudioCodec::Aac, Some(&src)).join(" ");
        assert!(args.contains("-b:a 96k"), "{args}");
        // The floor beats a tiny source.
        let tiny = aud("mp3", 2, Some(8));
        let args = audio_args(&opts, AudioCodec::Opus, Some(&tiny)).join(" ");
        assert!(args.contains("-b:a 24k"), "{args}");
        // A lossless source has no ceiling.
        let flac = aud("flac", 2, Some(900));
        let args = audio_args(&opts, AudioCodec::Aac, Some(&flac)).join(" ");
        assert!(args.contains("-b:a 192k"), "{args}");
        // Automatic defaults.
        let none = AudioOpts::default();
        assert!(audio_args(&none, AudioCodec::Aac, None).join(" ").contains("-b:a 160k"));
        assert!(audio_args(&none, AudioCodec::Opus, None).join(" ").contains("-b:a 128k"));
        assert!(audio_args(&none, AudioCodec::Mp3, None).join(" ").contains("-q:a 2"));
        assert!(audio_args(&none, AudioCodec::Vorbis, None).join(" ").contains("-q:a 5"));
    }

    #[test]
    fn audio_args_channels_and_rates() {
        let stereo = aud("aac", 2, None);
        let mono = aud("aac", 1, None);
        let surround = aud("ac3", 6, None);
        let has_ac = |args: Vec<String>| args.contains(&"-ac".to_string());
        let auto = AudioOpts::default();
        assert!(!has_ac(audio_args(&auto, AudioCodec::Aac, Some(&mono))));
        assert!(!has_ac(audio_args(&auto, AudioCodec::Aac, Some(&stereo))));
        assert!(audio_args(&auto, AudioCodec::Aac, Some(&surround)).join(" ").contains("-ac 2"));

        let m = AudioOpts { channels: Channels::Mono, ..Default::default() };
        assert!(audio_args(&m, AudioCodec::Aac, Some(&stereo)).join(" ").contains("-ac 1"));
        let s = AudioOpts { channels: Channels::Stereo, ..Default::default() };
        assert!(!has_ac(audio_args(&s, AudioCodec::Aac, Some(&mono))), "no upmix");
        assert!(audio_args(&s, AudioCodec::Aac, Some(&surround)).join(" ").contains("-ac 2"));

        // Opus only knows five rates.
        let o = AudioOpts { sample_rate: Some(44_100), ..Default::default() };
        assert!(audio_args(&o, AudioCodec::Opus, None).join(" ").contains("-ar 48000"));
        assert!(audio_args(&o, AudioCodec::Aac, None).join(" ").contains("-ar 44100"));
        let o = AudioOpts { sample_rate: Some(24_000), ..Default::default() };
        assert!(audio_args(&o, AudioCodec::Opus, None).join(" ").contains("-ar 24000"));

        let flac = audio_args(&auto, AudioCodec::Flac, None).join(" ");
        assert_eq!(flac, "-c:a flac -compression_level 5");
        assert_eq!(audio_args(&auto, AudioCodec::Wav, None).join(" "), "-c:a pcm_s16le");
    }

    #[test]
    fn audio_opts_deserialise_from_the_frontend_json() {
        let opts: AudioOpts = serde_json::from_str(
            r#"{"codec":"opus","bitrateKbps":48,"channels":"mono","sampleRate":24000}"#,
        )
        .unwrap();
        assert_eq!(opts.codec, Some(AudioCodec::Opus));
        assert_eq!(opts.channels, Channels::Mono);
        let none: AudioOpts = serde_json::from_str("{}").unwrap();
        assert_eq!(none.channels, Channels::Auto);
    }

    // ----------------------------------------------------------- compress

    fn compress_request(path: &Path) -> CompressRequest {
        CompressRequest {
            input: path.to_string_lossy().into(),
            output_dir: std::env::temp_dir().to_string_lossy().into(),
            output_name: Some("mt-new-compress".into()),
            preset: CompressPreset::Balanced,
            target_size_mb: None,
            max_height: None,
            audio: None,
            video_codec: None,
            max_fps: None,
            drop_audio: false,
        }
    }

    fn temp_input(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{}-{name}", std::process::id()));
        std::fs::write(&path, b"x").unwrap();
        path
    }

    #[test]
    fn compress_codec_fps_and_audio_shapes() {
        let path = temp_input("mt-codec.mp4");
        let source = sample(1920, 1080, 10.0);

        let mut r = compress_request(&path);
        r.video_codec = Some(VideoCodec::H265);
        let a = joined(&compress(&r, &source).unwrap(), 0);
        assert!(a.contains("-c:v libx265 -crf 28 -preset medium -tag:v hvc1"), "{a}");

        r.video_codec = Some(VideoCodec::Av1);
        r.preset = CompressPreset::Small;
        let a = joined(&compress(&r, &source).unwrap(), 0);
        assert!(a.contains("-c:v libsvtav1 -crf 42 -preset 10"), "{a}");
        assert!(a.contains("-pix_fmt yuv420p") && a.contains("+faststart"), "{a}");

        // fps cap and scale share one -vf; a cap above the source does nothing.
        let mut r = compress_request(&path);
        r.max_fps = Some(24);
        r.max_height = Some(720);
        let a = joined(&compress(&r, &source).unwrap(), 0);
        assert!(a.contains("-vf fps=24,scale=-2:720:flags=lanczos"), "{a}");
        r.max_fps = Some(60);
        r.max_height = None;
        assert!(!joined(&compress(&r, &source).unwrap(), 0).contains("fps="));

        // Audio: dropped, or overridden (flac falls back to aac in mp4).
        let mut r = compress_request(&path);
        r.drop_audio = true;
        let a = joined(&compress(&r, &source).unwrap(), 0);
        assert!(a.contains("-an") && !a.contains("-c:a"), "{a}");
        let mut r = compress_request(&path);
        r.audio = Some(AudioOpts { codec: Some(AudioCodec::Flac), ..Default::default() });
        assert!(joined(&compress(&r, &source).unwrap(), 0).contains("-c:a aac -b:a 128k"));
        r.audio = Some(AudioOpts {
            codec: Some(AudioCodec::Opus),
            bitrate_kbps: Some(64),
            ..Default::default()
        });
        assert!(joined(&compress(&r, &source).unwrap(), 0).contains("-c:a libopus -b:a 64k"));

        // Default audio is clamped to a known source bitrate and no -ac 2.
        let mut low = sample(1920, 1080, 10.0);
        low.audio = Some(aud("aac", 2, Some(64)));
        low.audio_streams = low.audio.iter().cloned().collect();
        let mut r = compress_request(&path);
        r.preset = CompressPreset::High;
        let a = joined(&compress(&r, &low).unwrap(), 0);
        assert!(a.contains("-b:a 64k") && !a.contains("-ac"), "{a}");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn target_size_budget_uses_the_real_audio_bitrate() {
        // 10 MB over 100 s: 10*8*1024*0.97/100 = 794.6 kbps in total.
        let v = target_video_kbps(10.0, 100.0, 128);
        assert!((v - 666.6).abs() < 0.5, "{v}");
        assert_eq!(target_video_kbps(1.0, 1000.0, 128), 100.0);

        let path = temp_input("mt-2p.mp4");
        let mut low = sample(1280, 720, 100.0);
        low.audio = Some(aud("aac", 2, Some(64)));
        low.audio_streams = low.audio.iter().cloned().collect();
        let mut r = compress_request(&path);
        r.target_size_mb = Some(10.0);
        r.preset = CompressPreset::High;
        r.video_codec = Some(VideoCodec::Av1);
        let plan = compress(&r, &low).unwrap();
        let second = joined(&plan, 1);
        assert!(second.contains("-b:a 64k"), "{second}");
        assert!(second.contains("libx264") && !joined(&plan, 0).contains("svtav1"));
        let expected = target_video_kbps(10.0, 100.0, 64).round() as u64;
        assert!(second.contains(&format!("-b:v {expected}k")), "{second}");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn estimates_follow_codec_fps_and_audio_options() {
        let info = sample(1920, 1080, 100.0);
        let e = |codec, fps, mute| {
            estimate_compressed_bytes(&info, CompressPreset::Balanced, None, &None, codec, fps, mute)
        };
        let base = e(None, None, false);
        let h265 = e(Some(VideoCodec::H265), None, false);
        let av1 = e(Some(VideoCodec::Av1), None, false);
        assert!(av1 < h265 && h265 < base);
        assert!(e(None, Some(15), false) < base);
        assert!(e(None, None, true) < base);
    }

    #[test]
    fn audio_only_compress_respects_explicit_audio_options() {
        with_temp_input("mt-audio-opus", |input| {
            let mut request = audio_request(CompressPreset::Small, None);
            request.input = input.to_string();
            request.audio = Some(AudioOpts {
                codec: Some(AudioCodec::Opus),
                bitrate_kbps: Some(48),
                channels: Channels::Mono,
                sample_rate: Some(24_000),
            });
            // A 32k source is "already at its smallest" -- but an explicit
            // instruction is not a hope of shrinking, so it runs.
            let plan = compress(&request, &audio_sample(30.0, Some(32))).unwrap();
            let args = joined(&plan, 0);
            assert!(args.contains("-c:a libopus -b:a 32k -ac 1 -ar 24000"), "{args}");
            assert_eq!(plan.output.extension().unwrap(), "opus");
        });
    }

    // ------------------------------------------------------------ convert

    fn fixture(vcodec: &str, acodec: &str) -> MediaInfo {
        let mut info = sample(1920, 1080, 60.0);
        info.video.as_mut().unwrap().codec = vcodec.into();
        info.audio = Some(aud(acodec, 2, None));
        info.audio_streams = info.audio.iter().cloned().collect();
        info
    }

    fn sub(codec: &str, bitmap: bool) -> SubtitleStream {
        SubtitleStream { codec: codec.into(), language: None, bitmap }
    }

    #[test]
    fn convert_decides_each_stream_on_its_own() {
        let p = |f: &str, i: &MediaInfo| convert_preview(f, None, None, None, i).unwrap();
        let both = p("mp4", &fixture("h264", "aac"));
        assert_eq!((both.video, both.audio), (StreamAction::Copy, StreamAction::Copy));
        let web = p("webm", &fixture("vp9", "opus"));
        assert_eq!((web.video, web.audio), (StreamAction::Copy, StreamAction::Copy));
        let mov = p("mov", &fixture("h264", "opus"));
        assert_eq!((mov.video, mov.audio), (StreamAction::Copy, StreamAction::Encode));
        let avi = p("avi", &fixture("vp9", "aac"));
        assert_eq!((avi.video, avi.audio), (StreamAction::Encode, StreamAction::Encode));

        // Scaling forces a video encode but not an audio one.
        let scaled = convert_preview("mp4", None, Some(720), None, &fixture("h264", "aac")).unwrap();
        assert_eq!((scaled.video, scaled.audio), (StreamAction::Encode, StreamAction::Copy));
        // A bitrate forces the audio encode.
        let opts = AudioOpts { bitrate_kbps: Some(96), ..Default::default() };
        let r = convert_preview("mp4", Some(&opts), None, None, &fixture("h264", "aac")).unwrap();
        assert_eq!((r.video, r.audio), (StreamAction::Copy, StreamAction::Encode));
        assert!(can_stream_copy(&fixture("h264", "aac"), "mp4"));
        assert!(!can_stream_copy(&fixture("h264", "opus"), "mov"));
    }

    fn convert_request(path: &Path, name: &str, format: &str) -> ConvertRequest {
        ConvertRequest {
            input: path.to_string_lossy().into(),
            output_name: Some(name.into()),
            format: format.into(),
            ..convert_defaults()
        }
    }

    #[test]
    fn convert_drops_bitmap_subtitles_instead_of_failing() {
        let path = temp_input("mt-subs.mkv");
        let mut info = fixture("h264", "aac");
        info.subtitles = vec![sub("subrip", false), sub("hdmv_pgs_subtitle", true)];
        let preview = convert_preview("mp4", None, None, None, &info).unwrap();
        assert_eq!(preview.dropped_subtitles, 1);
        let plan = convert(&convert_request(&path, "mt-subs-mp4", "mp4"), &info).unwrap();
        let a = joined(&plan, 0);
        assert!(a.contains("-map 0:s:0 -c:s mov_text") && !a.contains("0:s:1"), "{a}");
        assert!(a.contains("-c:v copy") && a.contains("-c:a copy"), "{a}");

        let mkv = convert(&convert_request(&path, "mt-subs-mkv", "mkv"), &info).unwrap();
        assert!(joined(&mkv, 0).contains("-map 0:s? -map 0:t?"), "{}", joined(&mkv, 0));
        assert_eq!(convert_preview("mkv", None, None, None, &info).unwrap().dropped_subtitles, 0);
        assert_eq!(convert_preview("webm", None, None, None, &info).unwrap().dropped_subtitles, 1);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn convert_reencodes_with_the_quality_words() {
        let path = temp_input("mt-q.mkv");
        let info = fixture("vp9", "opus");
        let mut r = convert_request(&path, "mt-q-mp4", "mp4");
        r.quality = Some(Quality::Small);
        let a = joined(&convert(&r, &info).unwrap(), 0);
        assert!(a.contains("-c:v libx264 -crf 28 -preset medium"), "{a}");
        assert!(a.contains("-c:a copy"), "opus is fine in mp4: {a}");
        let mut r = convert_request(&path, "mt-q-webm", "webm");
        r.quality = Some(Quality::Same);
        let a = joined(&convert(&r, &fixture("h264", "aac")).unwrap(), 0);
        assert!(a.contains("-c:v libvpx-vp9 -crf 24 -b:v 0 -row-mt 1"), "{a}");
        assert!(a.contains("-c:a libopus -b:a 128k"), "{a}");
        let avi = convert(&convert_request(&path, "mt-q-avi", "avi"), &fixture("vp9", "opus")).unwrap();
        let a = joined(&avi, 0);
        assert!(a.contains("-c:v mpeg4 -q:v 3") && a.contains("-c:a libmp3lame -b:a 192k"), "{a}");
        // Range goes before -i and as a duration.
        let mut r = convert_request(&path, "mt-q-range", "mkv");
        r.start_secs = Some(5.0);
        r.end_secs = Some(15.0);
        let plan = convert(&r, &info).unwrap();
        let a = joined(&plan, 0);
        assert!(a.starts_with("-ss 5.000 -i") && a.contains("-t 10.000"), "{a}");
        assert_eq!(plan.passes[0].duration_secs, Some(10.0));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn gif_is_two_passes_with_a_palette_and_webp_is_one() {
        let path = temp_input("mt-gif.mp4");
        let info = sample(1920, 1080, 30.0);
        let plan = convert(&convert_request(&path, "mt-gif-out", "gif"), &info).unwrap();
        assert_eq!(plan.passes.len(), 2);
        assert_eq!(plan.temp_files.len(), 1);
        let palette = plan.temp_files[0].to_string_lossy().into_owned();
        let (one, two) = (joined(&plan, 0), joined(&plan, 1));
        assert!(one.contains("fps=12,scale=480:-1:flags=lanczos,palettegen=stats_mode=diff"), "{one}");
        assert!(one.ends_with(&palette), "{one}");
        assert!(
            two.contains(&format!("-i {palette}")) && two.contains("paletteuse=dither=sierra2_4a"),
            "{two}"
        );

        let plan = convert(&convert_request(&path, "mt-webp-out", "webp"), &info).unwrap();
        assert_eq!(plan.passes.len(), 1);
        let a = joined(&plan, 0);
        assert!(a.contains("-c:v libwebp_anim -lossless 0 -q:v 70 -loop 0") && a.contains("-an"), "{a}");

        // Never upscale.
        let small = sample(320, 240, 30.0);
        let mut r = convert_request(&path, "mt-gif-small", "gif");
        r.width = Some(640);
        assert!(joined(&convert(&r, &small).unwrap(), 0).contains("scale=320:-1"));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn audio_targets_copy_only_when_the_codec_matches() {
        let path = temp_input("mt-at.mp4");
        let info = fixture("h264", "aac");
        let a = joined(&convert(&convert_request(&path, "mt-at-m4a", "m4a"), &info).unwrap(), 0);
        assert!(a.contains("-map 0:a:0 -vn -c:a copy"), "{a}");
        let mut r = convert_request(&path, "mt-at-opus", "opus");
        r.audio = Some(AudioOpts {
            bitrate_kbps: Some(48),
            channels: Channels::Mono,
            sample_rate: Some(24_000),
            codec: Some(AudioCodec::Mp3),
        });
        let a = joined(&convert(&r, &info).unwrap(), 0);
        assert!(a.contains("-c:a libopus -b:a 48k -ac 1 -ar 24000"), "codec comes from the format: {a}");
        let a = joined(&convert(&convert_request(&path, "mt-at-aiff", "aiff"), &info).unwrap(), 0);
        assert!(a.contains("-c:a pcm_s16be"), "{a}");
        assert!(convert(&convert_request(&path, "mt-at-bad", "xyz"), &info).is_err());
        std::fs::remove_file(&path).unwrap();
    }

    // ------------------------------------------------------ extract / trim

    #[test]
    fn extract_maps_the_chosen_track() {
        let path = temp_input("mt-ex.mkv");
        let mut info = fixture("h264", "aac");
        info.audio_streams =
            vec![aud("aac", 2, None), AudioStream { index: 1, ..aud("opus", 2, None) }];
        let mut r = extract_request(&path, "mt-ex-1", "original");
        r.stream_index = Some(1);
        let plan = extract_audio(&r, &info).unwrap();
        let a = joined(&plan, 0);
        assert!(a.contains("-map 0:a:1") && a.contains("-c:a copy"), "{a}");
        assert_eq!(plan.output.extension().unwrap(), "opus");

        let mut r = extract_request(&path, "mt-ex-2", "opus");
        r.audio = Some(AudioOpts {
            bitrate_kbps: Some(32),
            channels: Channels::Mono,
            ..Default::default()
        });
        let a = joined(&extract_audio(&r, &info).unwrap(), 0);
        assert!(a.contains("-map 0:a:0") && a.contains("-c:a libopus -b:a 32k -ac 1"), "{a}");
        r.stream_index = Some(5);
        assert!(extract_audio(&r, &info).is_err());
        std::fs::remove_file(&path).unwrap();
    }

    fn trim_request(path: &Path, name: &str) -> TrimRequest {
        TrimRequest {
            input: path.to_string_lossy().into(),
            output_dir: std::env::temp_dir().to_string_lossy().into(),
            output_name: Some(name.into()),
            start_secs: 0.0,
            end_secs: 10.0,
            exact: false,
            keep: None,
        }
    }

    #[test]
    fn exact_trim_of_audio_stays_audio() {
        let path = temp_input("mt-ta.mp3");
        let mut r = trim_request(&path, "mt-ta-out");
        r.exact = true;
        let plan = trim(&r, &audio_sample(60.0, Some(128))).unwrap();
        assert_eq!(plan.output.extension().unwrap(), "mp3");
        let a = joined(&plan, 0);
        assert!(a.contains("-c:a libmp3lame") && !a.contains("libx264"), "{a}");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn keep_segments_build_a_select_expression() {
        let path = temp_input("mt-keep.mp4");
        let mut r = trim_request(&path, "mt-keep-out");
        r.keep = Some(vec![[1.0, 2.5], [4.0, 4.0], [5.0, 9999.0]]);
        let plan = trim(&r, &sample(1920, 1080, 10.0)).unwrap();
        let a = joined(&plan, 0);
        assert!(
            a.contains("select='between(t,1.000,2.500)+between(t,5.000,10.000)',setpts=N/FRAME_RATE/TB"),
            "{a}"
        );
        assert!(
            a.contains("aselect='between(t,1.000,2.500)+between(t,5.000,10.000)',asetpts=N/SR/TB"),
            "{a}"
        );
        assert!(a.contains("libx264") && !a.contains("-ss"), "{a}");
        assert_eq!(plan.passes[0].duration_secs, Some(6.5));

        // Audio only: no video filter, family codec.
        let mut r = trim_request(&path, "mt-keep-audio");
        r.keep = Some(vec![[0.0, 3.0]]);
        let plan = trim(&r, &audio_sample(60.0, Some(128))).unwrap();
        let a = joined(&plan, 0);
        assert!(a.contains("-af aselect=") && !a.contains("-vf") && a.contains("libmp3lame"), "{a}");
        assert_eq!(plan.output.extension().unwrap(), "mp3");

        // Overlap and too many segments are errors.
        let mut r = trim_request(&path, "mt-keep-bad");
        r.keep = Some(vec![[0.0, 5.0], [4.0, 6.0]]);
        assert!(trim(&r, &sample(1920, 1080, 10.0)).is_err());
        let many = |n: usize| -> Vec<[f64; 2]> {
            (0..n).map(|i| [i as f64 * 2.0, i as f64 * 2.0 + 1.0]).collect()
        };
        r.keep = Some(many(401));
        assert!(trim(&r, &sample(1920, 1080, 10_000.0)).is_err());
        r.keep = Some(many(400));
        assert!(trim(&r, &sample(1920, 1080, 10_000.0)).is_ok());
        std::fs::remove_file(&path).unwrap();
    }
}
