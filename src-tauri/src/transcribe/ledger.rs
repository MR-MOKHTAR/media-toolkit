//! Keeping track of the audio-seconds Groq has been asked to bill.
//!
//! Groq meters Whisper in two rolling windows -- 7,200 audio-seconds an hour and
//! 28,800 a day -- and the buckets are **per model**, which is the single most
//! useful thing to tell someone who has just been refused: being out of budget
//! on turbo says nothing at all about large-v3.
//!
//! This ledger is an estimate and is written to behave like one. It cannot see
//! the same key used from another machine, from a script, or from another app,
//! so it can only ever be *optimistic* about what is left. That is why it warns
//! and never blocks: a wrong guess must not be able to lock someone out of quota
//! they actually have. Groq's own 429 is the authority, and the only thing that
//! stops a job before it starts is a pause Groq itself told us about.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::groq::Model;

/// Audio-seconds per hour (ASH), per model, on the free tier.
pub const HOUR_LIMIT: u32 = 7_200;
/// Audio-seconds per day (ASD), per model, on the free tier.
pub const DAY_LIMIT: u32 = 28_800;

const HOUR: u64 = 3_600;
const DAY: u64 = 86_400;

/// How long a rate-limit header is trusted. Groq does not document audio-seconds
/// headers at all, so anything read from one is a hint with a short shelf life
/// rather than a fact to keep.
const HINT_TTL: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Charge {
    model: Model,
    at: u64,
    secs: u32,
}

/// What Groq said about its own remaining budget, when it said anything.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerHint {
    at: u64,
    remaining: u32,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Ledger {
    charges: Vec<Charge>,
    /// Written only from a 429 Groq sent us. A local estimate may never set
    /// this: the ledger is allowed to be wrong, and a wrong guess that blocks
    /// is worse than no guess at all.
    blocked_until: HashMap<Model, u64>,
    hints: HashMap<Model, ServerHint>,
}

/// What the screen shows before a run.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    pub hour_used: u32,
    pub hour_limit: u32,
    pub day_used: u32,
    pub day_limit: u32,
    /// When the oldest charge inside the window falls out of it. In a rolling
    /// window nothing "resets" -- capacity dribbles back -- so this is the
    /// honest answer to "when can I run this".
    pub hour_frees_in_secs: u64,
    pub day_frees_in_secs: u64,
    /// Set only when Groq itself paused us.
    pub blocked_for_secs: Option<u64>,
}

