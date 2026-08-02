//! Turning segments into a file.
//!
//! Pure and separately tested, because the difference between SRT and VTT is
//! two characters and a header, and getting either wrong makes a player show
//! nothing at all rather than complain.

use serde::Deserialize;

use super::chunks::Segment;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputFormat {
    Txt,
    Srt,
    Vtt,
}

impl OutputFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Txt => "txt",
            Self::Srt => "srt",
            Self::Vtt => "vtt",
        }
    }
}

pub fn render(format: OutputFormat, segments: &[Segment]) -> String {
    match format {
        OutputFormat::Txt => txt(segments),
        OutputFormat::Srt => srt(segments),
        OutputFormat::Vtt => vtt(segments),
    }
}

/// Plain text: the words, one line per segment.
///
/// No timecodes. Someone who wanted them asked for subtitles; this format
/// exists to be pasted somewhere else.
fn txt(segments: &[Segment]) -> String {
    let mut out = segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out
}

fn srt(segments: &[Segment]) -> String {
    let mut out = String::new();
    for (index, segment) in segments.iter().enumerate() {
        // SubRip cues are numbered from one. A zero-indexed file loads in some
        // players and silently shows nothing in others.
        out.push_str(&format!("{}\n", index + 1));
        out.push_str(&format!(
            "{} --> {}\n",
            timecode(segment.start, ','),
            timecode(segment.end.max(segment.start), ',')
        ));
        out.push_str(segment.text.trim());
        out.push_str("\n\n");
    }
    out
}

fn vtt(segments: &[Segment]) -> String {
    // The header is mandatory; without it the file is not WebVTT and browsers
    // reject it outright.
    let mut out = String::from("WEBVTT\n\n");
    for segment in segments {
        out.push_str(&format!(
            "{} --> {}\n",
            timecode(segment.start, '.'),
            timecode(segment.end.max(segment.start), '.')
        ));
        out.push_str(segment.text.trim());
        out.push_str("\n\n");
    }
    out
}

/// `HH:MM:SS,mmm` for SubRip and `HH:MM:SS.mmm` for WebVTT.
///
/// The separator is the entire difference between the two formats' timestamps,
/// and it is the single most common way to produce a subtitle file that loads
/// without error and displays nothing.
///
/// Hours are always written, even when zero: both formats permit `MM:SS.mmm`
/// in places, but every player accepts the long form and only some accept the
/// short one. ASCII digits regardless of the transcript's script -- a timecode
/// is machine-read, and Persian digits here make the file invalid.
fn timecode(seconds: f64, separator: char) -> String {
    let seconds = if seconds.is_finite() { seconds.max(0.0) } else { 0.0 };
    let total_ms = (seconds * 1000.0).round() as u64;
    let ms = total_ms % 1000;
    let total = total_ms / 1000;
    format!(
        "{:02}:{:02}:{:02}{separator}{:03}",
        total / 3600,
        (total % 3600) / 60,
        total % 60,
        ms
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segments() -> Vec<Segment> {
        vec![
            Segment {
                start: 0.0,
                end: 2.5,
                text: "Hello there.".into(),
            },
            Segment {
                start: 2.5,
                end: 4.25,
                text: "Welcome.".into(),
            },
        ]
    }

    /// The one difference between the two formats' timestamps, and the reason a
    /// subtitle file loads and then shows nothing.
    #[test]
    fn srt_separates_milliseconds_with_a_comma_and_vtt_with_a_dot() {
        assert_eq!(timecode(4.25, ','), "00:00:04,250");
        assert_eq!(timecode(4.25, '.'), "00:00:04.250");
    }

    #[test]
    fn hours_survive_past_the_hour_mark() {
        // 1:01:01.500 -- the case a mm:ss formatter silently truncates.
        assert_eq!(timecode(3661.5, ','), "01:01:01,500");
        assert_eq!(timecode(7200.0, '.'), "02:00:00.000");
    }

    #[test]
    fn a_negative_or_nonsense_time_clamps_to_zero() {
        // Whisper has been seen returning a very small negative start.
        assert_eq!(timecode(-0.4, ','), "00:00:00,000");
        assert_eq!(timecode(f64::NAN, ','), "00:00:00,000");
    }

    #[test]
    fn srt_cues_are_numbered_from_one_and_separated_by_a_blank_line() {
        let out = srt(&segments());
        assert!(out.starts_with("1\n00:00:00,000 --> 00:00:02,500\n"), "{out}");
        assert!(out.contains("\n\n2\n"), "{out}");
        assert!(out.ends_with("\n\n"), "{out:?}");
    }

    #[test]
    fn vtt_starts_with_the_mandatory_header() {
        let out = vtt(&segments());
        assert!(out.starts_with("WEBVTT\n\n"), "{out}");
        // VTT cues are not numbered.
        assert!(!out.contains("\n1\n"), "{out}");
    }

    #[test]
    fn txt_is_the_words_with_no_timecodes() {
        let out = txt(&segments());
        assert_eq!(out, "Hello there.\nWelcome.\n");
        assert!(!out.contains("-->"));
    }

    #[test]
    fn an_empty_transcript_renders_without_a_stray_newline() {
        assert_eq!(txt(&[]), "");
        assert_eq!(srt(&[]), "");
        assert_eq!(vtt(&[]), "WEBVTT\n\n");
    }

    /// Guards any future attempt to truncate or pad by byte index: slicing
    /// Persian text on a byte boundary panics, and `paths.rs` has the same note
    /// for the same reason.
    #[test]
    fn non_latin_text_survives_byte_for_byte() {
        let persian = "سلام، به این جلسه خوش آمدید.";
        let out = srt(&[Segment {
            start: 0.0,
            end: 3.0,
            text: persian.into(),
        }]);
        assert!(out.contains(persian), "{out}");
        // The timecode around it stays ASCII, or no player can read the file.
        assert!(out.contains("00:00:00,000 --> 00:00:03,000"), "{out}");
    }

    #[test]
    fn an_end_before_its_start_is_not_written_backwards() {
        // A backwards cue makes some players drop the rest of the file.
        let out = srt(&[Segment {
            start: 5.0,
            end: 4.0,
            text: "oops".into(),
        }]);
        assert!(out.contains("00:00:05,000 --> 00:00:05,000"), "{out}");
    }
}
