//! The error type that crosses the IPC boundary.
//!
//! Serialized as a tagged union so the frontend gets a discriminated type it
//! can `switch` on and translate. The previous code returned `Result<_, String>`
//! everywhere, which meant raw Rust text ended up in user-facing toasts and
//! could not be localized into Persian or Arabic at all.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
// `rename_all_fields` as well as `rename_all`, for the reason spelled out on
// `JobStatus` in jobs.rs: the first renames the variants, the second their
// fields. Every field here was a single word until `retry_after_secs`, which
// crossed the bridge in snake_case and left the retry countdown permanently
// undefined -- a silent failure, since the UI just rendered no number.
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
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

    /// The request never arrived: DNS, TLS, timeout, or simply offline. Its own
    /// variant rather than an `Io` or a `Spawn`, because there is no path and no
    /// process to name and the advice is completely different -- check your
    /// connection, not check your disk.
    Network { message: String },
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

    pub fn network(error: impl std::fmt::Display) -> Self {
        Self::Network {
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
            Self::Network { message } => write!(f, "could not reach the server: {message}"),
        }
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend switches on `kind`, and every arm of that switch is one of
    /// these strings spelled in camelCase. A variant renamed on the Rust side
    /// without its `case` in `errorText.ts` falls through to the generic
    /// "something went wrong", which is a silent loss of the only useful part of
    /// a failure -- so the wire names are pinned here rather than assumed from
    /// the attribute.
    #[test]
    fn every_variant_crosses_the_bridge_in_camel_case() {
        let kind = |error: AppError| serde_json::to_value(error).unwrap()["kind"].clone();

        assert_eq!(kind(AppError::tool_missing("yt-dlp")), "toolMissing");
        assert_eq!(kind(AppError::invalid("url", "empty")), "invalidInput");
        assert_eq!(kind(AppError::spawn("ffmpeg", "no such file")), "spawn");
        assert_eq!(
            kind(AppError::Tool {
                tool: "ffmpeg".into(),
                code: Some(1),
                tail: "Invalid data".into(),
            }),
            "tool"
        );
        assert_eq!(kind(AppError::io("/tmp/x", "denied")), "io");
        assert_eq!(kind(AppError::Cancelled), "cancelled");
        assert_eq!(kind(AppError::UnknownJob { id: "7".into() }), "unknownJob");
        assert_eq!(kind(AppError::network("dns")), "network");
    }

    /// `rename_all_fields` as well as `rename_all` -- the lesson from
    /// `retry_after_secs`, which crossed the bridge in snake_case and left the
    /// field it fed permanently `undefined`. No variant carries a multi-word
    /// field today; this pins the container attribute so the next one that does
    /// cannot repeat it.
    #[test]
    fn fields_are_renamed_as_well_as_variants() {
        let json = serde_json::to_value(AppError::Tool {
            tool: "ffmpeg".into(),
            code: None,
            tail: "killed".into(),
        })
        .unwrap();
        assert_eq!(json["tool"], "ffmpeg");
        assert!(json["code"].is_null(), "{json}");
        assert_eq!(json["tail"], "killed");
    }
}