impl Quota {
    // Used + limit go across the bridge and the screen subtracts them there, so
    // in the app these two exist only to keep the tests below reading as
    // statements about budget rather than as arithmetic.
    #[cfg(test)]
    pub fn hour_remaining(&self) -> u32 {
        self.hour_limit.saturating_sub(self.hour_used)
    }
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Ledger {
    /// Adds what a request is about to cost.
    ///
    /// Charged *before* the request, not after. A crash or a kill mid-run then
    /// leaves the ledger over-counting rather than under-counting, which is the
    /// safe direction for a budget: the cost of being slightly pessimistic is a
    /// warning, and the cost of being optimistic is a 429 halfway through a
    /// long file.
    pub fn charge(&mut self, model: Model, secs: u32, now: u64) {
        self.charges.push(Charge {
            model,
            at: now,
            secs,
        });
        self.prune(now);
    }

    /// Gives back a charge for a request that never reached the model.
    ///
    /// A 400 or a 413 is us building the request wrong; it costs no audio, and
    /// leaving it on the books would eat a budget the user never spent.
    pub fn refund(&mut self, model: Model, secs: u32, now: u64) {
        if let Some(index) = self
            .charges
            .iter()
            .rposition(|c| c.model == model && c.secs == secs && now.saturating_sub(c.at) < HOUR)
        {
            self.charges.remove(index);
        }
    }

    /// Records a pause Groq asked for.
    pub fn block(&mut self, model: Model, until: u64) {
        self.blocked_until.insert(model, until);
    }

    /// Folds in a `x-ratelimit-remaining-*audio*` header, when one was sent.
    ///
    /// Only ever able to make the estimate *smaller*. A header that stops being
    /// sent, or that turns out to describe a different window, must not be able
    /// to raise the local ceiling -- `min` can only be more cautious, and being
    /// cautious here costs a warning while being wrong the other way costs a
    /// failed job halfway through a long file.
    pub fn observe_remaining(&mut self, model: Model, remaining: u32, now: u64) {
        self.hints.insert(
            model,
            ServerHint {
                at: now,
                remaining,
            },
        );
    }

    pub fn quota(&self, model: Model, now: u64) -> Quota {
        let hour_used = self.used_within(model, HOUR, now);
        let day_used = self.used_within(model, DAY, now);

        // A fresh hint from Groq can only lower what we believe is left, which
        // is the same as raising what we believe is used.
        let hour_used = match self.hints.get(&model) {
            Some(hint) if now.saturating_sub(hint.at) < HINT_TTL => {
                hour_used.max(HOUR_LIMIT.saturating_sub(hint.remaining))
            }
            _ => hour_used,
        };

        Quota {
            hour_used,
            hour_limit: HOUR_LIMIT,
            day_used,
            day_limit: DAY_LIMIT,
            hour_frees_in_secs: self.frees_in(model, HOUR, now),
            day_frees_in_secs: self.frees_in(model, DAY, now),
            blocked_for_secs: self
                .blocked_until
                .get(&model)
                .filter(|until| **until > now)
                .map(|until| until - now),
        }
    }

    fn used_within(&self, model: Model, window: u64, now: u64) -> u32 {
        self.charges
            .iter()
            .filter(|c| c.model == model && now.saturating_sub(c.at) < window)
            .map(|c| c.secs)
            .sum()
    }

    /// When the oldest charge still inside the window leaves it.
    fn frees_in(&self, model: Model, window: u64, now: u64) -> u64 {
        self.charges
            .iter()
            .filter(|c| c.model == model && now.saturating_sub(c.at) < window)
            .map(|c| c.at)
            .min()
            .map(|oldest| window.saturating_sub(now.saturating_sub(oldest)))
            .unwrap_or(0)
    }

    /// Anything older than a day cannot affect either window again.
    fn prune(&mut self, now: u64) {
        self.charges
            .retain(|c| now.saturating_sub(c.at) < DAY);
        self.blocked_until.retain(|_, until| *until > now);
    }
}

// ------------------------------------------------------------- persistence

fn path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("groq-usage.json"))
}

