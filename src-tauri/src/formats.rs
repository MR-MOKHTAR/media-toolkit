//! What a media page offers, and how to ask yt-dlp for the right part of it.
//!
//! Two halves, both pure so they can be tested against captured JSON:
//!
//! - `summarize` turns the `-J` the probe already fetches into the handful of
//!   facts the download form shows -- which resolutions exist and roughly how
//!   big each would be, which audio tracks, which subtitles. The probe used to
//!   throw all of it away and show a single global quality setting, so a video
//!   that topped out at 720p offered "1080p" and quietly delivered less.
//!
//! - `video_selection` / `audio_selection` build the yt-dlp arguments for a
//!   choice. They replace a hand-written `-f` chain whose first branch was
//!   "best H.264 under the cap". YouTube's H.264 stops at 1080p, so that branch
//!   matched for every cap above it and 1440p, 2160p and "Best" all produced
//!   1080p. Sorting with `-S` puts resolution first and codec second: the
//!   largest picture at or under the cap, and at equal resolution the codec
//!   that plays everywhere.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The resolutions the form offers, by the short side of the picture -- the
/// same "p" yt-dlp's `res` sort field uses, which is what makes a portrait
/// 1080x1920 video a "1080p" rather than a "1920p".
const LADDER: &[u32] = &[4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];

/// At most this many audio choices are listed: a dubbed video can carry thirty
/// tracks, and nobody reads past the first few.
const MAX_AUDIO_OPTIONS: usize = 6;

