//! Splitting long audio into requests, and stitching the answers back together.
//!
//! Pure, for the same reason `media/ops.rs` is pure: this is the arithmetic most
//! likely to be quietly wrong, and a merge bug does not crash -- it produces a
//! plausible transcript with a duplicated or missing sentence at every seam,
//! which no smoke test catches. All of it is testable without a network.

use crate::error::{AppError, AppResult};

/// Groq's free tier caps a request at 25 MB; this is that with headroom.
///
/// Not made configurable from the tier. The dev tier is 100 MB, but there is no
/// way to ask a key which tier it is on, and an oversized request fails only
/// after the entire body has been uploaded. Sizing for the smaller limit costs a
/// few extra round trips on a long file and is correct on both.
pub const MAX_UPLOAD_BYTES: u64 = 24 * 1024 * 1024;

/// Ten minutes, the length Groq's own cookbook chunks at. At 16 kHz mono FLAC
/// that lands around 8-11 MB, well under the ceiling -- the margin is what
/// absorbs noisy source material, where FLAC compresses badly.
pub const TARGET_CHUNK_SECS: f64 = 600.0;

/// Shared audio on each side of a seam.
///
/// Whisper needs preceding audio to punctuate and to finish a word; cut hard at
/// ten minutes and it mangles a token on both sides of the cut. Each chunk is
/// therefore *sent* with this much extra on each side, while still only being
/// credited with the span it owns.
///
/// This is billed audio, which is why the quota estimate counts what is sent
/// rather than the length of the file.
pub const OVERLAP_SECS: f64 = 5.0;

/// A floor on the chunk length, so a pathological bitrate cannot produce
/// thousands of requests.
const MIN_CHUNK_SECS: f64 = 30.0;

/// Past this the job is refused rather than started. Sixty-four requests is
/// already a ten-hour recording; anything more is a mistake -- an ISO, a
/// mislabelled file -- and launching a hundred billable uploads to discover
/// that is the wrong way to find out.
const MAX_CHUNKS: usize = 64;

/// Groq bills in whole seconds with a ten-second minimum per request.
const MIN_BILLED_SECS: f64 = 10.0;

/// One request's worth of audio.
///
/// `start`/`len` are what this chunk *owns* on the source timeline. What is
/// actually sent is `cut_window`, which is wider on both sides.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChunkSpec {
    pub index: usize,
    pub start: f64,
    pub len: f64,
}

impl ChunkSpec {
    pub fn end(&self) -> f64 {
        self.start + self.len
    }
}

/// One line of transcript with the time it was spoken.
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

impl Segment {
    fn midpoint(&self) -> f64 {
        (self.start + self.end) / 2.0
    }
}

/// How the file is divided, decided by bytes rather than by minutes.
///
/// Duration alone is the wrong test. Ten minutes of a noisy room compresses to
/// roughly twice what ten minutes of clean speech does, and the limit that
/// matters is 25 MB, not ten minutes. By the time this runs the FLAC has been
/// produced, so its real bytes-per-second is known and the chunk length is
/// derived from it instead of guessed.
pub fn chunk_plan(duration_secs: f64, flac_bytes: u64) -> AppResult<Vec<ChunkSpec>> {
    if !duration_secs.is_finite() || duration_secs <= 0.0 {
        return Err(AppError::invalid("input", "the audio has no duration"));
    }

    // Fits in one request: no chunking, no overlap, nothing to merge.
    if flac_bytes <= MAX_UPLOAD_BYTES && duration_secs <= TARGET_CHUNK_SECS {
        return Ok(vec![ChunkSpec {
            index: 0,
            start: 0.0,
            len: duration_secs,
        }]);
    }

    let bytes_per_sec = (flac_bytes as f64 / duration_secs).max(1.0);
    // The window sent is the chunk plus an overlap on each side, so it is the
    // window -- not the chunk -- that has to fit under the ceiling.
    let window_budget = MAX_UPLOAD_BYTES as f64 / bytes_per_sec;
    let chunk_secs = TARGET_CHUNK_SECS
        .min(window_budget - 2.0 * OVERLAP_SECS)
        .max(MIN_CHUNK_SECS);

    let count = (duration_secs / chunk_secs).ceil().max(1.0);
    if count as usize > MAX_CHUNKS {
        return Err(AppError::invalid(
            "input",
            "this file is too long to transcribe in one go",
        ));
    }

    // Divided evenly rather than cut at `chunk_secs` with whatever is left over
    // becoming a final stub.
    //
    // A stub is billed at the ten-second minimum and comes back as a fragment
    // of a sentence, so the obvious fix is to fold it into the chunk before it
    // -- and that is a bug: it makes that chunk up to a stub longer than the
    // budget the byte ceiling was derived from, and at a high bitrate the
    // request then fails at Groq *after* the whole body has been uploaded.
    // Sharing the time out equally can only make chunks shorter, so the ceiling
    // holds by construction and there is no tail to special-case.
    let count = count as usize;
    let each = duration_secs / count as f64;

    Ok((0..count)
        .map(|index| ChunkSpec {
            index,
            start: index as f64 * each,
            // The last chunk ends exactly at the duration rather than at an
            // accumulated float sum, so nothing is left untranscribed.
            len: if index + 1 == count {
                duration_secs - index as f64 * each
            } else {
                each
            },
        })
        .collect())
}

