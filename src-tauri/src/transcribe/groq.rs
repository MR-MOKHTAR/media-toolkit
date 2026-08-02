//! The Groq speech-to-text client.
//!
//! One request per chunk, multipart, with the retry policy that a metered API
//! needs: honour `retry-after` when it is short, give up with a real reset time
//! when it is long, and never turn a rate limit into a hot loop.

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::chunks::Segment;
use crate::error::{AppError, AppResult, RateScope};
use crate::jobs::CancelSignal;

const TRANSCRIPTIONS: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const TRANSLATIONS: &str = "https://api.groq.com/openai/v1/audio/translations";
const MODELS: &str = "https://api.groq.com/openai/v1/models";

const SERVICE: &str = "Groq";

/// Transcribing a ten-minute chunk takes Groq a few seconds, but a slow uplink
/// dominates: the body can be 10 MB. Matches the updater's timeout.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Longer than this and waiting inside a job is dishonest -- the bar would sit
/// still for twenty minutes with no way to tell it from a hang. Past it the job
/// fails with the reset time and lets the user decide.
const MAX_INLINE_WAIT: Duration = Duration::from_secs(120);

/// The original attempt plus three retries. A fourth retry on a 429 means the
/// budget is gone, not that the burst has not cleared.
const MAX_ATTEMPTS: u32 = 4;

/// Groq caps the vocabulary hint at 224 tokens. Characters are not tokens, but
/// this is the right order of magnitude for every script and is enforced on a
/// character boundary, never a byte one.
pub const MAX_PROMPT_CHARS: usize = 800;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Model {
    WhisperLargeV3,
    WhisperLargeV3Turbo,
}

impl Model {
    /// Short aliases, so the tests read as prose rather than as wire
    /// identifiers. Only the tests use them; the app has no reason to name a
    /// model except through what the user picked.
    #[allow(non_upper_case_globals)]
    #[cfg(test)]
    pub const LargeV3: Model = Model::WhisperLargeV3;
    #[allow(non_upper_case_globals)]
    #[cfg(test)]
    pub const Turbo: Model = Model::WhisperLargeV3Turbo;

    pub fn id(self) -> &'static str {
        match self {
            Self::WhisperLargeV3 => "whisper-large-v3",
            Self::WhisperLargeV3Turbo => "whisper-large-v3-turbo",
        }
    }

    /// Only large-v3 serves the translations endpoint. The UI keeps the two
    /// choices consistent, but a request could still arrive.
    pub fn can_translate(self) -> bool {
        matches!(self, Self::WhisperLargeV3)
    }
}

pub struct Request<'a> {
    pub key: &'a str,
    pub model: Model,
    /// ISO-639-1, or `None` to let Whisper detect it. Ignored when translating.
    pub language: Option<&'a str>,
    pub translate: bool,
    pub prompt: Option<&'a str>,
}

/// Only the fields this app reads. `verbose_json` carries a good deal more.
#[derive(Debug, Deserialize)]
struct VerboseResponse {
    #[serde(default)]
    text: String,
    #[serde(default)]
    segments: Vec<RawSegment>,
}

#[derive(Debug, Deserialize)]
struct RawSegment {
    #[serde(default)]
    start: f64,
    #[serde(default)]
    end: f64,
    #[serde(default)]
    text: String,
}

pub fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent("media-toolkit")
        .build()
        .map_err(AppError::network)
}

/// Checks a stored key by asking for the model list.
///
/// The cheapest authenticated call there is -- no audio, no billing, no quota.
pub async fn verify_key(key: &str) -> AppResult<()> {
    let response = client()?
        .get(MODELS)
        .bearer_auth(key)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(AppError::network)?;

    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    Err(AppError::api(SERVICE, status.as_u16(), message_from(&body)))
}

/// One chunk's answer.
pub struct Transcribed {
    /// Timed relative to the audio that was sent. Putting these back on the
    /// source timeline is `chunks::merge_segments`' job, and keeping that
    /// separation is what makes the merge testable.
    pub segments: Vec<Segment>,
    /// Audio-seconds Groq says are left, when it volunteered a header saying
    /// so. See `remaining_audio_secs` for why this is optional and untrusted.
    pub remaining_audio_secs: Option<u32>,
}

