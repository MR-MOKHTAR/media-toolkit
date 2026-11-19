//! One speed limit for everything the app downloads itself.
//!
//! A token bucket shared by every transfer: the direct downloader's eight
//! connections, the muxed path's streams, all of them across every running
//! job. So the limit is on the line, which is what someone setting it wants to
//! protect -- "leave me enough to browse" -- rather than per connection, where
//! four downloads on eight connections each would add up to thirty-two times
//! the number they typed.
//!
//! yt-dlp's own downloads are the one thing outside it; they are given
//! `--limit-rate` with the same figure instead (see `download::run_ytdlp`).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tokio::time::Instant;

/// A token bucket. One of these is the app's limit (`global`); tests make
/// their own, so a test of the limit cannot slow the transfer tests running
/// beside it in the same process.
pub struct Limiter {
    /// Bytes per second; 0 is no limit.
    rate: AtomicU64,
    /// Tokens on hand, and when they were last topped up.
    bucket: Mutex<(f64, Instant)>,
}

impl Limiter {
    pub fn new() -> Self {
        Self {
            rate: AtomicU64::new(0),
            bucket: Mutex::new((0.0, Instant::now())),
        }
    }

    pub fn set_limit(&self, bytes_per_second: Option<u64>) {
        self.rate.store(bytes_per_second.unwrap_or(0), Ordering::Relaxed);
    }

    pub fn limit(&self) -> Option<u64> {
        Some(self.rate.load(Ordering::Relaxed)).filter(|limit| *limit > 0)
    }

    /// Accounts for `bytes` that just arrived, waiting as long as the limit
    /// says they cost.
    ///
    /// Borrowing rather than refusing: the bytes are already here, so they are
    /// taken from the bucket at once and whoever took them sleeps off the
    /// debt. The burst is one second's worth, so a transfer that paused is not
    /// let off at full speed for long when it resumes.
    pub async fn take(&self, bytes: usize) {
        let Some(rate) = self.limit() else { return };
        let rate = rate as f64;

        let wait = {
            let mut guard = self.bucket.lock().unwrap_or_else(|poison| poison.into_inner());
            let (tokens, last) = &mut *guard;
            let now = Instant::now();
            *tokens = (*tokens + now.duration_since(*last).as_secs_f64() * rate).min(rate);
            *last = now;
            *tokens -= bytes as f64;
            if *tokens >= 0.0 {
                Duration::ZERO
            } else {
                Duration::from_secs_f64(-*tokens / rate)
            }
        };

        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }
}

impl Default for Limiter {
    fn default() -> Self {
        Self::new()
    }
}

fn global() -> &'static Limiter {
    static GLOBAL: OnceLock<Limiter> = OnceLock::new();
    GLOBAL.get_or_init(Limiter::new)
}

/// Sets the app's limit, or lifts it with `None`. Takes effect on the next
/// chunk of every running transfer.
pub fn set_limit(bytes_per_second: Option<u64>) {
    global().set_limit(bytes_per_second);
}

/// The app's limit in force, if any.
pub fn limit() -> Option<u64> {
    global().limit()
}

/// `Limiter::take` on the app's limit.
pub async fn take(bytes: usize) {
    global().take(bytes).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_limit_holds_a_transfer_to_its_rate_and_lifts() {
        let limiter = Limiter::new();
        limiter.set_limit(Some(200 * 1024));
        let started = Instant::now();
        // 300 KB at 200 KB/s from an empty bucket: about a second and a half.
        for _ in 0..30 {
            limiter.take(10 * 1024).await;
        }
        let elapsed = started.elapsed();
        assert!(elapsed >= Duration::from_millis(400), "300 KB at 200 KB/s took {elapsed:?}");
        assert!(elapsed < Duration::from_secs(3), "300 KB at 200 KB/s took {elapsed:?}");

        limiter.set_limit(None);
        let started = Instant::now();
        for _ in 0..1000 {
            limiter.take(1024 * 1024).await;
        }
        assert!(started.elapsed() < Duration::from_millis(100), "no limit should cost nothing");
    }
}
