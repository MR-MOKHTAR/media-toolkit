//! Running a child process while reading both of its pipes.
//!
//! The previous code piped stderr and never read it. Two things followed from
//! that. A tool writing more than the pipe buffer (~64 KB) to stderr blocks
//! forever waiting for a reader, and ffmpeg without `-nostats` writes a lot.
//! And because the buffer was discarded, a failure surfaced as
//! "yt-dlp exited with status: 1" with the actual reason thrown away.
//!
//! Both pipes are now drained concurrently, and the tail of stderr rides along
//! with the error so the user sees "Video unavailable" instead of an exit code.

use std::collections::VecDeque;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

use crate::error::{AppError, AppResult};

/// How much stderr to keep. Enough for a real diagnostic, bounded so a chatty
/// tool cannot grow this without limit -- it is persisted with the job.
const TAIL_LINES: usize = 40;

pub struct Running {
    pub child: Child,
    pub lines: mpsc::Receiver<Line>,
}

#[derive(Debug)]
pub enum Line {
    Stdout(String),
    Stderr(String),
}

/// Spawns `cmd` with both pipes captured and readers already running.
///
/// Reading starts immediately rather than after the caller takes the child,
/// which is what keeps a full stderr buffer from wedging the process.
///
/// On Unix the child leads a process group of its own, so `kill_tree` can take
/// everything it started along with it -- see there for why that matters.
pub fn spawn(mut cmd: std::process::Command, tool: &str) -> AppResult<Running> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let mut child = Command::from(cmd)
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| AppError::spawn(tool, error))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (tx, rx) = mpsc::channel(256);

    if let Some(stdout) = stdout {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if tx.send(Line::Stdout(line)).await.is_err() {
                    break;
                }
            }
        });
    }

    if let Some(stderr) = stderr {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if tx.send(Line::Stderr(line)).await.is_err() {
                    break;
                }
            }
        });
    }

    Ok(Running { child, lines: rx })
}

/// Kills a child and everything it started.
///
/// Killing only the child is not enough, and the child that proves it is
/// yt-dlp. Every build the app bundles is a PyInstaller one-file executable:
/// the process we spawn is a small bootloader, and the Python that actually
/// downloads is *its* child. SIGKILL cannot be forwarded, so killing the
/// bootloader orphaned the real downloader -- measured against a throttled
/// local server, it went on fetching for another 30 seconds and kept both of
/// our pipes open the whole time. The job's read loop was waiting on those
/// pipes, so a cancelled download kept reporting progress and only said
/// "cancelled" once the file had finished anyway. The ffmpeg yt-dlp starts to
/// merge has the same problem one level further down.
///
/// On Unix the whole process group goes (`spawn` makes the child its leader).
/// On Windows `taskkill /T` walks the tree while the root is still alive to be
/// walked from. The plain kill afterwards covers a child that was not spawned
/// through `spawn`, and is harmless when the tree is already gone.
pub fn kill_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        kill_tree_pid(pid);
    }
    let _ = child.start_kill();
}

fn kill_tree_pid(pid: u32) {
    #[cfg(unix)]
    {
        // `spawn` made the child the leader of its own group, so its pid is the
        // group id. A pid that does not fit, or a group that is already gone,
        // leaves nothing to do.
        if let Ok(group) = libc::pid_t::try_from(pid) {
            if group > 0 {
                // SAFETY: killpg only sends a signal; it touches no memory.
                unsafe {
                    libc::killpg(group, libc::SIGKILL);
                }
            }
        }
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        crate::binaries::hide_console(&mut cmd);
        // Waited for, so the tree is gone before the root is killed on its own
        // below -- killing the root first would leave nothing to walk from.
        let _ = cmd.status();
    }
    #[cfg(not(any(unix, windows)))]
    let _ = pid;
}

/// Kills the tree of a child that is dropped before it was waited for.
///
/// `kill_on_drop` takes the child itself and nothing below it, which for
/// yt-dlp is the bootloader and not the downloader -- see `kill_tree`. This is
/// what makes dropping a guarded `output` future, which is how a resolve or a
/// merge is cancelled, actually stop the work.
struct TreeGuard(Option<u32>);