/// Reads the ledger, treating any failure as an empty one.
///
/// Losing this file costs a temporarily optimistic estimate and nothing else --
/// which is exactly the failure this whole module is already designed to
/// tolerate -- so refusing to run over it would be out of proportion.
pub fn load(app: &AppHandle) -> Ledger {
    path(app)
        .and_then(|file| std::fs::read_to_string(file).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, ledger: &Ledger) {
    let Some(file) = path(app) else { return };
    if let Ok(body) = serde_json::to_string(ledger) {
        let _ = std::fs::write(file, body);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000;

    fn ledger_with(charges: &[(Model, u64, u32)]) -> Ledger {
        let mut ledger = Ledger::default();
        for (model, at, secs) in charges {
            ledger.charges.push(Charge {
                model: *model,
                at: *at,
                secs: *secs,
            });
        }
        ledger
    }

    /// The window rolls; it is not a clock-hour bucket. A charge 59 minutes old
    /// still counts and one 61 minutes old does not, whatever the wall clock
    /// says.
    #[test]
    fn charges_leave_the_hour_window_after_exactly_an_hour() {
        let ledger = ledger_with(&[
            (Model::LargeV3, NOW - 3_540, 600), // 59 min ago
            (Model::LargeV3, NOW - 3_660, 600), // 61 min ago
        ]);
        let quota = ledger.quota(Model::LargeV3, NOW);
        assert_eq!(quota.hour_used, 600);
        // Both are well inside the day.
        assert_eq!(quota.day_used, 1_200);
    }

    /// The fact the whole "try the other model" message rests on.
    #[test]
    fn the_two_models_do_not_share_a_budget() {
        let ledger = ledger_with(&[(Model::Turbo, NOW - 60, HOUR_LIMIT)]);

        let turbo = ledger.quota(Model::Turbo, NOW);
        assert_eq!(turbo.hour_remaining(), 0);

        let large = ledger.quota(Model::LargeV3, NOW);
        assert_eq!(large.hour_remaining(), HOUR_LIMIT);
    }

    /// A rolling window frees capacity when its oldest entry ages out, not on
    /// the hour. Reporting a clock-hour boundary would send someone away for
    /// fifty minutes when they could run in five.
    #[test]
    fn frees_in_counts_down_to_the_oldest_charge_leaving() {
        let ledger = ledger_with(&[
            (Model::Turbo, NOW - 3_000, 600),
            (Model::Turbo, NOW - 100, 600),
        ]);
        let quota = ledger.quota(Model::Turbo, NOW);
        // The oldest is 3000 s in, so 600 s of the hour remain for it.
        assert_eq!(quota.hour_frees_in_secs, 600);
    }

    #[test]
    fn an_untouched_model_has_nothing_to_wait_for() {
        let quota = Ledger::default().quota(Model::Turbo, NOW);
        assert_eq!(quota.hour_frees_in_secs, 0);
        assert_eq!(quota.hour_used, 0);
        assert!(quota.blocked_for_secs.is_none());
    }

    /// A header claiming more headroom than we counted must be ignored. If a
    /// stale or mis-scoped header could raise the ceiling, the estimate would
    /// silently stop protecting anyone.
    #[test]
    fn a_server_hint_can_only_lower_what_is_left() {
        let mut ledger = ledger_with(&[(Model::Turbo, NOW - 60, 3_600)]);
        assert_eq!(ledger.quota(Model::Turbo, NOW).hour_remaining(), 3_600);

        // Groq says less is left than we thought: believe it.
        ledger.observe_remaining(Model::Turbo, 1_000, NOW);
        assert_eq!(ledger.quota(Model::Turbo, NOW).hour_remaining(), 1_000);

        // Groq says more is left than we thought: keep our own, lower number.
        ledger.observe_remaining(Model::Turbo, 7_000, NOW);
        assert_eq!(ledger.quota(Model::Turbo, NOW).hour_remaining(), 3_600);
    }

    #[test]
    fn a_stale_hint_is_forgotten_rather_than_trusted() {
        let mut ledger = Ledger::default();
        ledger.observe_remaining(Model::Turbo, 100, NOW - HINT_TTL - 1);
        assert_eq!(ledger.quota(Model::Turbo, NOW).hour_remaining(), HOUR_LIMIT);
    }

    /// Only Groq may block. A local estimate that could block would eventually
    /// lock someone out of quota they still had.
    #[test]
    fn only_an_explicit_block_stops_a_run() {
        let mut ledger = ledger_with(&[(Model::Turbo, NOW - 10, DAY_LIMIT)]);
        // Utterly out of budget by our own count -- still not blocked.
        assert!(ledger.quota(Model::Turbo, NOW).blocked_for_secs.is_none());

        ledger.block(Model::Turbo, NOW + 90);
        assert_eq!(ledger.quota(Model::Turbo, NOW).blocked_for_secs, Some(90));
    }

    #[test]
    fn an_elapsed_block_stops_applying() {
        let mut ledger = Ledger::default();
        ledger.block(Model::Turbo, NOW - 1);
        assert!(ledger.quota(Model::Turbo, NOW).blocked_for_secs.is_none());
    }

    #[test]
    fn a_refund_removes_the_charge_it_matches() {
        let mut ledger = Ledger::default();
        ledger.charge(Model::Turbo, 600, NOW);
        ledger.charge(Model::Turbo, 300, NOW);
        assert_eq!(ledger.quota(Model::Turbo, NOW).hour_used, 900);

        ledger.refund(Model::Turbo, 300, NOW);
        assert_eq!(ledger.quota(Model::Turbo, NOW).hour_used, 600);
    }

    /// The file is rewritten after every chunk of every job; an unbounded
    /// vector would grow forever on a machine that transcribes daily.
    #[test]
    fn pruning_keeps_the_ledger_bounded() {
        let mut ledger = ledger_with(&[
            (Model::Turbo, NOW - DAY - 1, 600),
            (Model::Turbo, NOW - DAY - 500, 600),
        ]);
        ledger.charge(Model::Turbo, 10, NOW);
        assert_eq!(ledger.charges.len(), 1, "{:?}", ledger.charges);
    }

    #[test]
    fn the_ledger_round_trips_through_json() {
        let mut ledger = Ledger::default();
        ledger.charge(Model::LargeV3, 600, NOW);
        ledger.block(Model::Turbo, NOW + 60);

        let raw = serde_json::to_string(&ledger).unwrap();
        let back: Ledger = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.quota(Model::LargeV3, NOW).hour_used, 600);
        assert_eq!(back.quota(Model::Turbo, NOW).blocked_for_secs, Some(60));
    }
}