/// Sites whose links are, in practice, always wanted as sound. The form opens
/// on the Audio tab for these instead of asking.
const AUDIO_FIRST_EXTRACTORS: &[&str] = &[
    "soundcloud",
    "bandcamp",
    "mixcloud",
    "audiomack",
    "youtubemusic",
    "applepodcasts",
    "spotify",
    "deezer",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaSummary {
    /// One entry per resolution on offer, largest first.
    pub heights: Vec<HeightOption>,
    /// The distinct audio tracks, the one the form should default to first.
    pub audio: Vec<AudioOption>,
    /// Subtitles the uploader provided.
    pub subtitles: Vec<SubtitleTrack>,
    /// Languages with machine captions worth offering: the spoken language
    /// (yt-dlp's `-orig`) and the three the app is translated into.
    pub auto_captions: Vec<String>,
    pub chapters: u32,
    pub is_live: bool,
    pub has_video: bool,
    /// The link is, in all likelihood, music or a podcast -- the form opens on
    /// its Audio tab.
    pub suggests_audio: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeightOption {
    /// The short side, snapped to the ladder: 2160, 1440, 1080, ...
    pub height: u32,
    pub fps: f64,
    pub hdr: bool,
    /// Picture and sound together, for the format `CodecPref::Auto` picks at
    /// this resolution. Approximate: many sites only publish bitrates.
    pub size_bytes: Option<u64>,
    /// The same for H.264 + AAC, when that exists at this resolution.
    pub compatible_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioOption {
    /// `aac`, `opus`, `mp3`, `vorbis`, ... -- the family, not the profile.
    pub codec: String,
    /// kbps.
    pub bitrate: Option<f64>,
    pub size_bytes: Option<u64>,
    pub language: Option<String>,
    /// The track the site marks as the original language, when it marks one.
    pub original: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
    pub lang: String,
    pub name: Option<String>,
}

/// How to weigh the codec against everything else.
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CodecPref {
    /// Resolution first, then frame rate, then the codec that plays
    /// everywhere. What almost everyone wants: the picture they asked for, in
    /// H.264 whenever H.264 exists at that size.
    #[default]
    Auto,
    /// H.264 + AAC even at a lower resolution: for an old TV, a car, a
    /// presentation laptop.
    Compatible,
    /// The smallest file at the resolution asked for: AV1 with Opus, about
    /// half the size of H.264 for the same picture.
    Small,
}

/// What an audio download ends up as.
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    /// The best track the site has, packets untouched.
    #[default]
    Original,
    /// AAC in an .m4a -- copied when the site serves AAC, which YouTube does.
    M4a,
    /// Opus -- copied when the site serves Opus.
    Opus,
    /// Re-encoded with LAME, at the chosen bitrate or its best VBR.
    Mp3,
}

/// yt-dlp arguments for a video download: format filter and sort order.
///
/// `-f bv*+ba/b` is yt-dlp's own default shape -- the best video (with or
/// without sound) plus the best audio, or the best single file. Everything
/// about *which* best is decided by `-S`:
///
/// - `res:N` prefers the largest short side not above N, and the smallest
///   above it when there is nothing at or below. No cap means the largest.
/// - `+codec:avc:m4a` orders codecs h264 > h265 > vp9 > av1 for video and
///   aac first for audio -- so at equal resolution the result is the file
///   that plays on everything, and it merges into MP4 without a remux of a
///   codec MP4 handles badly.
///
/// Checked against a real YouTube `-J` (a 4K upload) with `--load-info-json
/// --simulate`: Auto gives VP9 2160p, VP9 1440p, H.264 1080p60 and H.264
/// 720p60 for the four caps, where the old chain gave 1080p for all of the
/// top three. Two traps found on the way, both avoided below:
///
/// - Compatible cannot lead with `+codec:avc:m4a`: `codec` ranks the audio
///   codec too, so the old muxed 360p (H.264 *and* AAC in one file) outranked
///   every video-only H.264 and won. Video codec first, audio codec last.
/// - Small cannot use `+size`: it shrinks the audio as well, down to 48k
///   HE-AAC. The default codec order already puts AV1 first, and AV1 is the
///   small one, so it only has to be asked for -- with Opus for the sound.
pub fn video_selection(height: Option<u32>, codec: CodecPref) -> Vec<String> {
    let res = height.map_or_else(|| "res".to_string(), |h| format!("res:{h}"));
    let sort = match codec {
        CodecPref::Auto => format!("{res},fps,+codec:avc:m4a"),
        CodecPref::Compatible => format!("+vcodec:avc,{res},fps,+acodec:m4a"),
        CodecPref::Small => format!("{res},fps,+codec:av01:opus"),
    };
    vec!["-f".into(), "bv*+ba/b".into(), "-S".into(), sort]
}

/// yt-dlp's format filter for an audio download. The same for both engines,
/// so the fast path and yt-dlp's own fetch the same track -- they used to
/// disagree, one taking AAC 128k and the other Opus 160k for "original".
pub fn audio_selection(format: AudioFormat) -> Vec<String> {
    let filter = match format {
        // The best-sounding track, whatever its codec: on YouTube, Opus 160k.
        AudioFormat::Original | AudioFormat::Mp3 => "ba/b",
        AudioFormat::M4a => "ba[acodec^=mp4a]/ba/b",
        AudioFormat::Opus => "ba[acodec=opus]/ba/b",
    };
    vec!["-f".into(), filter.into()]
}

/// The probe's view of a page, or `None` when it lists no formats at all (a
/// plain file yt-dlp's generic extractor found, a playlist page).
pub fn summarize(value: &Value) -> Option<MediaSummary> {
    let formats = value.get("formats")?.as_array()?;
    let duration = value.get("duration").and_then(Value::as_f64);

    let parsed: Vec<Format> = formats
        .iter()
        .filter_map(|raw| Format::parse(raw, duration))
        .collect();
    if parsed.is_empty() {
        return None;
    }

    let audio_only: Vec<&Format> = parsed.iter().filter(|f| f.has_audio && !f.has_video).collect();
    // The track the auto choice pairs with video (AAC first, then the best),
    // and the AAC one the compatible choice pairs with.
    let best_aac = best_audio(audio_only.iter().copied().filter(|f| f.acodec_family() == "aac"));
    let best_any = best_audio(audio_only.iter().copied());
    let paired_audio = best_aac.or(best_any).and_then(|f| f.size);

    let mut heights: Vec<HeightOption> = Vec::new();
    for &step in LADDER {
        let at: Vec<&Format> = parsed
            .iter()
            .filter(|f| f.has_video && f.rung == Some(step))
            .collect();
        if at.is_empty() {
            continue;
        }
        let fps = at.iter().map(|f| f.fps).fold(0.0, f64::max);
        let hdr = at.iter().any(|f| f.hdr);
        let size_of = |f: &Format| -> Option<u64> {
            match (f.size, f.has_audio) {
                (Some(video), true) => Some(video),
                (Some(video), false) => Some(video + paired_audio.unwrap_or(0)),
                (None, _) => None,
            }
        };
        let auto = pick_auto(&at);
        let compatible = pick_best(at.iter().copied().filter(|f| f.vcodec_family() == "h264"));
        heights.push(HeightOption {
            height: step,
            fps,
            hdr,
            size_bytes: auto.and_then(size_of),
            compatible_size_bytes: compatible.and_then(|f| match (f.size, f.has_audio) {
                (Some(video), true) => Some(video),
                (Some(video), false) => Some(video + best_aac.and_then(|a| a.size).or(paired_audio).unwrap_or(0)),
                (None, _) => None,
            }),
        });
    }

    let has_video = parsed.iter().any(|f| f.has_video);

    Some(MediaSummary {
        heights,
        audio: audio_options(&audio_only),
        subtitles: subtitles(value),
        auto_captions: auto_captions(value),
        chapters: value
            .get("chapters")
            .and_then(Value::as_array)
            .map_or(0, |list| list.len() as u32),
        is_live: value.get("is_live").and_then(Value::as_bool).unwrap_or(false)
            || value.get("live_status").and_then(Value::as_str) == Some("is_live"),
        has_video,
        suggests_audio: !has_video || suggests_audio(value),
    })
}

/// One entry of `formats`, reduced to what the summary needs.
#[derive(Debug)]
struct Format {
    vcodec: Option<String>,
    acodec: Option<String>,
    has_video: bool,
    has_audio: bool,
    /// The ladder step this picture belongs to.
    rung: Option<u32>,
    fps: f64,
    hdr: bool,
    /// Fetched over plain HTTP(S) rather than as an HLS/DASH manifest. yt-dlp
    /// takes the direct one when both exist at the same size and codec -- and
    /// the manifest's bitrate is the higher, so ranking by bitrate alone
    /// quoted YouTube's 1080p at twice the size of the file actually fetched.
    direct: bool,
    /// kbps, total.
    tbr: f64,
    abr: f64,
    size: Option<u64>,
    language: Option<String>,
    language_preference: i64,
}

impl Format {
    fn parse(raw: &Value, duration: Option<f64>) -> Option<Self> {
        let text = |key: &str| raw.get(key).and_then(Value::as_str).map(str::to_string);
        let number = |key: &str| raw.get(key).and_then(Value::as_f64);

        // Storyboards are a grid of thumbnails yt-dlp lists as "video".
        let protocol = text("protocol").unwrap_or_default();
        let note = text("format_note").unwrap_or_default().to_ascii_lowercase();
        if protocol == "mhtml" || note.contains("storyboard") || text("ext").as_deref() == Some("mhtml") {
            return None;
        }

        let vcodec = text("vcodec");
        let acodec = text("acodec");
        let width = number("width").map(|w| w as u32);
        let height = number("height").map(|h| h as u32);
        let has_video = match vcodec.as_deref() {
            Some("none") => false,
            Some(_) => true,
            // Some extractors leave the codec out; a picture size says enough.
            None => height.is_some(),
        };
        let has_audio = matches!(acodec.as_deref(), Some(codec) if codec != "none")
            // A single muxed file from a site that names neither codec.
            || (acodec.is_none() && vcodec.is_none() && height.is_none());

        let short = match (width, height) {
            (Some(w), Some(h)) if w > 0 && h > 0 => Some(w.min(h)),
            (_, Some(h)) if h > 0 => Some(h),
            _ => None,
        };
        let tbr = number("tbr").unwrap_or(0.0);
        let size = raw
            .get("filesize")
            .and_then(Value::as_u64)
            .or_else(|| raw.get("filesize_approx").and_then(Value::as_u64))
            .or_else(|| match duration {
                Some(seconds) if tbr > 0.0 => Some((tbr * 125.0 * seconds) as u64),
                _ => None,
            });

        Some(Self {
            direct: protocol.is_empty() || protocol == "http" || protocol == "https",
            has_video,
            has_audio,
            rung: if has_video { short.and_then(snap) } else { None },
            fps: number("fps").unwrap_or(0.0),
            hdr: text("dynamic_range").is_some_and(|range| !range.eq_ignore_ascii_case("sdr")),
            tbr,
            abr: number("abr").unwrap_or(if has_video { 0.0 } else { tbr }),
            size,
            language: text("language").filter(|lang| !lang.is_empty()),
            language_preference: raw.get("language_preference").and_then(Value::as_i64).unwrap_or(-1),
            vcodec,
            acodec,
        })
    }

    fn vcodec_family(&self) -> &'static str {
        codec_family(self.vcodec.as_deref().unwrap_or(""))
    }

    fn acodec_family(&self) -> &'static str {
        codec_family(self.acodec.as_deref().unwrap_or(""))
    }
}

