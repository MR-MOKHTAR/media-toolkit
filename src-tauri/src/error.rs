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

    /// No API key configured for a service that needs one. Recoverable in the
    /// same way `ToolMissing` is: the UI points at Settings.
    MissingApiKey { service: String },

    /// The quota is spent. `scope` is the difference between "wait a few
    /// minutes" and "come back tomorrow", which is the only thing the user can
    /// act on, so it is carried rather than flattened into a message.
    RateLimited {
        scope: RateScope,
        /// What the service asked us to wait, when it said. Absent for a limit
        /// we refused locally, before sending anything.
        retry_after_secs: Option<u64>,
    },

    /// The service answered, and the answer was a refusal. Distinct from
    /// `Spawn` (never reached it) and `Tool` (a local binary failed).
    Api {
        service: String,
        status: u16,
        message: String,
    },

    /// The request never arrived: DNS, TLS, timeout, or simply offline. Split
    /// from `Api` because there is no status to report and the advice is
    /// completely different -- check your connection, not check your key.
    Network { message: String },
}

/// Which window ran out. Both refill on their own; only the wait differs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RateScope {
    Hour,
    Day,
    /// The service said no without telling us which budget it was. Reported as
    /// "busy, try again" rather than inventing a window.
    Request,
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

    pub fn api(service: impl Into<String>, status: u16, message: impl Into<String>) -> Self {
        Self::Api {
            service: service.into(),
            status,
            message: message.into(),
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
            Self::MissingApiKey { service } => write!(f, "no {service} API key configured"),
            Self::RateLimited {
                scope,
                retry_after_secs,
            } => match retry_after_secs {
                Some(secs) => write!(f, "rate limited ({scope:?}), retry in {secs}s"),
                None => write!(f, "rate limited ({scope:?})"),
            },
            Self::Api {
                service,
                status,
                message,
            } => write!(f, "{service} returned {status}: {message}"),
            Self::Network { message } => write!(f, "could not reach the service: {message}"),
        }
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend switches on `kind` and reads the fields by camelCase name.
    /// Asserting on the serialized form rather than the attribute is the lesson
    /// from `output_path`: an attribute can read correctly and still emit
    /// snake_case, and the only symptom is a `undefined` the UI renders as an
    /// empty string.
    #[test]
    fn the_new_variants_cross_the_bridge_in_camel_case() {
        let json = serde_json::to_value(AppError::RateLimited {
            scope: RateScope::Day,
            retry_after_secs: Some(90),
        })
        .unwrap();
        assert_eq!(json["kind"], "rateLimited");
        assert_eq!(json["scope"], "day");
        assert_eq!(json["retryAfterSecs"], 90);
        assert!(json.get("retry_after_secs").is_none(), "{json}");

        let json = serde_json::to_value(AppError::MissingApiKey {
            service: "Groq".into(),
        })
        .unwrap();
        assert_eq!(json["kind"], "missingApiKey");
        assert_eq!(json["service"], "Groq");

        let json = serde_json::to_value(AppError::api("Groq", 401, "invalid key")).unwrap();
        assert_eq!(json["kind"], "api");
        assert_eq!(json["status"], 401);
        assert_eq!(json["message"], "invalid key");
    }

    /// A locally refused limit has nothing to report as a wait, and inventing
    /// one would put a countdown on the screen that means nothing.
    #[test]
    fn a_preflight_refusal_carries_a_null_retry_after() {
        let json = serde_json::to_value(AppError::RateLimited {
            scope: RateScope::Hour,
            retry_after_secs: None,
        })
        .unwrap();
        assert!(json["retryAfterSecs"].is_null(), "{json}");
    }
}
