//! Downloading a link that already points at the file.
//!
//! yt-dlp is an extractor. Given a *page* it works out where the media
//! actually lives, negotiates with the site, and stitches the streams back
//! together -- worth every one of the two seconds it spends unpacking itself
//! and booting CPython. Given a link that is already the file, none of that
//! applies: there is nothing to extract, and yt-dlp fetches it on a single
//! connection.
//!
//! This module is the other half. It takes the URL at its word, opens eight
//! connections to it, writes them into their own ranges of one file, and
//! remembers which ranges landed -- so an interrupted download resumes instead
//! of starting again. It also downloads *anything*, not just media: an
//! installer, a PDF, a zip, a font. The old app could only take what yt-dlp
//! recognised, which meant most links did nothing at all.
//!
//! Which of the two runs is decided in `download::choose_engine`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use reqwest::header::{
    HeaderMap, ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
    ETAG, LAST_MODIFIED, RANGE,
};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio::task::JoinSet;
use tokio::time::Instant;

use crate::error::{AppError, AppResult};
use crate::jobs::{CancelSignal, Emitters, JobKind, JobProgress, Stage};
use crate::paths;

/// One range request's worth of file.
///
/// 4 MiB is large enough that the per-request overhead disappears against the
/// transfer, and small enough that losing one to a cancelled job costs almost
/// nothing on the resume.
const CHUNK_SIZE: u64 = 4 * 1024 * 1024;

/// Connections opened against one file.
///
/// The same number yt-dlp is given for fragments, and for the same reason: this
/// is network-bound work, so the core count says nothing about the right
/// figure. Eight is where a single-stream server-side rate cap stops being the
/// limit and the line itself starts to be, without looking like an attack to
/// the host on the other end.
const CONNECTIONS: usize = 8;

/// Below this, one connection wins. Eight TLS handshakes to fetch six megabytes
/// costs more than it saves.
const SPLIT_THRESHOLD: u64 = 8 * 1024 * 1024;

/// How much a worker accumulates before reporting. Without it, eight workers
/// each posting every 16 KB read is a few thousand messages a second to feed a
/// progress bar that redraws ten times a second.
const REPORT_EVERY: u64 = 256 * 1024;

/// How often the record of finished chunks is written down. A crash loses at
/// most this much *bookkeeping* -- the affected chunks are simply fetched
/// again, so the cost of the interval is a second of bandwidth, not
/// correctness.
const STATE_INTERVAL: Duration = Duration::from_secs(1);

/// Attempts per chunk before the whole download gives up.
const CHUNK_ATTEMPTS: u32 = 3;

/// A partial file smaller than this is not worth keeping for a resume, and
/// leaving it behind is just litter in the user's folder.
const KEEP_PARTIAL_ABOVE: u64 = 64 * 1024;

const USER_AGENT: &str = concat!("MediaToolkit/", env!("CARGO_PKG_VERSION"));

/// Content types that are a *description* of a stream rather than the stream.
/// These are yt-dlp's job -- it fetches every segment and muxes them; fetching
/// the manifest itself would save a few kilobytes of text.
const MANIFEST_TYPES: &[&str] = &[
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl",
    "application/dash+xml",
];

/// Extensions that mean the same thing when the server declines to say.
const MANIFEST_EXTENSIONS: &[&str] = &["m3u8", "m3u", "mpd"];

/// The shared client.
///
/// One per process: connection pooling across the eight workers is most of why
/// this is fast, and a client built per download throws the pool away with it.
/// No overall timeout -- a download legitimately takes an hour -- but a short
/// connect timeout, so an unreachable host fails in seconds rather than
/// hanging on the network lane.
fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(20))
            // Applies to the wait for the *next* chunk of body, not to the
            // download as a whole: a stalled transfer is a failure, a long one
            // is not.
            .read_timeout(Duration::from_secs(60))
            .pool_max_idle_per_host(CONNECTIONS)
            .build()
            .expect("a client with no TLS backend configured cannot be built")
    })
}

/// A GET with this module's client, carrying whatever headers the caller was
/// given.
///
/// Headers exist for the muxed path: a media URL resolved out of a page is
/// signed for a particular client, and googlevideo answers a request that does
/// not carry the `User-Agent` yt-dlp negotiated with either a 403 or a
/// deliberately slow stream. A pasted link needs none of that and passes
/// `None`.
fn get(url: &str, headers: Option<&HeaderMap>) -> reqwest::RequestBuilder {
    let request = client().get(url);
    match headers {
        Some(headers) => request.headers(headers.clone()),
        None => request,
    }
}

/// What a probe learned about a link that turned out to be a file.
#[derive(Debug, Clone)]
pub struct FileInfo {
    /// Name including the extension, already sanitized.
    pub filename: String,
    pub size_bytes: Option<u64>,
    /// Whether the server will serve byte ranges, which is what makes both the
    /// eight connections and the resume possible.
    pub resumable: bool,
    pub content_type: Option<String>,
    /// ETag or Last-Modified. On a resume this is the only thing that can say
    /// the bytes already on disk still belong to the file being asked for --
    /// appending to a stale part file produces a corrupt one, silently.
    tag: Option<String>,
}

