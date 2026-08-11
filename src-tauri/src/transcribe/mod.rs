//! Speech to text, through Groq's hosted Whisper models.
//!
//! The only tool in this app whose work happens somewhere else. That brings
//! three things none of the ffmpeg tools have to deal with: a secret to keep
//! (`crate::settings`), a request that can be refused (`groq`), and a service
//! that meters what it costs -- which this app deliberately does not try to
//! mirror. It kept a local ledger of audio-seconds once, to print "so many
//! minutes left today" on the form. That count could only ever guess: the same
//! key is usable from a phone, a script or another machine, so it was wrong as
//! often as it was right, and being told a wrong number is worse than being
//! told none. Groq's own 429 is the authority, and the app now waits for it.

pub mod chunks;
pub mod commands;
pub mod groq;
pub mod runner;
pub mod subtitles;
