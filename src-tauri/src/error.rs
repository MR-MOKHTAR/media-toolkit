//! The error type that crosses the IPC boundary.
//!
//! Serialized as a tagged union so the frontend gets a discriminated type it
//! can `switch` on and translate. The previous code returned `Result<_, String>`
//! everywhere, which meant raw Rust text ended up in user-facing toasts and
//! could not be localized into Persian or Arabic at all.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppError {
    /// A bundled binary could not be found. Recoverable: the UI points at the
    /// updater in Settings.
    ToolMissing { tool: String },

    /// The request was rejected before anything was spawned.
    InvalidInput { field: String, reason: String },

    /// The binary exists but would not start.
    Spawn { tool: String, message: String },

    /// The tool ran and failed. `tail` is the last of its stderr, which is the
    /// difference between "yt-dlp exited with status 1" and "Video unavailable".
    Tool {
        tool: String,
        code: Option<i32>,
        tail: String,
    },

    Io { path: String, message: String },

    /// Cancellation is a first-class outcome, not an error string. It used to
    /// be signalled by comparing against the literal "Download cancelled" on
    /// both sides of the IPC boundary.
    Cancelled,

    UnknownJob { id: String },
}

impl AppError {
    pub fn tool_missing(tool: impl Into<String>) -> Self {
        Self::ToolMissing { tool: tool.into() }
    }

    pub fn invalid(field: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::InvalidInput {
            field: field.into(),
            reason: reason.into(),
        }
    }

    pub fn spawn(tool: impl Into<String>, error: impl std::fmt::Display) -> Self {
        Self::Spawn {
            tool: tool.into(),
            message: error.to_string(),
        }
    }

    pub fn io(path: impl AsRef<Path>, error: impl std::fmt::Display) -> Self {
        Self::Io {
            path: path.as_ref().display().to_string(),
            message: error.to_string(),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ToolMissing { tool } => write!(f, "{tool} is not available"),
            Self::InvalidInput { field, reason } => write!(f, "{field}: {reason}"),
            Self::Spawn { tool, message } => write!(f, "could not start {tool}: {message}"),
            Self::Tool { tool, code, tail } => match code {
                Some(code) => write!(f, "{tool} failed (exit {code}): {tail}"),
                None => write!(f, "{tool} was terminated: {tail}"),
            },
            Self::Io { path, message } => write!(f, "{path}: {message}"),
            Self::Cancelled => write!(f, "cancelled"),
            Self::UnknownJob { id } => write!(f, "no such job: {id}"),
        }
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;