/// Asks a URL what it is, in one request and without reading a body.
///
/// `Ok(None)` means "this is a web page" -- hand it to yt-dlp. That is a
/// verdict, not a failure: it is the answer for every YouTube, Instagram or
/// Aparat link, which is the overwhelming majority of what gets pasted here.
///
/// A ranged GET rather than a HEAD. Plenty of CDNs answer HEAD with 405 or
/// with headers that differ from the real response, while `Range: bytes=0-0`
/// is served by anything that serves ranges at all -- and a 206 coming back is
/// itself the proof that ranges work, which no header can promise as reliably.
pub async fn probe(url: &str) -> AppResult<Option<FileInfo>> {
    let response = match client().get(url).header(RANGE, "bytes=0-0").send().await {
        Ok(response) => response,
        // Offline, DNS, TLS. Reported rather than swallowed: the caller's
        // fallback would be to spawn yt-dlp, which is about to fail the same
        // way after two seconds of unpacking itself.
        Err(error) if error.is_connect() || error.is_timeout() => {
            return Err(AppError::network(error))
        }
        Err(_) => return Ok(None),
    };

    let status = response.status();
    // A refusal says nothing about the file. Sites that want a session answer a
    // bare GET with 403 all the time, and yt-dlp knows how to get past that --
    // so this is "not a plain file", not an error.
    if !status.is_success() {
        return Ok(None);
    }

    let headers = response.headers().clone();
    let final_url = response.url().clone();
    // One byte was asked for and none of it is read: dropping the response here
    // closes the connection without pulling a body down.
    drop(response);

    let content_type = header_string(&headers, CONTENT_TYPE)
        .map(|value| value.split(';').next().unwrap_or("").trim().to_lowercase())
        .filter(|value| !value.is_empty());

    let filename = file_name_for(&headers, &final_url, content_type.as_deref());

    if is_web_page(content_type.as_deref(), &filename) {
        return Ok(None);
    }

    let (size_bytes, resumable) = if status == StatusCode::PARTIAL_CONTENT {
        (total_from_content_range(&headers), true)
    } else {
        // The server ignored the range, so Content-Length is the whole file and
        // the only claim about ranges is the header's.
        (
            header_string(&headers, CONTENT_LENGTH).and_then(|v| v.trim().parse().ok()),
            accepts_ranges(&headers),
        )
    };

    Ok(Some(FileInfo {
        filename,
        size_bytes,
        resumable,
        content_type,
        tag: header_string(&headers, ETAG)
            .or_else(|| header_string(&headers, LAST_MODIFIED)),
    }))
}

/// Runs the download and returns where the finished file landed.
///
/// `output_name` renames the file and keeps whatever extension the server said
/// it had; without one the server's name is used.
pub async fn run(
    id: &str,
    emitters: &mut Emitters,
    cancel: &CancelSignal,
    url: &str,
    dir: &Path,
    output_name: Option<&str>,
    info: &FileInfo,
) -> AppResult<PathBuf> {
    let (server_stem, ext) = split_name(&info.filename);
    let stem = output_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(paths::sanitize_stem)
        .unwrap_or(server_stem);

    // Deterministic, unlike the final path: a resume has to be able to find the
    // bytes a previous attempt left, and `unique_output` would hand out
    // "name (2).zip.part" the moment the first attempt's leftovers exist.
    let part = dir.join(match ext.as_deref() {
        Some(ext) => format!("{stem}.{ext}.part"),
        None => format!("{stem}.part"),
    });

    let transfer = {
        // Scoped, because the closure holds `emitters` for as long as it lives
        // and the completion event below needs it back.
        let mut report = |downloaded: u64, total: Option<u64>, speed: Option<f64>| {
            emit(emitters, id, downloaded, total, speed);
        };

        transfer(cancel, url, None, &part, info, &mut report).await
    };

    let downloaded = match transfer {
        Ok(downloaded) => downloaded,
        Err(error) => {
            // What did arrive stays exactly where a retry looks for it -- that
            // is the whole point of writing to a `.part`. Only a stub too small
            // to be worth continuing is swept up, because leaving one behind is
            // litter in the user's folder rather than progress.
            prune_if_tiny(&part).await;
            return Err(error);
        }
    };

    emitters.progress_now(JobProgress {
        percent: Some(100.0),
        bytes: Some(downloaded),
        total_bytes: info.size_bytes.or(Some(downloaded)),
        ..JobProgress::new(id, JobKind::Download, Stage::Finalizing)
    });

    let output = paths::unique_output(dir, &stem, ext.as_deref().unwrap_or("bin"));
    tokio::fs::rename(&part, &output)
        .await
        .map_err(|error| AppError::io(&part, error))?;
    let _ = tokio::fs::remove_file(state_path(&part)).await;

    Ok(output)
}

/// Fetches one already-resolved media URL to an exact path.
///
/// The entry point the muxed download path uses. It differs from `run` in the
/// three ways that path needs: the caller names the file (it is one of two
/// streams about to be merged, not the user's output), the URL carries the
/// headers it was signed for, and progress is reported through the caller's own
/// closure so two streams can add up to one bar.
///
/// The `.part` and its sidecar work exactly as they do for a pasted link, so a
/// cancelled or failed muxed download resumes from whatever it already fetched.
pub async fn fetch_to(
    cancel: &CancelSignal,
    url: &str,
    headers: &HeaderMap,
    part: &Path,
    size_bytes: u64,
    tag: Option<&str>,
    report: &mut (dyn FnMut(u64, Option<u64>, Option<f64>) + Send),
) -> AppResult<u64> {
    let info = FileInfo {
        filename: String::new(),
        size_bytes: Some(size_bytes),
        // Assumed, and verified by the first range request: googlevideo and
        // every other CDN yt-dlp resolves to serve ranges. A host that turns out
        // not to answers with something other than 206, `copy_range` reports it,
        // and the caller falls back to yt-dlp.
        resumable: true,
        content_type: None,
        tag: tag.map(str::to_string),
    };

    let outcome = transfer(cancel, url, Some(headers), part, &info, report).await;
    if outcome.is_err() {
        prune_if_tiny(part).await;
    }
    outcome
}

// ----------------------------------------------------------------- transfer

/// Splitting is worth it, or it is not. The one place that decides.
async fn transfer(
    cancel: &CancelSignal,
    url: &str,
    headers: Option<&HeaderMap>,
    part: &Path,
    info: &FileInfo,
    report: &mut (dyn FnMut(u64, Option<u64>, Option<f64>) + Send),
) -> AppResult<u64> {
    match (info.size_bytes, info.resumable) {
        // Both known and worth splitting: the fast path.
        (Some(total), true) if total >= SPLIT_THRESHOLD => {
            segmented(cancel, url, headers, part, total, info, report).await
        }
        _ => single(cancel, url, headers, part, info, report).await,
    }
}

/// What a worker reports back. Bytes for the bar, chunks for the resume.
enum Tick {
    Bytes(u64),
    Chunk(u32),
}

/// What is known to be on disk already, so a retry does not refetch it.
///
/// Stored beside the part file rather than inferred from its length, because
/// eight workers write to eight *different* offsets: the file is full-length
/// from the first byte written and its size says nothing about how much of it
/// is real.
#[derive(Debug, Default, Serialize, Deserialize)]
struct PartState {
    total: u64,
    chunk: u64,
    /// Indices written in full.
    done: Vec<u32>,
    /// The server's version marker at the time. A mismatch means the file
    /// changed under us and every byte on disk is suspect.
    tag: Option<String>,
}

fn state_path(part: &Path) -> PathBuf {
    let mut name = part.as_os_str().to_os_string();
    name.push(".state");
    PathBuf::from(name)
}

