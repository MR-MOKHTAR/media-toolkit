//! Speech to text, through Groq's hosted Whisper models.
//!
//! The only tool in this app whose work happens somewhere else. That brings
//! three things none of the ffmpeg tools have to deal with, and each has a file
//! of its own: a secret to keep (`crate::settings`), a budget someone else
//! meters (`ledger`), and a request that can be refused (`groq`).

pub mod chunks;
pub mod commands;
pub mod groq;
pub mod ledger;
pub mod runner;
pub mod subtitles;

/// The usage ledger, held for the life of the app.
///
/// A `std::sync::Mutex` rather than tokio's: every critical section is a little
/// arithmetic plus a small file write, with no await inside, so an async mutex
/// would buy nothing and `blocking_lock` inside the runtime would panic
/// outright. It is shared because two transcriptions can run at once in the
/// network lane and they must see each other's charges.
pub struct LedgerState(pub std::sync::Mutex<ledger::Ledger>);
