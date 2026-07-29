//! The job registry.
//!
//! Replaces a single `Mutex<Option<Child>>`, which allowed exactly one running
//! download by construction and forced the UI to disable its own primary
//! action. Any number of jobs now run, bounded by two semaphores, and every
//! progress event carries the id of the job it belongs to.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, Semaphore};
use tokio::time::{Duration, Instant};

use crate::error::AppError;

pub const PROGRESS_EVENT: &str = "job-progress";
pub const STATUS_EVENT: &str = "job-status";

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
    Resize,
    Gif,
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
#[serde(tag = "state", rename_all = "camelCase")]
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
    pub speed: Option<String>,
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub id: String,
    pub kind: JobKind,
    pub title: String,
}

struct Entry {
    kind: JobKind,
    title: String,
    /// Taken by whoever cancels first, which is how the runner learns it was
    /// cancelled rather than having failed.
    child: Option<tokio::process::Child>,
    /// Removed on success so a completed job's output is never deleted.
    partial_output: Option<PathBuf>,
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
    pub async fn acquire(&self, kind: JobKind) -> tokio::sync::OwnedSemaphorePermit {
        let lane = match kind.lane() {
            Lane::Cpu => self.cpu.clone(),
            Lane::Network => self.net.clone(),
        };
        // The semaphores are never closed, so this cannot fail.
        lane.acquire_owned().await.expect("semaphore is open")
    }

    pub async fn attach_child(&self, id: &str, child: tokio::process::Child) {
        if let Some(entry) = self.entries.lock().await.get_mut(id) {
            entry.child = Some(child);
        }
    }

    pub async fn take_child(&self, id: &str) -> Option<tokio::process::Child> {
        self.entries
            .lock()
            .await
            .get_mut(id)
            .and_then(|entry| entry.child.take())
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

    pub async fn finish(&self, id: &str) -> Option<PathBuf> {
        self.entries
            .lock()
            .await
            .remove(id)
            .and_then(|entry| entry.partial_output)
    }

    pub async fn cancel(&self, id: &str) -> Result<(), AppError> {
        let child = {
            let mut entries = self.entries.lock().await;
            let entry = entries
                .get_mut(id)
                .ok_or_else(|| AppError::UnknownJob { id: id.to_string() })?;
            entry.child.take()
        };

        if let Some(mut child) = child {
            let _ = child.start_kill();
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
