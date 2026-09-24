//! The job registry.
//!
//! Replaces a single `Mutex<Option<Child>>`, which allowed exactly one running
//! download by construction and forced the UI to disable its own primary
//! action. Any number of jobs now run, bounded by two semaphores, and every
//! progress event carries the id of the job it belongs to.

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, Notify, Semaphore};
use tokio::time::{Duration, Instant};

use crate::error::{AppError, AppResult};
use crate::process;

pub const PROGRESS_EVENT: &str = "job-progress";
pub const STATUS_EVENT: &str = "job-status";
pub const META_EVENT: &str = "job-meta";

/// Four concurrent jobs each emitting at ffmpeg's native rate would flood the
/// IPC bridge and jank React for no benefit; nothing is readable above 10 Hz.
const EMIT_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobKind {
    Download,
    Compress,
    Trim,
    Convert,
    ExtractAudio,
}

impl JobKind {
    /// Which resource this kind competes for.
    fn lane(self) -> Lane {
        match self {
            Self::Download => Lane::Network,
            _ => Lane::Cpu,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Lane {
    Cpu,
    Network,
}

/// What the job is doing right now. Downloads go through more than one phase
/// and "Merging" can take a while on a large video, so a frozen 100% bar needs
/// an explanation.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Queued,
    Preparing,
    Downloading,
    Merging,
    Encoding,
    Finalizing,
}

#[derive(Debug, Clone, Serialize)]
// `rename_all` on an enum renames the *variants* only. Fields inside a variant
// keep their Rust names unless `rename_all_fields` says otherwise, so
// `output_path` went across the bridge as snake_case while the frontend read
// `payload.outputPath` and got undefined -- which is the whole condition for
// rendering the "open folder" button, so it never appeared on any finished job.
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JobStatus {
    Queued,
    Running,
    Completed { output_path: String },
    Failed { error: AppError },
    Cancelled,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub id: String,
    pub kind: JobKind,
    /// `None` means indeterminate. Better an honest spinner than a made-up
    /// number: ffmpeg cannot report progress without a known duration.
    pub percent: Option<f64>,
    pub stage: Stage,
    /// Bytes per second, not a formatted string.
    ///
    /// It was a `String`, which meant each engine formatted its own: yt-dlp's
    /// `_speed_str` says "3.36MiB/s" and the direct downloader said "3.4 MB/s",
    /// and the two appeared on adjacent rows of the same list. A number crosses
    /// the bridge and `formatSpeed` in lib/format.ts writes it once -- in the
    /// reader's own digits, like every other figure in the UI.
    pub speed: Option<f64>,
    /// ffmpeg's realtime multiplier -- `2.0` for "twice as fast as playback".
    ///
    /// Its own field rather than more overloading of `speed`, which it shared
    /// until this became a number: a download's speed is bytes per second and an
    /// encode's is a ratio, and the UI has to write "3.4 MB/s" for one and
    /// "2.0×" for the other. One field carrying whichever the job kind happens
    /// to mean is how the two got formatted with each other's units.
    pub encode_rate: Option<f64>,
    pub eta_secs: Option<u64>,
    pub bytes: Option<u64>,
    pub total_bytes: Option<u64>,
}

impl JobProgress {
    pub fn new(id: &str, kind: JobKind, stage: Stage) -> Self {
        Self {
            id: id.to_string(),
            kind,
            percent: None,
            stage,
            speed: None,
            encode_rate: None,
            eta_secs: None,
            bytes: None,
            total_bytes: None,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatusEvent {
    pub id: String,
    pub kind: JobKind,
    #[serde(flatten)]
    pub status: JobStatus,
}

/// What a download turned out to be, once the engine that runs it knows.
///
/// The form describes a download from its probe, and a probe is a preview: it
/// can time out, be refused, or simply not have landed before the button was
/// pressed. The job used to fill that gap with a guess -- "video", because the
/// media toggle said so -- and an installer or a PDF was then drawn with a film
/// icon and filed under Video until it finished. The engine answers the same
/// question for certain the moment it has chosen how to fetch the link, so it
/// says so, and a job the form could not describe stays "unknown" only until
/// then.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobMeta {
    /// `video` or `audio`, when the job is a media download and which of the
    /// two is known. A file fetched verbatim leaves this empty and is described
    /// by its name and content type instead.
    pub media: Option<MediaClass>,
    /// The file's name as it will be saved, extension included, for a direct
    /// download.
    pub file_name: Option<String>,
    /// What the server said the file is, when it said.
    pub content_type: Option<String>,
    /// The title the source gave, for a job that could only be named after its
    /// URL when it started.
    pub title: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaClass {
    Video,
    Audio,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobMetaEvent {
    pub id: String,
    pub kind: JobKind,
    #[serde(flatten)]
    pub meta: JobMeta,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub id: String,
    pub kind: JobKind,
    pub title: String,
}

/// Cancellation for work that is not a child process.
///
/// Killing the child is enough for the five ffmpeg tools and for yt-dlp: the
/// process *is* the job. Transcription is not -- it spends most of its life
/// inside an HTTPS request and inside `sleep`s between retries, and there is no
/// child there to take. So cancel raises a flag and wakes anyone waiting on it,
/// in addition to killing whatever child happens to exist at the time.
///
/// A flag *and* a `Notify`, not one or the other: the flag answers "was it
/// cancelled" for code between awaits, and the notify is what lets a request
/// that is already in flight be dropped immediately instead of at the end of a
/// 300-second timeout.
#[derive(Clone, Default)]
pub struct CancelSignal {
    flag: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl CancelSignal {
    /// Raised by `Jobs::cancel` in the app. Reachable from the crate so the
    /// direct downloader's tests can cancel a transfer that is genuinely in
    /// flight, which is the only way to prove the partial file survives it.
    pub(crate) fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    /// Resolves once cancelled, and immediately if it already has been.
    ///
    /// The early return is the whole point: `notify_waiters` only wakes tasks
    /// that are *already* waiting, so a plain `notified().await` on a signal
    /// that fired a moment ago would hang forever.
    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        // Registered before the second check, so a cancel landing between the
        // two is still caught by the future rather than missed by both.
        let waiter = self.notify.notified();
        if self.is_cancelled() {
            return;
        }
        waiter.await;
    }

    /// Runs `future`, giving up the moment cancel fires.
    pub async fn guard<F: Future>(&self, future: F) -> AppResult<F::Output> {
        tokio::select! {
            // Biased so a signal that is already raised wins deterministically
            // rather than racing a future that may complete anyway.
            biased;
            () = self.cancelled() => Err(AppError::Cancelled),
            value = future => Ok(value),
        }
    }
}

struct Entry {
    kind: JobKind,
    title: String,
    /// Taken by whoever cancels first, which is how the runner learns it was
    /// cancelled rather than having failed.
    child: Option<tokio::process::Child>,
    /// Removed on success so a completed job's output is never deleted.
    partial_output: Option<PathBuf>,
    cancel: CancelSignal,
}

pub struct Jobs {
    entries: Mutex<HashMap<String, Entry>>,
    cpu: Arc<Semaphore>,
    net: Arc<Semaphore>,
}

impl Default for Jobs {
    fn default() -> Self {
        // x264 at -preset medium saturates every core. Running four of them on
        // a four-core laptop makes the app itself unresponsive -- the webview
        // is competing for the same CPU -- and each job takes four times as
        // long for no extra throughput.
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(2);
        let cpu = (cores / 2).clamp(1, 3);

        Self {
            entries: Mutex::new(HashMap::new()),
            cpu: Arc::new(Semaphore::new(cpu)),
            net: Arc::new(Semaphore::new(4)),
        }
    }
}

impl Jobs {
    pub async fn register(&self, id: String, kind: JobKind, title: String) {
        self.entries.insert_entry(id, kind, title).await;
    }

    /// Waits for a slot in this kind's lane. The permit is held for the
    /// lifetime of the returned guard.
    ///
    /// Gives up the moment the job is cancelled. A job waiting here has no
    /// child and no request in flight, so nothing else would notice: the fifth
    /// download, cancelled while the other four ran, used to sit on "cancelling"
    /// until one of them finished -- and then start, because nothing it did
    /// afterwards checked. The media tools did exactly that and ran to
    /// completion, reporting success on a job the user had cancelled.
    pub async fn acquire(
        &self,
        id: &str,
        kind: JobKind,
    ) -> AppResult<tokio::sync::OwnedSemaphorePermit> {
        let lane = match kind.lane() {
            Lane::Cpu => self.cpu.clone(),
            Lane::Network => self.net.clone(),
        };
        let cancel = self.cancel_signal(id).await;
        let permit = cancel.guard(lane.acquire_owned()).await?;
        // The semaphores are never closed, so this cannot fail.
        Ok(permit.expect("semaphore is open"))
    }

    /// Hands the job's child to the registry, where `cancel` can reach it.
    ///
    /// A job cancelled a moment before its child existed -- during the spawn,
    /// or between two ffmpeg passes -- would otherwise hand over a process that
    /// nobody is ever going to kill, and the job would run to the end. So the
    /// flag is checked here, under the same lock `cancel` takes, and a child
    /// arriving late is killed on the spot. The runner then finds no child to
    /// take back and reports the job cancelled, exactly as if `cancel` had
    /// taken it.
    pub async fn attach_child(&self, id: &str, mut child: tokio::process::Child) {
        {
            let mut entries = self.entries.lock().await;
            if let Some(entry) = entries.get_mut(id) {
                if !entry.cancel.is_cancelled() {
                    entry.child = Some(child);
                    return;
                }
            }
        }
        process::kill_tree(&mut child);
        let _ = child.wait().await;
    }

    pub async fn take_child(&self, id: &str) -> Option<tokio::process::Child> {
        self.entries
            .lock()
            .await
            .get_mut(id)
            .and_then(|entry| entry.child.take())
    }

    /// A handle a long-running job holds for its whole life, so it can keep
    /// checking after `finish` has already removed the entry.
    pub async fn cancel_signal(&self, id: &str) -> CancelSignal {
        self.entries
            .lock()
            .await
            .get(id)
            .map(|entry| entry.cancel.clone())
            .unwrap_or_default()
    }

    /// Records the file a job is writing, so cancelling can clean it up.
    pub async fn set_partial_output(&self, id: &str, path: PathBuf) {
        if let Some(entry) = self.entries.lock().await.get_mut(id) {
            entry.partial_output = Some(path);
        }
    }

    pub async fn clear_partial_output(&self, id: &str) {
        if let Some(entry) = self.entries.lock().await.get_mut(id) {
            entry.partial_output = None;
        }
    }

    /// Forgets the job, and kills whatever child it still had.
    ///
    /// A runner that noticed the cancel signal and stopped reading can get here
    /// before `cancel` has taken the child -- and dropping it would only kill
    /// the process itself, not what it started. See `process::kill_tree`.
    pub async fn finish(&self, id: &str) -> Option<PathBuf> {
        let entry = self.entries.lock().await.remove(id)?;
        if let Some(mut child) = entry.child {
            process::kill_tree(&mut child);
            let _ = child.wait().await;
        }
        entry.partial_output
    }

    pub async fn cancel(&self, id: &str) -> Result<(), AppError> {
        let child = {
            let mut entries = self.entries.lock().await;
            let entry = entries
                .get_mut(id)
                .ok_or_else(|| AppError::UnknownJob { id: id.to_string() })?;
            // Raised for every kind. Every runner watches it now -- while it
            // waits for a slot, between passes, and alongside its read loop --
            // so a job is stopped wherever it happens to be, not only when it
            // has a child for this to take.
            entry.cancel.cancel();
            entry.child.take()
        };

        if let Some(mut child) = child {
            process::kill_tree(&mut child);
            let _ = child.wait().await;
        }
        Ok(())
    }

    pub async fn cancel_all(&self) {
        let ids: Vec<String> = self.entries.lock().await.keys().cloned().collect();
        for id in ids {
            let _ = self.cancel(&id).await;
        }
    }

    /// Jobs still running in the backend. The webview can reload -- in dev on
    /// every save -- and needs to recover what it lost.
    pub async fn list(&self) -> Vec<JobSummary> {
        self.entries
            .lock()
            .await
            .iter()
            .map(|(id, entry)| JobSummary {
                id: id.clone(),
                kind: entry.kind,
                title: entry.title.clone(),
            })
            .collect()
    }
}

/// Small helper so `register` reads as one statement.
trait InsertEntry {
    async fn insert_entry(&self, id: String, kind: JobKind, title: String);
}

impl InsertEntry for Mutex<HashMap<String, Entry>> {
    async fn insert_entry(&self, id: String, kind: JobKind, title: String) {
        self.lock().await.insert(
            id,
            Entry {
                kind,
                title,
                child: None,
                partial_output: None,
                cancel: CancelSignal::default(),
            },
        );
    }
}

/// Rate-limits progress emission per job.
pub struct Emitters {
    app: AppHandle,
    last: Option<Instant>,
}

impl Emitters {
    pub fn new(app: AppHandle) -> Self {
        Self { app, last: None }
    }

    pub fn progress(&mut self, progress: JobProgress) {
        let now = Instant::now();
        let due = self
            .last
            .map(|last| now.duration_since(last) >= EMIT_INTERVAL)
            .unwrap_or(true);
        if !due {
            return;
        }
        self.last = Some(now);
        let _ = self.app.emit(PROGRESS_EVENT, progress);
    }

    /// Bypasses the rate limit. Used for the final 100% and for stage changes,
    /// which must not be dropped.
    pub fn progress_now(&mut self, progress: JobProgress) {
        self.last = Some(Instant::now());
        let _ = self.app.emit(PROGRESS_EVENT, progress);
    }

    /// What the job turned out to be. See `JobMeta`.
    pub fn meta(&self, id: &str, kind: JobKind, meta: JobMeta) {
        let _ = self.app.emit(
            META_EVENT,
            JobMetaEvent {
                id: id.to_string(),
                kind,
                meta,
            },
        );
    }

    pub fn status(&self, id: &str, kind: JobKind, status: JobStatus) {
        let _ = self.app.emit(
            STATUS_EVENT,
            JobStatusEvent {
                id: id.to_string(),
                kind,
                status,
            },
        );
    }
}

/// Ids are generated in the backend so a job exists before the frontend hears
/// about it, which keeps a fast-failing job from arriving before its own id.
pub fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{millis:x}-{n:x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(status: JobStatus) -> serde_json::Value {
        serde_json::to_value(JobStatusEvent {
            id: "1-0".into(),
            kind: JobKind::Trim,
            status,
        })
        .expect("status event serializes")
    }

    /// Asserts the JSON keys the frontend actually reads.
    ///
    /// This looks at serde's output rather than at the attribute, because the
    /// bug it guards was an attribute that read correctly: `rename_all` on an
    /// enum renames variants, not their fields, so `output_path` crossed the
    /// bridge in snake_case and `job.outputPath` was always undefined. Nothing
    /// failed, nothing logged -- the "open folder" button simply never rendered.
    /// Only the serialized form catches that.
    #[test]
    fn completed_carries_a_camel_case_output_path() {
        let json = event(JobStatus::Completed {
            output_path: "/home/me/clip.m4a".into(),
        });

        assert_eq!(json["outputPath"], "/home/me/clip.m4a");
        assert!(
            json.get("output_path").is_none(),
            "snake_case key leaked through: {json}"
        );
    }

    /// The bug this guards: `Notify::notify_waiters` only wakes tasks that are
    /// already parked, so waiting on a signal that fired earlier would block
    /// forever. A transcription cancelled while ffmpeg was still extracting
    /// would then hang on the very next await instead of ending.
    #[tokio::test]
    async fn cancelling_before_the_wait_still_resolves() {
        let signal = CancelSignal::default();
        signal.cancel();
        assert!(signal.is_cancelled());

        // Would hang if `cancelled()` only awaited the notification.
        tokio::time::timeout(Duration::from_millis(500), signal.cancelled())
            .await
            .expect("a signal raised earlier must resolve immediately");
    }

    #[tokio::test]
    async fn guard_gives_up_on_a_future_that_would_never_finish() {
        let signal = CancelSignal::default();
        let watcher = signal.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            watcher.cancel();
        });

        // Stands in for an HTTPS request with a 300-second timeout: without the
        // guard, cancelling would not be felt until that timeout expired.
        let result = signal
            .guard(tokio::time::sleep(Duration::from_secs(300)))
            .await;
        assert!(matches!(result, Err(AppError::Cancelled)));
    }

    #[tokio::test]
    async fn guard_passes_a_value_through_when_nothing_cancels() {
        let signal = CancelSignal::default();
        assert_eq!(signal.guard(async { 7 }).await.unwrap(), 7);
    }

    /// The rest of the union, so a renamed variant or a new field cannot drift
    /// away from `JobStatusEvent` in src/features/jobs/types.ts unnoticed.
    #[test]
    fn every_status_matches_the_typescript_union() {
        let cases = [
            (JobStatus::Queued, "queued", vec![]),
            (JobStatus::Running, "running", vec![]),
            (
                JobStatus::Completed {
                    output_path: "/tmp/out.mp4".into(),
                },
                "completed",
                vec!["outputPath"],
            ),
            (
                JobStatus::Failed {
                    error: AppError::Cancelled,
                },
                "failed",
                vec!["error"],
            ),
            (JobStatus::Cancelled, "cancelled", vec![]),
        ];

        for (status, state, extra) in cases {
            let json = event(status);
            assert_eq!(json["state"], state);
            assert_eq!(json["id"], "1-0");
            assert_eq!(json["kind"], "trim");

            let mut expected: Vec<&str> = vec!["id", "kind", "state"];
            expected.extend(extra);
            expected.sort_unstable();

            let mut actual: Vec<&str> = json
                .as_object()
                .expect("event is a JSON object")
                .keys()
                .map(String::as_str)
                .collect();
            actual.sort_unstable();

            assert_eq!(actual, expected, "unexpected keys for {state}");
        }
    }

    /// A job waiting for a slot has nothing to kill, and used to sit on
    /// "cancelling" until a slot freed -- and then run anyway.
    #[tokio::test]
    async fn cancelling_a_queued_job_ends_its_wait_for_a_slot() {
        let jobs = Arc::new(Jobs::default());
        // Fill the network lane so the next job has to queue.
        let mut held = Vec::new();
        for n in 0..4 {
            let id = format!("busy-{n}");
            jobs.register(id.clone(), JobKind::Download, "busy".into()).await;
            held.push(jobs.acquire(&id, JobKind::Download).await.unwrap());
        }

        jobs.register("queued".into(), JobKind::Download, "queued".into()).await;
        let waiting = {
            let jobs = Arc::clone(&jobs);
            tokio::spawn(async move {
                jobs.acquire("queued", JobKind::Download).await.map(|_| ())
            })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!waiting.is_finished(), "the lane is full, so the job waits");

        jobs.cancel("queued").await.unwrap();
        let outcome = tokio::time::timeout(Duration::from_millis(500), waiting)
            .await
            .expect("the wait ends as soon as the job is cancelled")
            .unwrap();
        assert!(matches!(outcome, Err(AppError::Cancelled)));
        drop(held);
    }

    /// A child that shows up after its job was cancelled -- the cancel landed
    /// during the spawn -- is killed on arrival instead of running to the end
    /// with nobody left to stop it.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_child_attached_after_cancel_is_killed_on_arrival() {
        let jobs = Jobs::default();
        jobs.register("late".into(), JobKind::Compress, "late".into()).await;
        jobs.cancel("late").await.unwrap();

        let mut cmd = std::process::Command::new("sleep");
        cmd.arg("30");
        let process::Running { child, .. } = process::spawn(cmd, "sleep").unwrap();
        let pid = child.id().expect("running");

        tokio::time::timeout(Duration::from_secs(3), jobs.attach_child("late", child))
            .await
            .expect("attaching kills and reaps rather than hanging");

        assert!(jobs.take_child("late").await.is_none(), "the runner sees it as cancelled");
        // Signal 0 only checks existence; the process is gone.
        let alive = unsafe { libc::kill(pid as libc::pid_t, 0) } == 0;
        assert!(!alive, "the late child is still running");
    }

    /// The keys the frontend's `JobMetaEvent` reads: flattened beside `id`,
    /// camelCase, and the media class in lowercase.
    #[test]
    fn the_meta_event_matches_the_typescript_shape() {
        let json = serde_json::to_value(JobMetaEvent {
            id: "1-0".into(),
            kind: JobKind::Download,
            meta: JobMeta {
                media: Some(MediaClass::Audio),
                file_name: Some("a.m4a".into()),
                content_type: Some("audio/mp4".into()),
                title: None,
            },
        })
        .unwrap();

        assert_eq!(json["id"], "1-0");
        assert_eq!(json["kind"], "download");
        assert_eq!(json["media"], "audio");
        assert_eq!(json["fileName"], "a.m4a");
        assert_eq!(json["contentType"], "audio/mp4");
        assert!(json["title"].is_null());
        assert!(json.get("file_name").is_none(), "snake_case leaked: {json}");
    }
}
