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
pub fn spawn(mut cmd: std::process::Command, tool: &str) -> AppResult<Running> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

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

    let status = running
        .child
        .wait()
        .await
        .map_err(|error| AppError::spawn(tool, error))?;

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