/// Transcribes one chunk, retrying what is worth retrying.
pub async fn transcribe(
    client: &reqwest::Client,
    request: &Request<'_>,
    chunk_path: &Path,
    cancel: &CancelSignal,
) -> AppResult<Transcribed> {
    // Read once and reuse across retries: re-reading 10 MB from disk on every
    // attempt is wasted IO, and the bytes cannot have changed.
    let bytes = tokio::fs::read(chunk_path)
        .await
        .map_err(|e| AppError::io(chunk_path, e))?;

    let mut attempt = 1;
    loop {
        if cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }

        let outcome = send_once(client, request, &bytes, cancel).await?;
        match outcome {
            Outcome::Done(transcribed) => return Ok(transcribed),
            Outcome::Retry { after, error } => {
                if attempt >= MAX_ATTEMPTS {
                    return Err(error);
                }
                // Cancel must be felt during the wait, not after it. A 90-second
                // backoff that ignores cancel is a cancel button that appears
                // not to work.
                cancel.guard(tokio::time::sleep(after)).await?;
                attempt += 1;
            }
        }
    }
}

enum Outcome {
    Done(Transcribed),
    /// Worth another attempt, carrying the error to raise if it was the last.
    Retry { after: Duration, error: AppError },
}

async fn send_once(
    client: &reqwest::Client,
    request: &Request<'_>,
    bytes: &[u8],
    cancel: &CancelSignal,
) -> AppResult<Outcome> {
    let url = if request.translate {
        TRANSLATIONS
    } else {
        TRANSCRIPTIONS
    };

    let file = reqwest::multipart::Part::bytes(bytes.to_vec())
        .file_name("chunk.flac")
        .mime_str("audio/flac")
        .map_err(AppError::network)?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", file)
        .text("model", request.model.id())
        // Always verbose_json: SRT and VTT are built from segment timestamps,
        // and TXT is those segments joined. The wire format is not a user
        // choice -- the user picks an output *file* format.
        .text("response_format", "verbose_json")
        // Segment granularity only. Word timestamps multiply the payload and
        // nothing in this app renders them.
        .text("timestamp_granularities[]", "segment")
        // Deterministic. A 0-1 float is exactly the sort of control this app
        // has removed everywhere else.
        .text("temperature", "0");

    // The translations endpoint only ever produces English, and sending a
    // `language` alongside it is rejected rather than ignored.
    if !request.translate {
        if let Some(language) = request.language {
            form = form.text("language", language.to_string());
        }
    }
    if let Some(prompt) = request.prompt.filter(|p| !p.trim().is_empty()) {
        form = form.text("prompt", truncate_chars(prompt, MAX_PROMPT_CHARS));
    }

    // Dropping the response future closes the connection, so this is all the
    // cancellation an in-flight upload needs -- no abort handle, no extra crate.
    let sent = cancel
        .guard(client.post(url).bearer_auth(request.key).multipart(form).send())
        .await?;

    let response = match sent {
        Ok(response) => response,
        Err(error) => {
            // A connection reset or a timeout is worth another go; nothing about
            // the request was wrong.
            return Ok(Outcome::Retry {
                after: backoff(1),
                error: AppError::network(error),
            });
        }
    };

    let status = response.status();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_retry_after);
    let remaining_audio = remaining_audio_secs(response.headers());

    let body = cancel
        .guard(response.bytes())
        .await?
        .map_err(AppError::network)?;

    if status.is_success() {
        let parsed: VerboseResponse = serde_json::from_slice(&body).map_err(|e| {
            AppError::api(
                SERVICE,
                status.as_u16(),
                format!("could not read the response: {e}"),
            )
        })?;
        return Ok(Outcome::Done(Transcribed {
            segments: into_segments(parsed),
            remaining_audio_secs: remaining_audio,
        }));
    }

    let message = message_from(&String::from_utf8_lossy(&body));

    if status.as_u16() == 429 {
        let wait = retry_after.unwrap_or_else(|| backoff(1));
        if wait <= MAX_INLINE_WAIT {
            return Ok(Outcome::Retry {
                after: wait,
                error: AppError::RateLimited {
                    scope: scope_for(retry_after),
                    retry_after_secs: retry_after.map(|d| d.as_secs()),
                },
            });
        }
        // Too long to sit through. Fail now with the reset time so the screen
        // can say when, and so the ledger can stop offering the model.
        return Err(AppError::RateLimited {
            scope: scope_for(retry_after),
            retry_after_secs: Some(wait.as_secs()),
        });
    }

    // Retry the server's problems, never our own. A 401 will be a 401 four
    // times over, and a 413 means the chunk plan is wrong -- retrying it just
    // uploads the same oversized body again.
    if status.is_server_error() || matches!(status.as_u16(), 408 | 409) {
        return Ok(Outcome::Retry {
            after: backoff(1),
            error: AppError::api(SERVICE, status.as_u16(), message),
        });
    }

    // A request we built wrong: too large, unsupported, malformed. Reported as
    // invalid input rather than as an API error, because that is what it is and
    // because the runner refunds the ledger for it -- no audio was processed.
    if matches!(status.as_u16(), 400 | 413 | 415 | 422) {
        return Err(AppError::invalid("request", message));
    }

    Err(AppError::api(SERVICE, status.as_u16(), message))
}