async fn load_state(part: &Path, total: u64, tag: Option<&str>) -> PartState {
    let fresh = PartState {
        total,
        chunk: CHUNK_SIZE,
        done: Vec::new(),
        tag: tag.map(str::to_string),
    };

    // No part file means nothing to resume, whatever the sidecar claims.
    if !part.is_file() {
        return fresh;
    }

    let Ok(raw) = tokio::fs::read(state_path(part)).await else {
        return fresh;
    };
    let Ok(state) = serde_json::from_slice::<PartState>(&raw) else {
        return fresh;
    };

    // Any of these means the leftovers describe a different file, or were
    // written by a build that chunked differently. Starting over is the only
    // safe answer: appending to the wrong bytes produces a file that is the
    // right size and does not open.
    if state.total != total || state.chunk != CHUNK_SIZE || state.tag.as_deref() != tag {
        return fresh;
    }
    state
}

async fn save_state(part: &Path, state: &PartState) {
    if let Ok(raw) = serde_json::to_vec(state) {
        let _ = tokio::fs::write(state_path(part), raw).await;
    }
}

/// Many connections, each fetching whole chunks into its own offsets.
///
/// `report` rather than the emitter itself: this is the part worth testing
/// end to end -- eight sockets writing into one file and a resume picking up
/// exactly the chunks that are missing -- and a Tauri `AppHandle` cannot be
/// built in a unit test. A closure costs nothing and makes the whole transfer
/// exercisable against a real socket.
async fn segmented(
    cancel: &CancelSignal,
    url: &str,
    headers: Option<&HeaderMap>,
    part: &Path,
    total: u64,
    info: &FileInfo,
    report: &mut (dyn FnMut(u64, Option<u64>, Option<f64>) + Send),
) -> AppResult<u64> {
    let mut state = load_state(part, total, info.tag.as_deref()).await;
    let chunks = total.div_ceil(CHUNK_SIZE) as u32;

    // Preallocated at full length so every worker can seek straight to its own
    // range. On every filesystem this app runs on that is a metadata update,
    // not a write of `total` zeroes.
    let file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(part)
        .await
        .map_err(|error| AppError::io(part, error))?;
    file.set_len(total)
        .await
        .map_err(|error| AppError::io(part, error))?;
    drop(file);

    state.done.retain(|index| *index < chunks);
    state.done.sort_unstable();
    state.done.dedup();

    let pending: Arc<Vec<u32>> = Arc::new(
        (0..chunks)
            .filter(|index| state.done.binary_search(index).is_err())
            .collect(),
    );

    let mut downloaded = bytes_of(&state.done, chunks, total);
    report(downloaded, Some(total), None);

    if pending.is_empty() {
        return Ok(total);
    }

    let (tx, mut rx) = mpsc::channel::<Tick>(256);
    let next = Arc::new(AtomicUsize::new(0));
    let mut workers = JoinSet::new();

    for _ in 0..CONNECTIONS.min(pending.len()) {
        let queue = Arc::clone(&pending);
        let cursor = Arc::clone(&next);
        let sender = tx.clone();
        let url = url.to_string();
        let headers = headers.cloned();
        let part = part.to_path_buf();

        workers.spawn(async move {
            loop {
                let slot = cursor.fetch_add(1, Ordering::Relaxed);
                let Some(&index) = queue.get(slot) else {
                    return Ok(());
                };
                let start = u64::from(index) * CHUNK_SIZE;
                let end = (start + CHUNK_SIZE).min(total) - 1;
                fetch_chunk(&url, headers.as_ref(), &part, start, end, &sender).await?;
                // A full chunk is on disk. Losing this message would only cost
                // a refetch after a crash, so the send is not worth failing on.
                let _ = sender.send(Tick::Chunk(index)).await;
            }
        });
    }
    // The loop below ends when every sender is gone, so this one must not be
    // held: with it alive, `recv` waits forever on a finished download.
    drop(tx);

    // Seeded with what the previous attempt already put on disk, so the first
    // sample measures this attempt rather than the resume.
    let mut meter = Meter::new(downloaded);
    let mut last_saved = Instant::now();

    loop {
        tokio::select! {
            biased;
            () = cancel.cancelled() => {
                workers.shutdown().await;
                save_state(part, &state).await;
                return Err(AppError::Cancelled);
            }
            tick = rx.recv() => match tick {
                None => break,
                Some(Tick::Bytes(count)) => {
                    downloaded += count;
                    report(downloaded, Some(total), meter.sample(downloaded));
                }
                Some(Tick::Chunk(index)) => {
                    state.done.push(index);
                    if last_saved.elapsed() >= STATE_INTERVAL {
                        save_state(part, &state).await;
                        last_saved = Instant::now();
                    }
                }
            },
        }
    }

    // Every worker has finished or failed. The first error is the one reported;
    // the rest are the same outage seen from seven other sockets.
    let mut failure = None;
    while let Some(joined) = workers.join_next().await {
        match joined {
            Ok(Ok(())) => {}
            Ok(Err(error)) => failure = failure.or(Some(error)),
            Err(error) => failure = failure.or(Some(AppError::spawn("download", error))),
        }
    }

    if let Some(error) = failure {
        // Written before returning, so what did arrive is not thrown away: the
        // retry picks up from here.
        save_state(part, &state).await;
        return Err(error);
    }

    Ok(total)
}

/// Fetches one range into its place in the file.
async fn fetch_chunk(
    url: &str,
    headers: Option<&HeaderMap>,
    part: &Path,
    start: u64,
    end: u64,
    sender: &mpsc::Sender<Tick>,
) -> AppResult<()> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        match copy_range(url, headers, part, start, end, sender).await {
            Ok(()) => return Ok(()),
            Err(error) if attempt < CHUNK_ATTEMPTS => {
                // A dropped connection mid-file is ordinary on a home line.
                // Backing off before retrying is the difference between riding
                // out a two-second outage and failing an hour-long download.
                tokio::time::sleep(Duration::from_millis(400 * u64::from(attempt))).await;
                let _ = error;
            }
            Err(error) => return Err(error),
        }
    }
}