/// The codec family a yt-dlp codec string belongs to. `avc1.640028` and
/// `h264` are both H.264; `mp4a.40.2` is AAC.
fn codec_family(codec: &str) -> &'static str {
    let codec = codec.to_ascii_lowercase();
    match () {
        _ if codec.starts_with("avc") || codec.starts_with("h264") => "h264",
        _ if codec.starts_with("hev") || codec.starts_with("hvc") || codec.starts_with("h265") => "h265",
        _ if codec.starts_with("vp09") || codec.starts_with("vp9") => "vp9",
        _ if codec.starts_with("av01") || codec.starts_with("av1") => "av1",
        _ if codec.starts_with("vp8") => "vp8",
        _ if codec.starts_with("mp4a") || codec.starts_with("aac") => "aac",
        _ if codec.starts_with("opus") => "opus",
        _ if codec.starts_with("vorbis") => "vorbis",
        _ if codec.starts_with("mp3") => "mp3",
        _ if codec.starts_with("flac") => "flac",
        _ if codec.starts_with("ac-3") || codec.starts_with("ac3") => "ac3",
        _ if codec.starts_with("ec-3") || codec.starts_with("eac3") => "eac3",
        _ => "other",
    }
}

/// The ladder step a short side belongs to: the nearest one within 15%, so a
/// 1012-pixel crop is a 1080p and a 1080 is exactly that. Anything off the
/// ladder by more than that is left out of the choices -- `res:N` still finds
/// it for the step above.
fn snap(short: u32) -> Option<u32> {
    LADDER
        .iter()
        .copied()
        .min_by_key(|step| step.abs_diff(short))
        .filter(|step| (step.abs_diff(short) as f64) <= (*step as f64) * 0.15)
}