impl TreeGuard {
    fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for TreeGuard {
    fn drop(&mut self) {
        if let Some(pid) = self.0.take() {
            kill_tree_pid(pid);
        }
    }
}

/// Waits, briefly, for a killed child's pipes to close.
///
/// A runner that sees the cancel signal stops reporting at once, but the
/// process it was reading may take a moment to die -- `cancel` is killing it on
/// another task. Returning straight away let the runner delete a half-written
/// output while ffmpeg still held it open, which on Windows is a sharing
/// violation and a truncated file left behind in the user's folder; and a retry
/// pressed immediately could start a second yt-dlp on a `.part` the first was
/// still writing. The pipes close when the last process holding them exits,
/// which after `kill_tree` is milliseconds. The limit is only for a descendant
/// that somehow escaped the kill, which must not hold the job open for good.
pub async fn drain(lines: &mut mpsc::Receiver<Line>, limit: std::time::Duration) {
    let _ = tokio::time::timeout(limit, async { while lines.recv().await.is_some() {} }).await;
}

/// How long `drain` waits for a killed tree to let go of its pipes.
pub const DRAIN_LIMIT: std::time::Duration = std::time::Duration::from_secs(5);

/// A bounded ring of the most recent stderr lines.
#[derive(Default)]
pub struct StderrTail(VecDeque<String>);

impl StderrTail {
    pub fn push(&mut self, line: String) {
        if self.0.len() == TAIL_LINES {
            self.0.pop_front();
        }
        self.0.push_back(line);
    }

    pub fn into_string(self) -> String {
        self.0.into_iter().collect::<Vec<_>>().join("\n")
    }
}

/// Runs a command to completion and returns its stdout, or the stderr tail on
/// failure. For short one-shot calls like `ffprobe -show_format`, not for jobs.
pub async fn output(cmd: std::process::Command, tool: &str) -> AppResult<String> {
    let mut running = spawn(cmd, tool)?;
    // Declared after `running`, so it drops first: the tree is killed while its
    // root has not yet been reaped, which is what `taskkill /T` needs.
    let mut guard = TreeGuard(running.child.id());
    let mut stdout = String::new();
    let mut tail = StderrTail::default();

    while let Some(line) = running.lines.recv().await {
        match line {
            Line::Stdout(line) => {
                stdout.push_str(&line);
                stdout.push('\n');
            }
            Line::Stderr(line) => tail.push(line),
        }
    }

    let status = running.child.wait().await;
    // Reaped: from here the pid may belong to something else entirely.
    guard.disarm();
    let status = status.map_err(|error| AppError::spawn(tool, error))?;

    if status.success() {
        Ok(stdout)
    } else {
        Err(AppError::Tool {
            tool: tool.to_string(),
            code: status.code(),
            tail: tail.into_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// The bug `kill_tree` exists for, in miniature: a child that starts a
    /// descendant of its own, which inherits the pipes. Killing only the child
    /// left the descendant holding them, and a job's read loop waited on those
    /// pipes until it exited -- which is what a PyInstaller yt-dlp does on every
    /// download.
    #[cfg(unix)]
    #[tokio::test]
    async fn killing_the_tree_closes_the_pipes_a_descendant_was_holding() {
        let mut cmd = std::process::Command::new("sh");
        // The inner `sleep` is the stand-in for the real downloader.
        cmd.args(["-c", "sleep 30 & echo started; wait"]);
        let Running { mut child, mut lines } = spawn(cmd, "sh").expect("sh runs");

        // Wait for the descendant to exist before killing anything.
        match tokio::time::timeout(Duration::from_secs(5), lines.recv()).await {
            Ok(Some(Line::Stdout(line))) => assert_eq!(line, "started"),
            other => panic!("expected the start line, got {other:?}"),
        }

        kill_tree(&mut child);
        let _ = child.wait().await;

        tokio::time::timeout(Duration::from_secs(3), async {
            while lines.recv().await.is_some() {}
        })
        .await
        .expect("with the whole group killed, nothing is left holding the pipes");
    }

    /// Dropping a guarded `output` -- how a resolve or a merge is cancelled --
    /// takes the descendants with it, not only the child.
    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_a_one_shot_run_kills_what_it_started() {
        let marker = std::env::temp_dir().join(format!("mt-tree-{}", std::process::id()));
        let _ = std::fs::remove_file(&marker);

        let mut cmd = std::process::Command::new("sh");
        // The descendant writes the marker only if it outlives the kill.
        let script = format!("(sleep 1; touch '{}') & wait", marker.display());
        cmd.args(["-c", &script]);

        let run = output(cmd, "sh");
        assert!(tokio::time::timeout(Duration::from_millis(200), run).await.is_err());

        tokio::time::sleep(Duration::from_millis(1500)).await;
        assert!(!marker.exists(), "the descendant survived the cancel");
    }
}