/// The span actually sent to Groq: the chunk plus context on each side,
/// clamped to the file.
///
/// Returned as `(start, len)` because that is what ffmpeg's `-ss`/`-t` take,
/// and because `-to` after `-ss` has meant different things in different ffmpeg
/// versions -- the same reason `ops::trim` uses a duration.
pub fn cut_window(chunk: &ChunkSpec, duration_secs: f64) -> (f64, f64) {
    let start = (chunk.start - OVERLAP_SECS).max(0.0);
    let end = (chunk.end() + OVERLAP_SECS).min(duration_secs);
    (start, end - start)
}

/// Audio-seconds Groq will bill for this plan.
///
/// Counts the overlaps, because Groq bills what it receives, and applies the
/// ten-second per-request minimum. The difference is not academic: a three-hour
/// recording sends several minutes more than it contains, and this number is
/// the only warning before a single file eats a day's budget.
pub fn billed_secs(chunks: &[ChunkSpec], duration_secs: f64) -> u32 {
    chunks
        .iter()
        .map(|chunk| {
            let (_, len) = cut_window(chunk, duration_secs);
            len.max(MIN_BILLED_SECS).ceil() as u32
        })
        .sum()
}

/// What a file of this length will cost, before it has been converted.
///
/// The screen needs a number while the user is still deciding, and at that
/// point there is no FLAC to measure. Assumes the duration-driven chunk length,
/// which is what an ordinary speech recording gets; a file that turns out to
/// need smaller chunks bills slightly more than this said.
pub fn estimate_billed_secs(duration_secs: f64) -> u32 {
    if !duration_secs.is_finite() || duration_secs <= 0.0 {
        return 0;
    }
    match chunk_plan(duration_secs, estimated_flac_bytes(duration_secs)) {
        Ok(chunks) => billed_secs(&chunks, duration_secs),
        // Too long to plan: still worth showing what it would cost, so the
        // refusal reads as "too long" rather than as "free".
        Err(_) => duration_secs.ceil() as u32,
    }
}

/// 16 kHz mono FLAC of speech, measured across a handful of podcast and lecture
/// sources, runs about 13 KB/s. Only used for the pre-conversion estimate.
fn estimated_flac_bytes(duration_secs: f64) -> u64 {
    (duration_secs * 13_000.0) as u64
}

/// Puts every chunk's segments back on the source timeline as one transcript.
///
/// Each chunk's times come back relative to the *window* that was sent, so they
/// are first offset by where that window began. Then each segment is kept by
/// exactly one chunk: the one whose owned span contains the segment's midpoint.
///
/// The midpoint, not the start. A segment straddling a seam has to be claimed
/// by one side or the other, and the side that heard more of it is the side
/// with the better transcription of it. Keying on the start instead would
/// always award a straddling phrase to the earlier chunk, which is the chunk
/// that was running out of audio when it said it.
pub fn merge_segments(chunks: &[(ChunkSpec, Vec<Segment>)], duration_secs: f64) -> Vec<Segment> {
    let single = chunks.len() == 1;
    let mut merged: Vec<Segment> = Vec::new();

    for (chunk, segments) in chunks {
        let (window_start, _) = cut_window(chunk, duration_secs);
        for segment in segments {
            let shifted = Segment {
                start: segment.start + window_start,
                end: segment.end.max(segment.start) + window_start,
                text: segment.text.trim().to_string(),
            };
            if shifted.text.is_empty() {
                continue;
            }
            // With one chunk there is no seam and nothing to arbitrate, so
            // nothing is discarded -- Whisper can and does report a timestamp
            // slightly past the probed duration on the final segment.
            if single || owns(chunk, &shifted, chunks.len()) {
                merged.push(shifted);
            }
        }
    }

    merged.sort_by(|a, b| a.start.total_cmp(&b.start));
    dedupe_adjacent(merged)
}