/// The format `CodecPref::Auto` lands on among same-resolution candidates:
/// highest frame rate, then H.264 > H.265 > VP9 > AV1, then highest bitrate.
fn pick_auto<'a>(at: &[&'a Format]) -> Option<&'a Format> {
    let rank = |f: &Format| match f.vcodec_family() {
        "h264" => 4,
        "h265" => 3,
        "vp9" => 2,
        "av1" => 1,
        _ => 0,
    };
    at.iter()
        .copied()
        .max_by(|a, b| {
            a.fps
                .total_cmp(&b.fps)
                .then(rank(a).cmp(&rank(b)))
                .then(a.direct.cmp(&b.direct))
                .then(a.tbr.total_cmp(&b.tbr))
        })
}

fn pick_best<'a>(candidates: impl Iterator<Item = &'a Format>) -> Option<&'a Format> {
    candidates.max_by(|a, b| {
        a.fps
            .total_cmp(&b.fps)
            .then(a.direct.cmp(&b.direct))
            .then(a.tbr.total_cmp(&b.tbr))
    })
}

fn best_audio<'a>(candidates: impl Iterator<Item = &'a Format>) -> Option<&'a Format> {
    candidates.max_by(|a, b| {
        a.language_preference
            .cmp(&b.language_preference)
            .then(a.abr.total_cmp(&b.abr))
    })
}

