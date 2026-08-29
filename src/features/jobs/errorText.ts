import type { TFunction } from "i18next";

import { formatCount } from "../../lib/format";
import type { AppError } from "./types";

/**
 * One place that turns an `AppError` into something a person can read.
 *
 * There used to be two: `describe` in useMediaJob, which translates, and
 * `describeError` in JobCard, which returned hard-coded English. That was
 * survivable while every message was a path or a tool's own stderr, but a rate
 * limit has to say *when* to come back, and a sentence like that appearing in
 * English inside a Persian card is exactly what the locale files exist to stop.
 */
export function describeAppError(
  error: AppError,
  t: TFunction,
  // Only the messages carrying a number need it, and the screens that raise
  // those all have it. Defaulting keeps the existing two-argument call sites
  // unchanged rather than churning five files for a digit.
  language = "en",
): string {
  switch (error.kind) {
    case "toolMissing":
      return t("ffmpeg_not_found");

    case "invalidInput":
      // Reasons come from the backend in English and are diagnostics, not
      // guidance -- the few a user can act on have their own keys below.
      return error.reason;

    case "tool":
      // The stderr tail is the whole point of capturing it: the last line is
      // usually the real reason, like "Video unavailable".
      return error.tail.split("\n").filter(Boolean).pop() ?? t("job_failed");

    case "io":
    case "spawn":
      return error.message;

    case "cancelled":
      return t("status_cancelled");

    case "missingApiKey":
      return t("api_key_needed");

    case "rateLimited": {
      const reset = formatWait(error.retryAfterSecs, t, language);
      if (error.scope === "day") return t("error_rate_limited_day", { reset });
      if (error.scope === "hour") return t("error_rate_limited_hour", { reset });
      return t("error_rate_limited_request", { reset });
    }

    case "api":
      // 401 and 403 mean the saved key, not the request. Pointing at Settings
      // is the only useful thing to say, and Groq's own wording for it is
      // "Invalid API Key", which does not tell anyone where to fix it.
      return error.status === 401 || error.status === 403
        ? t("error_api_key_rejected")
        : t("error_api", { status: formatCount(error.status, "en") });

    case "network":
      return t("error_network");

    default:
      return t("job_failed");
  }
}

/**
 * A wait, in the roughest unit that still answers "when can I try again".
 *
 * Localized digits, because this is a count rather than a timecode -- rule 1 in
 * lib/format. Falls back to a vague phrase rather than "in null seconds" when
 * the service refused without saying how long.
 */
export function formatWait(
  seconds: number | null | undefined,
  t: TFunction,
  language = "en",
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return t("wait_a_while");
  }
  // `formatted` rather than i18next's `count`, so the digits go through Intl
  // and render as ۵ in Persian -- the same rule the job list already follows
  // for every other number.
  if (seconds < 60) {
    const value = Math.max(1, Math.ceil(seconds));
    return t("wait_seconds", { formatted: formatCount(value, language) });
  }
  if (seconds < 3600) {
    const value = Math.ceil(seconds / 60);
    return t("wait_minutes", { formatted: formatCount(value, language) });
  }
  const value = Math.ceil(seconds / 3600);
  return t("wait_hours", { formatted: formatCount(value, language) });
}