/// Whether this chunk is the one that keeps a segment.
///
/// The first and last chunks also take everything outside the timeline on their
/// side, so a segment Whisper timestamps slightly before zero or past the end
/// is never silently dropped.
fn owns(chunk: &ChunkSpec, segment: &Segment, total: usize) -> bool {
    let mid = segment.midpoint();
    let after_start = mid >= chunk.start || chunk.index == 0;
    let before_end = mid < chunk.end() || chunk.index + 1 == total;
    after_start && before_end
}

/// Drops Whisper repeating itself.
///
/// On silence and at cut points Whisper loops, emitting the same phrase two or
/// three times in a row. Identical neighbouring text is dropped only when the
/// two ranges actually touch -- that is the signature of the loop. The same
/// sentence said again a minute later is someone repeating themselves, and it
/// stays.
pub fn dedupe_adjacent(segments: Vec<Segment>) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::with_capacity(segments.len());
    for segment in segments {
        let duplicate = out.last().is_some_and(|previous| {
            normalize(&previous.text) == normalize(&segment.text)
                // Touching or overlapping, with a second of slack for the gap
                // Whisper leaves between two halves of a loop.
                && segment.start <= previous.end + 1.0
        });
        if duplicate {
            // Keep the longer reading of the same words rather than the first.
            if let Some(previous) = out.last_mut() {
                previous.end = previous.end.max(segment.end);
            }
            continue;
        }
        out.push(segment);
    }
    out
}