/// The audio tracks worth listing: the best of each codec per language, the
/// original language first.
fn audio_options(audio_only: &[&Format]) -> Vec<AudioOption> {
    let mut best: Vec<&Format> = Vec::new();
    for &format in audio_only {
        let key = (format.acodec_family(), format.language.as_deref());
        match best
            .iter_mut()
            .find(|seen| (seen.acodec_family(), seen.language.as_deref()) == key)
        {
            Some(seen) if format.abr > seen.abr => *seen = format,
            Some(_) => {}
            None => best.push(format),
        }
    }
    best.sort_by(|a, b| {
        b.language_preference
            .cmp(&a.language_preference)
            .then(b.abr.total_cmp(&a.abr))
    });
    let top_preference = best.first().map(|f| f.language_preference);
    best.into_iter()
        .take(MAX_AUDIO_OPTIONS)
        .map(|f| AudioOption {
            codec: f.acodec_family().to_string(),
            bitrate: (f.abr > 0.0).then_some(f.abr.round()),
            size_bytes: f.size,
            language: f.language.clone(),
            original: f.language_preference >= 10 || Some(f.language_preference) == top_preference,
        })
        .collect()
}

fn subtitles(value: &Value) -> Vec<SubtitleTrack> {
    let Some(map) = value.get("subtitles").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut tracks: Vec<SubtitleTrack> = map
        .iter()
        // YouTube lists its live chat replay here; it is not a subtitle.
        .filter(|(lang, _)| *lang != "live_chat")
        .map(|(lang, entries)| SubtitleTrack {
            lang: lang.clone(),
            name: entries
                .as_array()
                .and_then(|list| list.first())
                .and_then(|entry| entry.get("name"))
                .and_then(Value::as_str)
                .map(str::to_string),
        })
        .collect();
    tracks.sort_by(|a, b| a.lang.cmp(&b.lang));
    tracks
}

/// Machine captions in the spoken language and in the app's own three.
///
/// YouTube offers a hundred auto-translated tracks per video; listing them all
/// would bury the two anyone wants.
fn auto_captions(value: &Value) -> Vec<String> {
    let Some(map) = value.get("automatic_captions").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut langs: Vec<String> = Vec::new();
    for lang in map.keys() {
        if let Some(spoken) = lang.strip_suffix("-orig") {
            if !langs.iter().any(|seen| seen == spoken) {
                langs.insert(0, spoken.to_string());
            }
        }
    }
    for wanted in ["fa", "en", "ar"] {
        if map.contains_key(wanted) && !langs.iter().any(|seen| seen == wanted) {
            langs.push(wanted.to_string());
        }
    }
    langs
}