async fn copy_range(
    url: &str,
    headers: Option<&HeaderMap>,
    part: &Path,
    start: u64,
    end: u64,
    sender: &mpsc::Sender<Tick>,
) -> AppResult<()> {
    let mut response = get(url, headers)
        .header(RANGE, format!("bytes={start}-{end}"))
        .send()
        .await
        .map_err(AppError::network)?;

    // Anything but 206 means the server is no longer serving ranges -- it would
    // be sending the whole file into a 4 MiB hole in the middle of ours.
    if response.status() != StatusCode::PARTIAL_CONTENT {
        return Err(AppError::network(format!(
            "server stopped serving ranges (HTTP {})",
            response.status().as_u16()
        )));
    }

    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(part)
        .await
        .map_err(|error| AppError::io(part, error))?;
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|error| AppError::io(part, error))?;

    let mut written = 0u64;
    let mut unreported = 0u64;
    let limit = end - start + 1;

    while let Some(bytes) = response.chunk().await.map_err(AppError::network)? {
        // A server that ignores the end of the range would otherwise overwrite
        // the chunk after this one.
        let take = bytes.len().min((limit - written) as usize);
        if take == 0 {
            break;
        }
        file.write_all(&bytes[..take])
            .await
            .map_err(|error| AppError::io(part, error))?;

        written += take as u64;
        unreported += take as u64;
        if unreported >= REPORT_EVERY {
            let _ = sender.send(Tick::Bytes(unreported)).await;
            unreported = 0;
        }
        if written == limit {
            break;
        }
    }

    file.flush()
        .await
        .map_err(|error| AppError::io(part, error))?;

    if written < limit {
        // Short read. Reported so the attempt is retried rather than the chunk
        // being marked done with a hole in it.
        if unreported > 0 {
            let _ = sender.send(Tick::Bytes(unreported)).await;
        }
        return Err(AppError::network("connection closed before the range ended"));
    }

    if unreported > 0 {
        let _ = sender.send(Tick::Bytes(unreported)).await;
    }
    Ok(())
}

/// One connection, appending. For servers that will not serve ranges, and for
/// files small enough that splitting them costs more than it saves.
async fn single(
    cancel: &CancelSignal,
    url: &str,
    headers: Option<&HeaderMap>,
    part: &Path,
    info: &FileInfo,
    report: &mut (dyn FnMut(u64, Option<u64>, Option<f64>) + Send),
) -> AppResult<u64> {
    // Only when the server will serve a range *and* still reports the same
    // file. Resuming against a server that ignores Range appends the whole file
    // to what is already there.
    let existing = match tokio::fs::metadata(part).await {
        Ok(meta) if info.resumable => meta.len(),
        _ => 0,
    };
    let resume_from = match info.size_bytes {
        // A part file at or past the full length is finished or wrong; either
        // way there is nothing useful to continue from.
        Some(total) if existing >= total => 0,
        _ => existing,
    };

    let mut request = get(url, headers);
    if resume_from > 0 {
        request = request.header(RANGE, format!("bytes={resume_from}-"));
    }
    let mut response = request.send().await.map_err(AppError::network)?;

    if !response.status().is_success() {
        return Err(AppError::network(format!(
            "server answered HTTP {}",
            response.status().as_u16()
        )));
    }

    // The server may have declined the range and started from zero, in which
    // case so must we -- otherwise the first byte of the file lands halfway in.
    let appending = resume_from > 0 && response.status() == StatusCode::PARTIAL_CONTENT;
    let mut downloaded = if appending { resume_from } else { 0 };
    let total = info.size_bytes;

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!appending)
        .open(part)
        .await
        .map_err(|error| AppError::io(part, error))?;
    if appending {
        file.seek(std::io::SeekFrom::Start(resume_from))
            .await
            .map_err(|error| AppError::io(part, error))?;
    }

    let mut meter = Meter::new(downloaded);
    report(downloaded, total, None);

    loop {
        let next = tokio::select! {
            biased;
            () = cancel.cancelled() => {
                let _ = file.flush().await;
                return Err(AppError::Cancelled);
            }
            chunk = response.chunk() => chunk.map_err(AppError::network)?,
        };

        let Some(bytes) = next else { break };
        file.write_all(&bytes)
            .await
            .map_err(|error| AppError::io(part, error))?;
        downloaded += bytes.len() as u64;
        report(downloaded, total, meter.sample(downloaded));
    }

    file.flush()
        .await
        .map_err(|error| AppError::io(part, error))?;

    if let Some(total) = total {
        if downloaded < total {
            return Err(AppError::network("connection closed before the file ended"));
        }
    }
    Ok(downloaded)
}

// -------------------------------------------------------------- progress

fn emit(
    emitters: &mut Emitters,
    id: &str,
    downloaded: u64,
    total: Option<u64>,
    speed: Option<f64>,
) {
    let percent = total
        .filter(|total| *total > 0)
        .map(|total| (downloaded as f64 / total as f64 * 100.0).clamp(0.0, 100.0));

    emitters.progress(JobProgress {
        percent,
        // Bytes per second, unformatted: `formatSpeed` in lib/format.ts writes
        // it, so this engine and yt-dlp cannot disagree about units on two rows
        // of the same list.
        speed,
        eta_secs: match (total, speed) {
            (Some(total), Some(rate)) if rate > 1.0 && total > downloaded => {
                Some(((total - downloaded) as f64 / rate) as u64)
            }
            _ => None,
        },
        bytes: Some(downloaded),
        total_bytes: total,
        ..JobProgress::new(id, JobKind::Download, Stage::Downloading)
    });
}

/// Turns a stream of arrival times into a rate worth showing.
///
/// Smoothed, because the raw figure between two 250 ms samples swings by a
/// factor of three on a healthy connection and a number that jumps like that
/// reads as broken. The ETA is computed from this, so the smoothing is what
/// stops "4 minutes left" from becoming "40 seconds left" and back twice a
/// second.
struct Meter {
    last: Instant,
    last_bytes: u64,
    rate: Option<f64>,
}

impl Meter {
    const INTERVAL: Duration = Duration::from_millis(400);

    /// `start` is what the transfer has *already* got -- the resume offset, or
    /// zero for a fresh download.
    ///
    /// It used to be hard-coded to zero, which was right exactly once. A resumed
    /// download begins with `downloaded` already at, say, 50 MiB, so the first
    /// sample divided all 50 MiB by the 400 ms window and reported 125 MB/s --
    /// with an ETA to match -- and then took several seconds of the EMA below to
    /// decay back to the truth. The number the user watches was wrong for the
    /// first few seconds of every retry, which is precisely when they are
    /// looking at it.
    fn new(start: u64) -> Self {
        Self {
            last: Instant::now(),
            last_bytes: start,
            rate: None,
        }
    }