/// What Groq said is left of the audio-seconds budget, if it said anything.
///
/// Groq documents `x-ratelimit-*-{requests,tokens}` but nothing for audio, and
/// the audio headers it does send are undocumented and could change or stop.
/// So this matches by shape rather than by an exact name, and everything
/// downstream treats the answer as a hint that can only ever lower an estimate.
pub fn remaining_audio_secs(headers: &reqwest::header::HeaderMap) -> Option<u32> {
    headers.iter().find_map(|(name, value)| {
        let name = name.as_str();
        if !name.starts_with("x-ratelimit-remaining") || !name.contains("audio") {
            return None;
        }
        parse_leading_number(value.to_str().ok()?)
    })
}

/// Which budget ran out, inferred from how long we were asked to wait.
///
/// An hour bucket cannot ask for more than an hour; anything longer is the
/// daily one. A short wait is a burst rather than a budget, and saying "your
/// daily limit is gone" when it is not would send someone away for a day.
fn scope_for(retry_after: Option<Duration>) -> RateScope {
    match retry_after {
        Some(wait) if wait.as_secs() > 3_600 => RateScope::Day,
        Some(wait) if wait.as_secs() > MAX_INLINE_WAIT.as_secs() => RateScope::Hour,
        _ => RateScope::Request,
    }
}

fn into_segments(parsed: VerboseResponse) -> Vec<Segment> {
    if !parsed.segments.is_empty() {
        return parsed
            .segments
            .into_iter()
            .map(|raw| Segment {
                start: raw.start,
                end: raw.end,
                text: raw.text.trim().to_string(),
            })
            .filter(|segment| !segment.text.is_empty())
            .collect();
    }

    // Very short audio comes back with `text` and no segments at all. Dropping
    // it because the array was empty would turn a working ten-second clip into
    // an empty transcript.
    let text = parsed.text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    vec![Segment {
        start: 0.0,
        end: 0.0,
        text: text.to_string(),
    }]
}

/// Groq returns `{"error":{"message":"..."}}`. Falling back to the raw body
/// keeps a proxy's HTML error page diagnosable instead of reporting an empty
/// message.
fn message_from(body: &str) -> String {
    #[derive(Deserialize)]
    struct Envelope {
        error: Inner,
    }
    #[derive(Deserialize)]
    struct Inner {
        message: String,
    }

    serde_json::from_str::<Envelope>(body)
        .map(|envelope| envelope.error.message)
        .unwrap_or_else(|_| truncate_chars(body.trim(), 300))
}

/// `retry-after` is legally either a number of seconds or an HTTP date.
///
/// Anything unparseable is treated as *absent*, never as zero: a zero would
/// turn a rate limit into a hot loop hammering the endpoint that just asked us
/// to stop.
pub fn parse_retry_after(value: &str) -> Option<Duration> {
    let value = value.trim();
    if let Ok(secs) = value.parse::<f64>() {
        if secs.is_finite() && secs >= 0.0 {
            return Some(Duration::from_secs_f64(secs.min(86_400.0)));
        }
        return None;
    }
    // The HTTP-date form. Parsed to a delta rather than an instant, so a clock
    // that disagrees with the server's by a few seconds cannot produce a
    // negative wait.
    httpdate_secs_from_now(value).map(Duration::from_secs)
}