fn suggests_audio(value: &Value) -> bool {
    let extractor = value
        .get("extractor_key")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    let page = value
        .get("webpage_url")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    AUDIO_FIRST_EXTRACTORS
        .iter()
        .any(|name| extractor.starts_with(name))
        || page.contains("music.youtube.com")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The shape of a YouTube `-J`, trimmed to the formats that matter: H.264
    /// up to 1080p, VP9 and AV1 up to 2160p, AAC and Opus audio, a storyboard.
    fn youtube() -> Value {
        json!({
            "duration": 600.0,
            "extractor_key": "Youtube",
            "webpage_url": "https://www.youtube.com/watch?v=abc",
            "formats": [
                {"format_id": "sb0", "ext": "mhtml", "protocol": "mhtml", "vcodec": "none", "acodec": "none", "format_note": "storyboard"},
                {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "abr": 129.5, "tbr": 129.5, "filesize": 9_700_000, "language": "en", "language_preference": 10},
                {"format_id": "251", "ext": "webm", "vcodec": "none", "acodec": "opus", "abr": 160.0, "tbr": 160.0, "filesize": 11_000_000, "language": "en", "language_preference": 10},
                {"format_id": "251-1", "ext": "webm", "vcodec": "none", "acodec": "opus", "abr": 150.0, "tbr": 150.0, "language": "es", "language_preference": -1},
                {"format_id": "136", "ext": "mp4", "vcodec": "avc1.4d401f", "acodec": "none", "width": 1280, "height": 720, "fps": 30.0, "tbr": 1500.0, "filesize": 110_000_000},
                {"format_id": "298", "ext": "mp4", "vcodec": "avc1.4d4020", "acodec": "none", "width": 1280, "height": 720, "fps": 60.0, "tbr": 2500.0, "filesize": 180_000_000},
                {"format_id": "299", "ext": "mp4", "protocol": "https", "vcodec": "avc1.64002a", "acodec": "none", "width": 1920, "height": 1080, "fps": 60.0, "tbr": 4400.0, "filesize": 330_000_000},
                {"format_id": "312", "ext": "mp4", "protocol": "m3u8_native", "vcodec": "avc1.64002a", "acodec": "none", "width": 1920, "height": 1080, "fps": 60.0, "tbr": 7400.0},
                {"format_id": "303", "ext": "webm", "vcodec": "vp09.00.41.08", "acodec": "none", "width": 1920, "height": 1080, "fps": 60.0, "tbr": 3000.0, "filesize": 220_000_000},
                {"format_id": "308", "ext": "webm", "vcodec": "vp09.00.50.08", "acodec": "none", "width": 2560, "height": 1440, "fps": 60.0, "tbr": 9000.0, "filesize": 670_000_000},
                {"format_id": "315", "ext": "webm", "vcodec": "vp09.00.51.08", "acodec": "none", "width": 3840, "height": 2160, "fps": 60.0, "tbr": 18000.0, "filesize": 1_350_000_000},
                {"format_id": "401", "ext": "mp4", "vcodec": "av01.0.13M.08", "acodec": "none", "width": 3840, "height": 2160, "fps": 60.0, "tbr": 12000.0, "filesize": 900_000_000, "dynamic_range": "HDR10"},
                {"format_id": "18", "ext": "mp4", "vcodec": "avc1.42001E", "acodec": "mp4a.40.2", "width": 640, "height": 360, "fps": 30.0, "tbr": 500.0}
            ],
            "subtitles": {"en": [{"ext": "vtt", "name": "English"}], "live_chat": [{"ext": "json"}]},
            "automatic_captions": {"en-orig": [{}], "en": [{}], "fa": [{}], "de": [{}]},
            "chapters": [{"start_time": 0}, {"start_time": 60}, {"start_time": 120}]
        })
    }

    #[test]
    fn lists_every_resolution_including_those_above_h264() {
        let summary = summarize(&youtube()).unwrap();
        let heights: Vec<u32> = summary.heights.iter().map(|h| h.height).collect();
        assert_eq!(heights, vec![2160, 1440, 1080, 720, 360]);

        let uhd = &summary.heights[0];
        assert!(uhd.hdr);
        assert_eq!(uhd.fps, 60.0);
        // No H.264 at 2160p, so nothing compatible to quote.
        assert_eq!(uhd.compatible_size_bytes, None);
        // Auto picks VP9 over AV1 at equal fps (codec rank), plus AAC audio.
        assert_eq!(uhd.size_bytes, Some(1_350_000_000 + 9_700_000));

        let fhd = summary.heights.iter().find(|h| h.height == 1080).unwrap();
        // At 1080p60 both H.264 and VP9 exist; auto takes H.264.
        assert_eq!(fhd.size_bytes, Some(330_000_000 + 9_700_000));
        assert_eq!(fhd.compatible_size_bytes, Some(330_000_000 + 9_700_000));

        let hd = summary.heights.iter().find(|h| h.height == 720).unwrap();
        // The 60 fps one wins over the 30 fps one.
        assert_eq!(hd.size_bytes, Some(180_000_000 + 9_700_000));

        // The muxed 360p already carries sound; its size is estimated from tbr.
        let sd = summary.heights.iter().find(|h| h.height == 360).unwrap();
        assert_eq!(sd.size_bytes, Some((500.0 * 125.0 * 600.0) as u64));
    }

    #[test]
    fn audio_tracks_original_language_first_best_of_each_codec() {
        let summary = summarize(&youtube()).unwrap();
        let tracks: Vec<(&str, Option<&str>)> = summary
            .audio
            .iter()
            .map(|a| (a.codec.as_str(), a.language.as_deref()))
            .collect();
        assert_eq!(tracks, vec![("opus", Some("en")), ("aac", Some("en")), ("opus", Some("es"))]);
        assert!(summary.audio[0].original);
        assert!(!summary.audio[2].original);
        assert_eq!(summary.audio[0].bitrate, Some(160.0));
    }

    #[test]
    fn subtitles_chapters_and_captions() {
        let summary = summarize(&youtube()).unwrap();
        assert_eq!(
            summary.subtitles,
            vec![SubtitleTrack { lang: "en".into(), name: Some("English".into()) }]
        );
        // The spoken language first, then the app's own languages that exist.
        assert_eq!(summary.auto_captions, vec!["en".to_string(), "fa".to_string()]);
        assert_eq!(summary.chapters, 3);
        assert!(!summary.is_live);
        assert!(summary.has_video);
        assert!(!summary.suggests_audio);
    }

    #[test]
    fn portrait_video_is_named_by_its_short_side() {
        let value = json!({
            "duration": 30.0,
            "formats": [
                {"vcodec": "avc1.64001f", "acodec": "none", "width": 1080, "height": 1920, "fps": 30.0, "tbr": 3000.0},
                {"vcodec": "avc1.64001f", "acodec": "none", "width": 720, "height": 1280, "fps": 30.0, "tbr": 1500.0},
            ]
        });
        let heights: Vec<u32> = summarize(&value).unwrap().heights.iter().map(|h| h.height).collect();
        assert_eq!(heights, vec![1080, 720]);
    }

    #[test]
    fn odd_sizes_snap_to_the_nearest_step() {
        assert_eq!(snap(1012), Some(1080));
        assert_eq!(snap(1080), Some(1080));
        assert_eq!(snap(406), Some(360));
        // Halfway between 480 and 720 is close to neither.
        assert_eq!(snap(600), None);
    }

    #[test]
    fn audio_sites_and_audio_only_pages_open_on_audio() {
        let soundcloud = json!({
            "extractor_key": "Soundcloud",
            "formats": [{"vcodec": "none", "acodec": "opus", "abr": 64.0}]
        });
        assert!(summarize(&soundcloud).unwrap().suggests_audio);

        let music = json!({
            "extractor_key": "Youtube",
            "webpage_url": "https://music.youtube.com/watch?v=x",
            "formats": [{"vcodec": "avc1", "acodec": "none", "height": 720}]
        });
        assert!(summarize(&music).unwrap().suggests_audio);
    }

    /// Against a real capture: `MTK_FORMATS_JSON=/path/to/yt-dlp-J.json
    /// cargo test --lib real_capture -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_capture() {
        let path = std::env::var("MTK_FORMATS_JSON").expect("MTK_FORMATS_JSON");
        let value: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let summary = summarize(&value).unwrap();
        println!("{}", serde_json::to_string_pretty(&summary).unwrap());
        assert!(!summary.heights.is_empty());
    }

    #[test]
    fn no_formats_is_no_summary() {
        assert_eq!(summarize(&json!({"title": "x"})), None);
        assert_eq!(summarize(&json!({"formats": []})), None);
    }

    #[test]
    fn selection_puts_resolution_before_codec() {
        assert_eq!(
            video_selection(Some(2160), CodecPref::Auto),
            vec!["-f", "bv*+ba/b", "-S", "res:2160,fps,+codec:avc:m4a"]
        );
        assert_eq!(
            video_selection(None, CodecPref::Auto),
            vec!["-f", "bv*+ba/b", "-S", "res,fps,+codec:avc:m4a"]
        );
        assert_eq!(
            video_selection(Some(1080), CodecPref::Compatible)[3],
            "+vcodec:avc,res:1080,fps,+acodec:m4a"
        );
        assert_eq!(video_selection(Some(720), CodecPref::Small)[3], "res:720,fps,+codec:av01:opus");
    }

    #[test]
    fn audio_selection_per_format() {
        assert_eq!(audio_selection(AudioFormat::Original), vec!["-f", "ba/b"]);
        assert_eq!(audio_selection(AudioFormat::M4a), vec!["-f", "ba[acodec^=mp4a]/ba/b"]);
        assert_eq!(audio_selection(AudioFormat::Opus), vec!["-f", "ba[acodec=opus]/ba/b"]);
        assert_eq!(audio_selection(AudioFormat::Mp3), vec!["-f", "ba/b"]);
    }
}