    /// Bytes per second, or `None` until there is enough of a window to divide
    /// by. Returns the last figure between samples so the number on screen does
    /// not blink out.
    fn sample(&mut self, downloaded: u64) -> Option<f64> {
        let elapsed = self.last.elapsed();
        if elapsed < Self::INTERVAL {
            return self.rate;
        }
        let gained = downloaded.saturating_sub(self.last_bytes) as f64;
        let sample = gained / elapsed.as_secs_f64();

        self.rate = Some(match self.rate {
            Some(current) => current * 0.7 + sample * 0.3,
            None => sample,
        });
        self.last = Instant::now();
        self.last_bytes = downloaded;
        self.rate
    }
}

/// How much of the file the finished chunks account for. The last chunk is
/// short whenever the total is not a multiple of the chunk size, and counting
/// it as full made a resumed download report more bytes than the file has.
fn bytes_of(done: &[u32], chunks: u32, total: u64) -> u64 {
    done.iter()
        .map(|index| {
            if *index + 1 == chunks {
                total - u64::from(*index) * CHUNK_SIZE
            } else {
                CHUNK_SIZE
            }
        })
        .sum()
}

// --------------------------------------------------------------- headers

fn header_string(headers: &HeaderMap, name: reqwest::header::HeaderName) -> Option<String> {
    headers
        .get(name)?
        .to_str()
        .ok()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn accepts_ranges(headers: &HeaderMap) -> bool {
    header_string(headers, ACCEPT_RANGES)
        .map(|value| !value.eq_ignore_ascii_case("none"))
        .unwrap_or(false)
}

/// The total from `Content-Range: bytes 0-0/12345`. `*` in place of the length
/// is legal and means the server does not know, which is not a parse failure.
fn total_from_content_range(headers: &HeaderMap) -> Option<u64> {
    header_string(headers, CONTENT_RANGE)?
        .rsplit('/')
        .next()?
        .trim()
        .parse()
        .ok()
}

/// Whether this is a page to be extracted rather than a file to be fetched.
fn is_web_page(content_type: Option<&str>, filename: &str) -> bool {
    let extension = filename
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase());
    if extension
        .as_deref()
        .is_some_and(|ext| MANIFEST_EXTENSIONS.contains(&ext))
    {
        return true;
    }

    match content_type {
        Some(value) => {
            value.starts_with("text/html")
                || value.starts_with("application/xhtml")
                || MANIFEST_TYPES.contains(&value)
        }
        // No type at all. Only treat it as a file when the link itself carries
        // an extension -- otherwise `https://site.com/watch/abc` would be
        // "downloaded" as a few kilobytes of HTML named after its last path
        // segment, instead of being handed to the extractor.
        None => extension.is_none(),
    }
}

/// The name to save under: what the server says, then what the URL says, then
/// a fallback -- and an extension inferred from the content type when the name
/// has none.
fn file_name_for(headers: &HeaderMap, url: &Url, content_type: Option<&str>) -> String {
    let raw = disposition_name(headers)
        .or_else(|| {
            // The last segment that is not empty: a trailing slash would
            // otherwise name the file "".
            url.path_segments()?
                .rfind(|segment| !segment.is_empty())
                .map(percent_decode)
        })
        .unwrap_or_default();

    let (stem, ext) = split_name(&raw);
    let ext = ext.or_else(|| content_type.and_then(extension_for_type).map(str::to_string));

    match ext {
        Some(ext) => format!("{stem}.{ext}"),
        None => stem,
    }
}

/// `filename*=UTF-8''name.zip` first, then `filename="name.zip"`. The starred
/// form is the one that can carry a non-ASCII name, so it wins when both are
/// present -- which is exactly when the plain one is a mangled transliteration.
fn disposition_name(headers: &HeaderMap) -> Option<String> {
    let value = header_string(headers, CONTENT_DISPOSITION)?;

    if let Some(at) = value.to_ascii_lowercase().find("filename*=") {
        let raw = value[at + "filename*=".len()..]
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('"');
        // charset'language'value -- only the value is wanted, and it is
        // percent-encoded.
        let encoded = raw.rsplit('\'').next().unwrap_or(raw);
        let decoded = percent_decode(encoded);
        if !decoded.trim().is_empty() {
            return Some(decoded);
        }
    }

    let at = value.to_ascii_lowercase().find("filename=")?;
    let raw = value[at + "filename=".len()..]
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches('"')
        .to_string();
    (!raw.trim().is_empty()).then_some(raw)
}

/// Splits a file name into a sanitized stem and a lowercase extension.
///
/// An "extension" here has to look like one: up to eight characters, letters
/// and digits only. Without that, `archive.2024.backup` is saved with an
/// extension of "backup" -- harmless -- but `report.v1 final` gets one of
/// "v1 final", and a version number in a video title turns into a file the OS
/// will not open.
fn split_name(raw: &str) -> (String, Option<String>) {
    let trimmed = raw.trim().trim_end_matches('/');
    match trimmed.rsplit_once('.') {
        Some((stem, ext))
            if !stem.is_empty()
                && (1..=8).contains(&ext.len())
                && ext.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            (paths::sanitize_stem(stem), Some(ext.to_ascii_lowercase()))
        }
        _ => (paths::sanitize_stem(trimmed), None),
    }
}

/// Only the types worth naming. Everything else keeps whatever the URL had, or
/// ends up as `.bin` -- which is honest about not knowing.
///
/// The list grew past media once the app started accepting any link: the
/// extension this returns is what the UI reads the file's kind back out of, so
/// a package or a document arriving without one in its URL used to be filed and
/// drawn as an anonymous blob.
fn extension_for_type(content_type: &str) -> Option<&'static str> {
    Some(match content_type {
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/x-matroska" => "mkv",
        "video/quicktime" => "mov",
        "video/x-msvideo" => "avi",
        "audio/mpeg" => "mp3",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/flac" | "audio/x-flac" => "flac",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "application/pdf" => "pdf",
        "application/zip" => "zip",
        "application/x-7z-compressed" => "7z",
        "application/x-rar-compressed" | "application/vnd.rar" => "rar",
        "application/gzip" | "application/x-gzip" => "gz",
        "application/x-tar" => "tar",
        "application/x-bzip2" => "bz2",
        "application/x-xz" => "xz",
        "application/zstd" => "zst",
        "application/x-iso9660-image" => "iso",
        "application/x-msdownload" | "application/vnd.microsoft.portable-executable" => "exe",
        "application/x-msi" | "application/x-ms-installer" => "msi",
        "application/x-apple-diskimage" => "dmg",
        "application/vnd.debian.binary-package" => "deb",
        "application/x-rpm" | "application/x-redhat-package-manager" => "rpm",
        "application/vnd.android.package-archive" => "apk",
        "application/json" => "json",
        "application/xml" => "xml",
        "application/epub+zip" => "epub",
        "application/msword" => "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "application/vnd.ms-excel" => "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        "application/vnd.ms-powerpoint" => "ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
        "text/csv" => "csv",
        "text/plain" => "txt",
        _ => return None,
    })
}