/// Minimal RFC 7231 IMF-fixdate reader: `Sun, 06 Nov 1994 08:49:37 GMT`.
///
/// Hand-rolled rather than adding `httpdate` for one header that Groq has only
/// ever been seen sending in the numeric form. Anything it cannot read is
/// `None`, which the caller already treats as "no advice".
fn httpdate_secs_from_now(value: &str) -> Option<u64> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let parts: Vec<&str> = value.split_whitespace().collect();
    if parts.len() != 6 || parts[5] != "GMT" {
        return None;
    }
    let day: i64 = parts[1].parse().ok()?;
    let month = MONTHS.iter().position(|m| *m == parts[2])? as i64 + 1;
    let year: i64 = parts[3].parse().ok()?;
    let time: Vec<&str> = parts[4].split(':').collect();
    if time.len() != 3 {
        return None;
    }
    let (hour, minute, second): (i64, i64, i64) = (
        time[0].parse().ok()?,
        time[1].parse().ok()?,
        time[2].parse().ok()?,
    );

    // Days from the civil epoch (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;

    let target = days * 86_400 + hour * 3_600 + minute * 60 + second;
    let now = super::ledger::now_unix() as i64;
    (target > now).then(|| (target - now).min(86_400) as u64)
}

/// Exponential, with a jittered quarter on top.
///
/// The jitter is what stops several chunks of one job -- or two jobs in the
/// network lane -- from walking back into the limit in lockstep. Derived from
/// the clock's nanoseconds rather than from `rand`: this is a spreading
/// function, not a random number, and it is not worth a dependency.
pub fn backoff(attempt: u32) -> Duration {
    let base = 2u64.saturating_pow(attempt.min(6));
    Duration::from_millis(base * 1_000 + jitter_millis(base * 250))
}

fn jitter_millis(span: u64) -> u64 {
    if span == 0 {
        return 0;
    }
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| u64::from(d.subsec_nanos()) % span)
        .unwrap_or(0)
}