/// Compares what was said, not how it was punctuated. Whisper's two passes over
/// the same audio routinely differ only by a trailing full stop or by case.
fn normalize(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(start: f64, end: f64, text: &str) -> Segment {
        Segment {
            start,
            end,
            text: text.to_string(),
        }
    }

    /// A voice memo must not be split, or every short job pays an extra round
    /// trip and the ten-second billing minimum twice.
    #[test]
    fn short_audio_is_a_single_request() {
        let plan = chunk_plan(90.0, 1_200_000).unwrap();
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].start, 0.0);
        assert_eq!(plan[0].len, 90.0);
    }

    /// The ceiling is bytes, not minutes. A noisy nine-minute recording is under
    /// TARGET_CHUNK_SECS and still far too large to send, and sizing on duration
    /// would upload the whole thing before finding out.
    #[test]
    fn chunk_length_is_driven_by_bytes_not_by_minutes() {
        let duration = 540.0;
        // 60 KB/s: a hall recording with heavy background noise.
        let noisy = chunk_plan(duration, (duration * 60_000.0) as u64).unwrap();
        assert!(noisy.len() > 1, "a 32 MB file must be split: {noisy:?}");

        // The same nine minutes of clean speech fits in one request.
        let clean = chunk_plan(duration, (duration * 13_000.0) as u64).unwrap();
        assert_eq!(clean.len(), 1);
    }

    /// Every window actually sent has to fit under the ceiling, overlap
    /// included -- the overlap is what makes a chunk sized to exactly the limit
    /// fail after a full upload.
    #[test]
    fn every_window_stays_under_the_upload_ceiling() {
        let duration = 7_200.0;
        let bytes_per_sec = 40_000.0;
        let plan = chunk_plan(duration, (duration * bytes_per_sec) as u64).unwrap();

        for chunk in &plan {
            let (_, len) = cut_window(chunk, duration);
            let bytes = (len * bytes_per_sec) as u64;
            assert!(
                bytes <= MAX_UPLOAD_BYTES,
                "chunk {} sends {bytes} bytes",
                chunk.index
            );
        }
    }

    /// The owned spans must tile the file exactly: a gap is a missing sentence
    /// and an overlap is a duplicated one.
    #[test]
    fn owned_spans_tile_the_whole_file() {
        let duration = 3_600.0;
        let plan = chunk_plan(duration, (duration * 13_000.0) as u64).unwrap();

        assert_eq!(plan[0].start, 0.0);
        for pair in plan.windows(2) {
            assert!(
                (pair[0].end() - pair[1].start).abs() < 1e-6,
                "gap between {:?} and {:?}",
                pair[0],
                pair[1]
            );
        }
        assert!((plan.last().unwrap().end() - duration).abs() < 1e-6);
    }

    /// A four-second tail would be billed at the ten-second minimum and come
    /// back as a fragment of a word.
    #[test]
    fn never_leaves_a_stub_final_chunk() {
        let duration = 600.0 * 3.0 + 4.0;
        let plan = chunk_plan(duration, (duration * 13_000.0) as u64).unwrap();
        assert!(plan.last().unwrap().len > 60.0, "stub tail: {plan:?}");
        assert!((plan.last().unwrap().end() - duration).abs() < 1e-6);
    }

    /// The regression this module's shape exists for.
    ///
    /// Absorbing a short tail into the previous chunk -- the obvious way to
    /// avoid a stub -- makes that chunk longer than the budget the byte ceiling
    /// was derived from. At a high bitrate the merged window went over 25 MB,
    /// and Groq only says so after the entire body has been uploaded. These are
    /// exactly the durations where a naive cut leaves a tail.
    #[test]
    fn a_short_tail_never_pushes_a_chunk_over_the_ceiling() {
        for bytes_per_sec in [20_000.0, 45_000.0, 90_000.0, 150_000.0] {
            for duration in [350.0, 610.0, 1_205.0, 1_810.0, 3_602.0, 7_204.0] {
                let plan = chunk_plan(duration, (duration * bytes_per_sec) as u64).unwrap();
                for chunk in &plan {
                    let (_, len) = cut_window(chunk, duration);
                    let bytes = (len * bytes_per_sec) as u64;
                    assert!(
                        bytes <= MAX_UPLOAD_BYTES,
                        "{duration}s at {bytes_per_sec} B/s: chunk {} sends {bytes} bytes",
                        chunk.index
                    );
                }
            }
        }
    }

    /// Equal division, so no chunk is meaningfully longer than any other and
    /// the progress bar advances in even steps.
    #[test]
    fn chunks_are_all_the_same_length() {
        let duration = 3_602.0;
        let plan = chunk_plan(duration, (duration * 13_000.0) as u64).unwrap();
        let first = plan[0].len;
        for chunk in &plan {
            assert!((chunk.len - first).abs() < 1e-6, "{plan:?}");
        }
    }

    #[test]
    fn refuses_a_file_that_would_need_a_hundred_requests() {
        // Thirty hours: not a recording anyone meant to transcribe.
        let duration = 108_000.0;
        assert!(chunk_plan(duration, (duration * 13_000.0) as u64).is_err());
    }

    #[test]
    fn a_file_with_no_duration_is_refused_rather_than_divided_by_zero() {
        assert!(chunk_plan(0.0, 1_000).is_err());
        assert!(chunk_plan(f64::NAN, 1_000).is_err());
    }

    /// The window is what gets sent, so it carries context on both sides -- and
    /// it must not run off either end of the file.
    #[test]
    fn cut_windows_carry_context_without_leaving_the_file() {
        let duration = 1_200.0;
        let plan = chunk_plan(duration, (duration * 13_000.0) as u64).unwrap();

        let (first_start, _) = cut_window(&plan[0], duration);
        assert_eq!(first_start, 0.0, "cannot seek before the start");

        let last = plan.last().unwrap();
        let (start, len) = cut_window(last, duration);
        assert!(start + len <= duration + 1e-9, "runs past the end");

        // A middle chunk gets context on both sides.
        if plan.len() > 2 {
            let (start, len) = cut_window(&plan[1], duration);
            assert!((start - (plan[1].start - OVERLAP_SECS)).abs() < 1e-9);
            assert!((len - (plan[1].len + 2.0 * OVERLAP_SECS)).abs() < 1e-9);
        }
    }

    /// Times come back relative to the window that was sent, and a chunk's
    /// window starts before the chunk does. Offsetting by the chunk's start
    /// instead of the window's start would slide every seam five seconds late.
    #[test]
    fn merge_offsets_by_the_window_not_by_the_chunk() {
        let duration = 1_200.0;
        let chunks = chunk_plan(duration, (duration * 13_000.0) as u64).unwrap();
        assert!(chunks.len() >= 2);

        let second = chunks[1];
        let (window_start, _) = cut_window(&second, duration);
        // A segment 20 s into the window that was sent.
        let merged = merge_segments(
            &[
                (chunks[0], vec![]),
                (second, vec![segment(20.0, 24.0, "hello")]),
            ],
            duration,
        );
        assert_eq!(merged.len(), 1);
        assert!((merged[0].start - (window_start + 20.0)).abs() < 1e-9);
    }

    /// The seam test. The same words are transcribed by both chunks, because
    /// that is what the overlap is for -- exactly one copy may survive.
    #[test]
    fn a_phrase_in_the_overlap_survives_exactly_once() {
        let duration = 1_200.0;
        let chunks = chunk_plan(duration, (duration * 13_000.0) as u64).unwrap();
        let boundary = chunks[0].end();

        let (first_window, _) = cut_window(&chunks[0], duration);
        let (second_window, _) = cut_window(&chunks[1], duration);

        // A phrase straddling the boundary, heard by both.
        let in_first = segment(
            boundary - 1.0 - first_window,
            boundary + 2.0 - first_window,
            "the same words",
        );
        let in_second = segment(
            boundary - 1.0 - second_window,
            boundary + 2.0 - second_window,
            "the same words",
        );

        let merged = merge_segments(
            &[(chunks[0], vec![in_first]), (chunks[1], vec![in_second])],
            duration,
        );
        assert_eq!(merged.len(), 1, "duplicated at the seam: {merged:?}");
        // Midpoint is past the boundary, so the later chunk -- which heard the
        // whole phrase rather than running out of audio mid-way -- keeps it.
        assert!((merged[0].start - (boundary - 1.0)).abs() < 1e-6);
    }

    /// Nothing before the first chunk or after the last may be discarded:
    /// Whisper timestamps the final segment slightly past the probed duration
    /// often enough that dropping it would lose the last sentence of most files.
    #[test]
    fn keeps_segments_that_fall_outside_the_timeline() {
        let duration = 60.0;
        let chunks = chunk_plan(duration, 700_000).unwrap();
        let merged = merge_segments(
            &[(chunks[0], vec![segment(58.0, 62.0, "goodbye")])],
            duration,
        );
        assert_eq!(merged.len(), 1);
    }

    #[test]
    fn merged_segments_come_back_in_order() {
        let duration = 1_800.0;
        let chunks = chunk_plan(duration, (duration * 13_000.0) as u64).unwrap();
        let input: Vec<_> = chunks
            .iter()
            .map(|chunk| {
                let (window, _) = cut_window(chunk, duration);
                (
                    *chunk,
                    vec![segment(
                        chunk.start + 1.0 - window,
                        chunk.start + 3.0 - window,
                        &format!("part {}", chunk.index),
                    )],
                )
            })
            .collect();

        let merged = merge_segments(&input, duration);
        assert_eq!(merged.len(), chunks.len());
        for pair in merged.windows(2) {
            assert!(pair[0].start <= pair[1].start, "{merged:?}");
        }
    }

    /// Whisper loops on silence, emitting a phrase two or three times running.
    #[test]
    fn drops_a_repeat_that_touches_but_keeps_one_a_minute_later() {
        let looped = dedupe_adjacent(vec![
            segment(10.0, 12.0, "Thank you."),
            segment(12.0, 14.0, "thank you"),
            segment(90.0, 92.0, "Thank you."),
        ]);
        assert_eq!(looped.len(), 2, "{looped:?}");
        // The surviving copy spans both readings.
        assert_eq!(looped[0].end, 14.0);
        assert_eq!(looped[1].start, 90.0);
    }

    #[test]
    fn empty_and_whitespace_segments_are_dropped() {
        let duration = 60.0;
        let chunks = chunk_plan(duration, 700_000).unwrap();
        let merged = merge_segments(
            &[(
                chunks[0],
                vec![segment(1.0, 2.0, "   "), segment(3.0, 4.0, " hi ")],
            )],
            duration,
        );
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].text, "hi");
    }

    /// Normalizing must not treat two different Persian sentences as the same,
    /// which a naive "strip everything non-ASCII" would.
    #[test]
    fn deduping_compares_non_latin_text_properly() {
        let kept = dedupe_adjacent(vec![
            segment(0.0, 2.0, "سلام، خوش آمدید."),
            segment(2.0, 4.0, "امروز درباره‌ی چیز دیگری صحبت می‌کنیم"),
        ]);
        assert_eq!(kept.len(), 2, "two different sentences collapsed: {kept:?}");

        let looped = dedupe_adjacent(vec![
            segment(0.0, 2.0, "سلام، خوش آمدید."),
            segment(2.0, 4.0, "سلام خوش آمدید"),
        ]);
        assert_eq!(looped.len(), 1, "a real repeat survived: {looped:?}");
    }

    /// The estimate exists to stop a single file eating a day's budget without
    /// warning, so it must count the overlaps rather than the file's length.
    #[test]
    fn the_estimate_counts_what_is_sent_not_the_files_length() {
        let duration = 3_600.0;
        let estimate = estimate_billed_secs(duration);
        assert!(
            estimate > duration as u32,
            "overlaps are billed too: {estimate} vs {duration}"
        );
        // But not wildly more -- six seams at ten seconds each.
        assert!(estimate < duration as u32 + 120, "{estimate}");
    }

    #[test]
    fn billing_never_charges_less_than_the_ten_second_minimum() {
        let chunk = ChunkSpec {
            index: 0,
            start: 0.0,
            len: 3.0,
        };
        assert_eq!(billed_secs(&[chunk], 3.0), 10);
    }
}