/// `%D8%A2` back to the bytes it stands for.
///
/// Hand-rolled rather than a dependency: this is the only place the app needs
/// it, and a malformed sequence has to be passed through rather than rejected,
/// which is not what a strict decoder does.
fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex(bytes[index + 1]), hex(bytes[index + 2])) {
                out.push(high << 4 | low);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Drops a part file that is too small to be worth resuming from.
///
/// A few kilobytes is not progress, and a folder of stubs from links that
/// turned out to be dead is worse than no trace at all. Anything larger is
/// left exactly where a retry goes looking for it.
async fn prune_if_tiny(part: &Path) {
    let tiny = tokio::fs::metadata(part)
        .await
        .map(|meta| meta.len() < KEEP_PARTIAL_ABOVE)
        .unwrap_or(false);
    if tiny {
        let _ = tokio::fs::remove_file(part).await;
        let _ = tokio::fs::remove_file(state_path(part)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------ a real server
    //
    // Sixty lines of TCP rather than a mock, because what is worth proving
    // here cannot be proved against a fake: that eight sockets writing into
    // eight offsets of one file produce the bytes the server has, and that a
    // resume asks for exactly the chunks that are missing. Both of those are
    // about real range requests arriving in an unpredictable order.

    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicU32;

    /// Deterministic bytes, so a mismatch says *where* the file went wrong.
    fn body(len: usize) -> Vec<u8> {
        (0..len).map(|index| (index % 251) as u8).collect()
    }

    struct Server {
        url: String,
        /// Range requests served, for asserting that a resume refetches only
        /// what it has to.
        ranges: Arc<AtomicU32>,
    }

    /// Serves `body` at `/file.bin`, with or without range support.
    fn serve(body: Vec<u8>, ranges_supported: bool) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let addr = listener.local_addr().expect("a bound address");
        let ranges = Arc::new(AtomicU32::new(0));
        let counter = Arc::clone(&ranges);
        let body = Arc::new(body);

        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let Ok(peer) = stream.try_clone() else { continue };
                let mut reader = BufReader::new(peer);

                let mut requested: Option<(u64, u64)> = None;
                loop {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => break,
                        Ok(_) => {}
                        Err(_) => break,
                    }
                    if line == "\r\n" || line == "\n" {
                        break;
                    }
                    let lower = line.to_ascii_lowercase();
                    if let Some(spec) = lower.strip_prefix("range: bytes=") {
                        let spec = spec.trim();
                        let (start, end) = spec.split_once('-').unwrap_or((spec, ""));
                        let start: u64 = start.trim().parse().unwrap_or(0);
                        let end: u64 = end
                            .trim()
                            .parse()
                            .unwrap_or(body.len() as u64 - 1)
                            .min(body.len() as u64 - 1);
                        requested = Some((start, end));
                    }
                }

                let total = body.len() as u64;
                let response = match requested {
                    Some((start, end)) if ranges_supported && start < total => {
                        counter.fetch_add(1, Ordering::Relaxed);
                        let slice = &body[start as usize..=end as usize];
                        let mut head = format!(
                            "HTTP/1.1 206 Partial Content\r\n\
                             Content-Type: application/octet-stream\r\n\
                             Accept-Ranges: bytes\r\n\
                             ETag: \"v1\"\r\n\
                             Content-Range: bytes {start}-{end}/{total}\r\n\
                             Content-Length: {}\r\n\
                             Connection: close\r\n\r\n",
                            slice.len()
                        )
                        .into_bytes();
                        head.extend_from_slice(slice);
                        head
                    }
                    _ => {
                        let mut head = format!(
                            "HTTP/1.1 200 OK\r\n\
                             Content-Type: application/octet-stream\r\n\
                             {}\
                             ETag: \"v1\"\r\n\
                             Content-Length: {total}\r\n\
                             Connection: close\r\n\r\n",
                            if ranges_supported {
                                "Accept-Ranges: bytes\r\n"
                            } else {
                                "Accept-Ranges: none\r\n"
                            }
                        )
                        .into_bytes();
                        head.extend_from_slice(&body);
                        head
                    }
                };

                let _ = stream.write_all(&response);
                let _ = stream.flush();
            }
        });

        Server {
            url: format!("http://{addr}/file.bin"),
            ranges,
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "mt-direct-{}-{name}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).expect("a scratch directory");
        dir
    }

    fn info(total: u64, resumable: bool) -> FileInfo {
        FileInfo {
            filename: "file.bin".into(),
            size_bytes: Some(total),
            resumable,
            content_type: Some("application/octet-stream".into()),
            tag: Some("\"v1\"".into()),
        }
    }

    /// Eight connections, one file, and every byte where it belongs.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn segments_reassemble_into_the_original_file() {
        // Over the split threshold and not a multiple of the chunk size, so
        // the short last chunk is exercised too.
        let total = (CHUNK_SIZE * 3 + 1_234_567) as usize;
        let expected = body(total);
        let server = serve(expected.clone(), true);

        let dir = scratch("whole");
        let part = dir.join("file.bin.part");
        let mut seen = 0u64;

        let downloaded = segmented(
            &CancelSignal::default(),
            &server.url,
            None,
            &part,
            total as u64,
            &info(total as u64, true),
            &mut |done, _, _| seen = seen.max(done),
        )
        .await
        .expect("the transfer should finish");

        assert_eq!(downloaded, total as u64);
        assert_eq!(std::fs::read(&part).unwrap(), expected, "bytes differ");
        // Progress arrived, and never claimed more than the file holds.
        assert!(seen > 0 && seen <= total as u64, "reported {seen}");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The point of the whole `.part` + sidecar arrangement: a second attempt
    /// fetches the missing chunks and no others.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_resume_refetches_only_what_is_missing() {
        let total = CHUNK_SIZE * 4;
        let expected = body(total as usize);
        let server = serve(expected.clone(), true);

        let dir = scratch("resume");
        let part = dir.join("file.bin.part");

        // Stand in for an attempt that got three of the four chunks down
        // before the connection died.
        std::fs::write(&part, vec![0u8; total as usize]).unwrap();
        let mut file = std::fs::OpenOptions::new().write(true).open(&part).unwrap();
        use std::io::{Seek, SeekFrom};
        for index in 0..3u64 {
            file.seek(SeekFrom::Start(index * CHUNK_SIZE)).unwrap();
            let start = (index * CHUNK_SIZE) as usize;
            file.write_all(&expected[start..start + CHUNK_SIZE as usize])
                .unwrap();
        }
        drop(file);
        save_state(
            &part,
            &PartState {
                total,
                chunk: CHUNK_SIZE,
                done: vec![0, 1, 2],
                tag: Some("\"v1\"".into()),
            },
        )
        .await;

        let mut first_report = None;
        segmented(
            &CancelSignal::default(),
            &server.url,
            None,
            &part,
            total,
            &info(total, true),
            &mut |done, _, _| {
                first_report.get_or_insert(done);
            },
        )
        .await
        .expect("the resume should finish");

        assert_eq!(std::fs::read(&part).unwrap(), expected, "bytes differ");
        assert_eq!(
            server.ranges.load(Ordering::Relaxed),
            1,
            "only the missing chunk should have been requested"
        );
        // The bar starts where the previous attempt stopped rather than at zero.
        assert_eq!(first_report, Some(CHUNK_SIZE * 3));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A server that will not serve ranges still has to work, on one
    /// connection, from the beginning.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_server_without_ranges_downloads_whole() {
        let expected = body(300_000);
        let server = serve(expected.clone(), false);

        let dir = scratch("single");
        let part = dir.join("file.bin.part");

        let downloaded = single(
            &CancelSignal::default(),
            &server.url,
            None,
            &part,
            &info(expected.len() as u64, false),
            &mut |_, _, _| {},
        )
        .await
        .expect("the transfer should finish");

        assert_eq!(downloaded, expected.len() as u64);
        assert_eq!(std::fs::read(&part).unwrap(), expected);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Leftovers from an attempt against a server that has since stopped
    /// serving ranges must be thrown away, not appended to.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_non_resumable_retry_starts_over_rather_than_appending() {
        let expected = body(120_000);
        let server = serve(expected.clone(), false);

        let dir = scratch("noappend");
        let part = dir.join("file.bin.part");
        std::fs::write(&part, b"leftovers from a previous attempt").unwrap();

        single(
            &CancelSignal::default(),
            &server.url,
            None,
            &part,
            &info(expected.len() as u64, false),
            &mut |_, _, _| {},
        )
        .await
        .expect("the transfer should finish");

        // Appending would have produced a file 33 bytes too long that opens as
        // garbage -- the exact failure the `resumable` flag exists to prevent.
        assert_eq!(std::fs::read(&part).unwrap(), expected);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A probe against something that is unmistakably a file.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn probing_a_file_reports_its_size_and_that_it_can_resume() {
        let server = serve(body(4096), true);
        let found = probe(&server.url)
            .await
            .expect("the probe should reach the server")
            .expect("a file, not a page");

        assert_eq!(found.filename, "file.bin");
        assert_eq!(found.size_bytes, Some(4096));
        assert!(found.resumable);
        assert_eq!(found.tag.as_deref(), Some("\"v1\""));
    }

    /// Cancel has to be felt while bytes are moving, not at the end of the
    /// transfer -- and whatever arrived stays on disk for the retry.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn cancelling_stops_the_transfer_and_keeps_what_arrived() {
        let total = CHUNK_SIZE * 4;
        let server = serve(body(total as usize), true);

        let dir = scratch("cancel");
        let part = dir.join("file.bin.part");
        let cancel = CancelSignal::default();

        // Fired as soon as the first bytes land, so the transfer is genuinely
        // in flight rather than cancelled before it starts.
        let trigger = cancel.clone();
        let outcome = segmented(
            &cancel,
            &server.url,
            None,
            &part,
            total,
            &info(total, true),
            &mut move |_, _, _| trigger.cancel(),
        )
        .await;

        assert!(matches!(outcome, Err(AppError::Cancelled)), "{outcome:?}");
        assert!(part.is_file(), "the partial file must survive for the retry");

        std::fs::remove_dir_all(&dir).unwrap();
    }


    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                reqwest::header::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                value.parse().unwrap(),
            );
        }
        map
    }

    #[test]
    fn a_page_is_left_to_ytdlp() {
        assert!(is_web_page(Some("text/html"), "watch"));
        assert!(is_web_page(Some("application/xhtml+xml"), "watch"));
        // No content type and no extension: a route, not a file.
        assert!(is_web_page(None, "abc123"));
    }

    #[test]
    fn a_stream_manifest_is_left_to_ytdlp() {
        // Fetching this would save the playlist, not the video.
        assert!(is_web_page(Some("application/x-mpegurl"), "master.m3u8"));
        assert!(is_web_page(Some("application/dash+xml"), "manifest.mpd"));
        // Even when the server sends the wrong type for it.
        assert!(is_web_page(Some("application/octet-stream"), "master.m3u8"));
    }

    #[test]
    fn a_file_is_ours() {
        assert!(!is_web_page(Some("video/mp4"), "clip.mp4"));
        assert!(!is_web_page(Some("application/zip"), "pack.zip"));
        assert!(!is_web_page(Some("application/octet-stream"), "setup.exe"));
        // Server said nothing, but the link names a file.
        assert!(!is_web_page(None, "notes.pdf"));
    }

    #[test]
    fn reads_the_total_out_of_a_range_response() {
        let map = headers(&[("content-range", "bytes 0-0/1048576")]);
        assert_eq!(total_from_content_range(&map), Some(1_048_576));

        // A server that will not commit to a length.
        let map = headers(&[("content-range", "bytes 0-0/*")]);
        assert_eq!(total_from_content_range(&map), None);
    }

    #[test]
    fn accept_ranges_none_means_no() {
        assert!(accepts_ranges(&headers(&[("accept-ranges", "bytes")])));
        assert!(!accepts_ranges(&headers(&[("accept-ranges", "none")])));
        assert!(!accepts_ranges(&headers(&[])));
    }

    #[test]
    fn prefers_the_encoded_disposition_name() {
        // Both forms present, which is the normal way to serve a non-ASCII
        // name: the plain one is a lossy transliteration for old clients.
        let map = headers(&[(
            "content-disposition",
            "attachment; filename=\"video.mp4\"; filename*=UTF-8''%D9%88%DB%8C%D8%AF%DB%8C%D9%88.mp4",
        )]);
        assert_eq!(disposition_name(&map).as_deref(), Some("ویدیو.mp4"));
    }

    #[test]
    fn falls_back_to_the_plain_disposition_name() {
        let map = headers(&[("content-disposition", "attachment; filename=\"report.pdf\"")]);
        assert_eq!(disposition_name(&map).as_deref(), Some("report.pdf"));
    }

    #[test]
    fn names_a_file_after_the_url_when_the_server_does_not() {
        let url = Url::parse("https://example.com/files/my%20setup.exe?token=1").unwrap();
        assert_eq!(file_name_for(&headers(&[]), &url, None), "my setup.exe");
    }

    #[test]
    fn infers_a_missing_extension_from_the_content_type() {
        let url = Url::parse("https://cdn.example.com/asset/9f8a7b").unwrap();
        assert_eq!(
            file_name_for(&headers(&[]), &url, Some("video/mp4")),
            "9f8a7b.mp4"
        );
    }

    #[test]
    fn names_the_types_a_download_is_now_allowed_to_be() {
        // The extension is not just what the file is saved as any more -- it is
        // what the download card reads the kind back out of, so a package that
        // arrives without one in its URL must still be recognisable.
        for (content_type, want) in [
            ("application/vnd.android.package-archive", "apk"),
            ("application/x-msi", "msi"),
            ("application/x-iso9660-image", "iso"),
            ("application/x-tar", "tar"),
            ("application/x-rpm", "rpm"),
            ("text/csv", "csv"),
            (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "xlsx",
            ),
        ] {
            assert_eq!(extension_for_type(content_type), Some(want), "{content_type}");
        }

        // Still declines to guess, so these keep falling through to `.bin`.
        assert_eq!(extension_for_type("application/octet-stream"), None);
    }

    #[test]
    fn a_version_number_is_not_an_extension() {
        // "report.v1 final" would otherwise be saved with an extension of
        // "v1 final", which nothing will open.
        let (stem, ext) = split_name("report.v1 final");
        assert_eq!(stem, "report.v1 final");
        assert_eq!(ext, None);

        let (stem, ext) = split_name("archive.TAR");
        assert_eq!(stem, "archive");
        assert_eq!(ext.as_deref(), Some("tar"));
    }

    #[test]
    fn counts_a_short_last_chunk_as_short() {
        // Two full chunks and a 1 MiB tail. Counting the tail as full reported
        // more bytes than the file has, and a resumed download that started at
        // 103% of itself.
        let total = CHUNK_SIZE * 2 + 1024 * 1024;
        assert_eq!(bytes_of(&[0, 1, 2], 3, total), total);
        assert_eq!(bytes_of(&[2], 3, total), 1024 * 1024);
        assert_eq!(bytes_of(&[0], 3, total), CHUNK_SIZE);
    }

    /// The bug: `Meter` counted from zero while a resumed transfer starts at
    /// its resume offset, so the first reading was the whole resume divided by
    /// one 400 ms window -- hundreds of megabytes a second, and an ETA to match.
    #[test]
    fn a_resumed_transfer_does_not_report_the_resume_as_speed() {
        const RESUMED_AT: u64 = 50 * 1024 * 1024;

        let mut meter = Meter::new(RESUMED_AT);
        std::thread::sleep(Duration::from_millis(450));
        // A megabyte has genuinely arrived since the resume.
        let rate = meter
            .sample(RESUMED_AT + 1024 * 1024)
            .expect("a full window has passed");

        // Seeded from zero this reported ~120 MB/s. The real figure is around
        // 2 MB/s; the bound is loose because the sleep is only approximate.
        assert!(rate < 10.0 * 1024.0 * 1024.0, "reported {rate} B/s");
        assert!(rate > 0.0, "reported {rate} B/s");
    }

    #[test]
    fn decodes_percent_escapes_and_leaves_broken_ones_alone() {
        assert_eq!(percent_decode("my%20file.zip"), "my file.zip");
        assert_eq!(percent_decode("%D8%B3%D9%84%D8%A7%D9%85"), "سلام");
        // Not a valid escape: passed through rather than dropped.
        assert_eq!(percent_decode("100%off.txt"), "100%off.txt");
        assert_eq!(percent_decode("trailing%"), "trailing%");
    }

    #[tokio::test]
    async fn a_state_file_for_a_different_version_is_ignored() {
        let dir = std::env::temp_dir().join(format!("mt-direct-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let part = dir.join("thing.zip.part");
        tokio::fs::write(&part, b"partial").await.unwrap();

        save_state(
            &part,
            &PartState {
                total: 1000,
                chunk: CHUNK_SIZE,
                done: vec![0, 1],
                tag: Some("\"v1\"".into()),
            },
        )
        .await;

        // Same file, same size: the record stands.
        let kept = load_state(&part, 1000, Some("\"v1\"")).await;
        assert_eq!(kept.done, vec![0, 1]);

        // The file changed on the server. Every byte on disk is now suspect.
        let dropped = load_state(&part, 1000, Some("\"v2\"")).await;
        assert!(dropped.done.is_empty());

        // So is a different length under the same tag.
        let dropped = load_state(&part, 2000, Some("\"v1\"")).await;
        assert!(dropped.done.is_empty());

        tokio::fs::remove_dir_all(&dir).await.unwrap();
    }

    #[tokio::test]
    async fn nothing_to_resume_without_a_part_file() {
        let dir = std::env::temp_dir().join(format!("mt-direct-none-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let part = dir.join("gone.zip.part");

        save_state(
            &part,
            &PartState {
                total: 1000,
                chunk: CHUNK_SIZE,
                done: vec![0],
                tag: None,
            },
        )
        .await;

        // The record survived the data. Trusting it would leave a hole.
        let state = load_state(&part, 1000, None).await;
        assert!(state.done.is_empty());

        tokio::fs::remove_dir_all(&dir).await.unwrap();
    }
}