fn parse_leading_number(value: &str) -> Option<u32> {
    // Groq writes these as "7200" but also as "1m30s" for reset headers; taking
    // the leading digits is right for the remaining-count form and yields
    // nothing surprising for the other.
    let digits: String = value.trim().chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// Truncation on a character boundary, never a byte one. Slicing Persian or
/// Arabic text by bytes panics -- `paths::sanitize_stem` carries the same note.
fn truncate_chars(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_large_v3_can_translate() {
        assert!(Model::LargeV3.can_translate());
        assert!(!Model::Turbo.can_translate());
        assert_eq!(Model::Turbo.id(), "whisper-large-v3-turbo");
        assert_eq!(Model::LargeV3.id(), "whisper-large-v3");
    }

    #[test]
    fn the_model_crosses_the_bridge_as_the_frontend_writes_it() {
        let raw = serde_json::to_string(&Model::WhisperLargeV3Turbo).unwrap();
        assert_eq!(raw, "\"whisperLargeV3Turbo\"");
        let back: Model = serde_json::from_str("\"whisperLargeV3\"").unwrap();
        assert_eq!(back, Model::LargeV3);
    }

    #[test]
    fn reads_the_numeric_retry_after() {
        assert_eq!(parse_retry_after("120"), Some(Duration::from_secs(120)));
        assert_eq!(parse_retry_after(" 7.5 "), Some(Duration::from_secs_f64(7.5)));
    }

    /// The hot-loop guard: an unreadable header must not read as "retry now".
    #[test]
    fn an_unparseable_retry_after_is_absent_rather_than_zero() {
        assert_eq!(parse_retry_after("soon"), None);
        assert_eq!(parse_retry_after(""), None);
        assert_eq!(parse_retry_after("-5"), None);
        assert_eq!(parse_retry_after("NaN"), None);
    }

    #[test]
    fn reads_an_http_date_retry_after_as_a_delta() {
        // A date in the past is not a negative wait; it is no advice at all.
        assert_eq!(parse_retry_after("Sun, 06 Nov 1994 08:49:37 GMT"), None);

        // Far future, clamped to a day so a bad clock cannot park a job forever.
        let far = parse_retry_after("Fri, 31 Dec 2100 23:59:59 GMT").unwrap();
        assert_eq!(far, Duration::from_secs(86_400));

        assert_eq!(parse_retry_after("not a date at all"), None);
    }

    /// A short wait is a burst; only a long one means a budget is gone. Telling
    /// someone their daily limit is spent when it is not sends them away for a
    /// day they did not need to lose.
    #[test]
    fn the_scope_follows_how_long_we_were_asked_to_wait() {
        assert_eq!(scope_for(Some(Duration::from_secs(30))), RateScope::Request);
        assert_eq!(scope_for(Some(Duration::from_secs(600))), RateScope::Hour);
        assert_eq!(scope_for(Some(Duration::from_secs(7_200))), RateScope::Day);
        assert_eq!(scope_for(None), RateScope::Request);
    }

    #[test]
    fn backoff_grows_and_stays_inside_its_jitter_band() {
        for attempt in 1..=4u32 {
            let base = 2u64.pow(attempt);
            let delay = backoff(attempt).as_millis() as u64;
            assert!(delay >= base * 1_000, "attempt {attempt}: {delay}");
            assert!(delay < base * 1_250, "attempt {attempt}: {delay}");
        }
        assert!(backoff(1) < backoff(3));
    }

    #[test]
    fn pulls_the_real_message_out_of_an_error_envelope() {
        let body = r#"{"error":{"message":"Invalid API Key","type":"invalid_request_error"}}"#;
        assert_eq!(message_from(body), "Invalid API Key");
    }

    /// A proxy or a gateway answers with HTML, and reporting an empty string
    /// would leave nothing to diagnose.
    #[test]
    fn falls_back_to_the_raw_body_when_it_is_not_an_envelope() {
        assert_eq!(message_from("<html>502 Bad Gateway</html>"), "<html>502 Bad Gateway</html>");
        assert!(message_from(&"x".repeat(1_000)).chars().count() <= 300);
    }

    #[test]
    fn finds_an_audio_seconds_header_whatever_it_is_called() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "x-ratelimit-remaining-audio-seconds",
            "6100".parse().unwrap(),
        );
        assert_eq!(remaining_audio_secs(&headers), Some(6_100));

        // The documented token/request headers must not be mistaken for it.
        let mut other = reqwest::header::HeaderMap::new();
        other.insert("x-ratelimit-remaining-tokens", "500".parse().unwrap());
        assert_eq!(remaining_audio_secs(&other), None);
    }

    /// Ten seconds of audio comes back as `text` with no `segments`. Reading
    /// only the array would report a working clip as having no speech.
    #[test]
    fn a_response_with_no_segments_still_yields_its_text() {
        let parsed: VerboseResponse =
            serde_json::from_str(r#"{"text":"  Hello there.  ","segments":[]}"#).unwrap();
        let segments = into_segments(parsed);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].text, "Hello there.");
    }

    #[test]
    fn segments_are_taken_verbatim_and_blank_ones_dropped() {
        let parsed: VerboseResponse = serde_json::from_str(
            r#"{"text":"x","segments":[
                {"start":0.0,"end":1.5,"text":" hi "},
                {"start":1.5,"end":2.0,"text":"   "}
            ]}"#,
        )
        .unwrap();
        let segments = into_segments(parsed);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].text, "hi");
        assert_eq!(segments[0].end, 1.5);
    }

    /// A field Groq adds later must not break parsing, and a field it omits
    /// must not either.
    #[test]
    fn tolerates_extra_and_missing_response_fields() {
        let parsed: VerboseResponse =
            serde_json::from_str(r#"{"task":"transcribe","language":"fa","duration":3.2}"#).unwrap();
        assert!(into_segments(parsed).is_empty());
    }

    #[test]
    fn the_prompt_is_truncated_on_a_character_boundary() {
        let persian = "سلام".repeat(500);
        let cut = truncate_chars(&persian, MAX_PROMPT_CHARS);
        assert_eq!(cut.chars().count(), MAX_PROMPT_CHARS);
    }
}
