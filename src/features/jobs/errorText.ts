import type { TFunction } from "i18next";

import type { AppError } from "./types";

/**
 * The errors yt-dlp prints that a person can act on, by the phrase that is
 * stable across its versions, and what to tell them instead.
 *
 * The last stderr line used to reach the card verbatim -- in English, with a
 * `[youtube] dQw4w9WgXcQ:` prefix, under a Persian interface. The common
 * failures deserve a sentence the user can read and a step they can take; the
 * rest still show yt-dlp's own words, which are the only accurate ones.
 */
const TOOL_ERRORS: [RegExp, string][] = [
  // YouTube's bot check, and the login walls: the cookies setting is the fix.
  [/sign in to confirm|not a bot|login required|members-only|age-restricted|confirm your age/i, "error_needs_cookies"],
  [/private video/i, "error_private"],
  [/video unavailable|this video is not available|has been removed|does not exist/i, "error_unavailable"],
  [/http error 429|too many requests/i, "error_rate_limited"],
  [/http error 403|forbidden/i, "error_forbidden"],
  [/http error 404|not found/i, "error_not_found"],
  [/unsupported url/i, "error_unsupported"],
  [/unable to connect|connection refused|timed out|name or service not known|getaddrinfo|network is unreachable/i, "error_network"],
  [/no space left/i, "error_disk_full"],
];

/** The URL reasons `validate_url` gives, which the user can fix. */
const URL_REASONS: Record<string, string> = {
  empty: "invalid_url",
  "unsupported scheme": "invalid_url",
  "not a link": "invalid_url",
  "not a playlist": "error_not_playlist",
};

/**
 * One place that turns an `AppError` into something a person can read.
 *
 * There used to be two: `describe` in useMediaJob, which translates, and
 * `describeError` in JobCard, which returned hard-coded English -- so the same
 * failure read differently depending on which screen happened to catch it, and
 * half of them ignored the locale files entirely.
 */
export function describeAppError(error: AppError, t: TFunction): string {
  switch (error.kind) {
    case "toolMissing":
      // Named: this said "ffmpeg is not available" for a missing yt-dlp too.
      return t("tool_not_found", { tool: error.tool });

    case "invalidInput": {
      const key = error.field === "url" ? URL_REASONS[error.reason] : undefined;
      // Other reasons come from the backend in English and are diagnostics,
      // not guidance.
      return key ? t(key) : error.reason;
    }

    case "tool": {
      // The stderr tail is the whole point of capturing it: the last line is
      // usually the real reason.
      const last = error.tail.split("\n").filter(Boolean).pop();
      if (!last) return t("job_failed");
      const known = TOOL_ERRORS.find(([pattern]) => pattern.test(error.tail));
      return known ? t(known[1]) : last.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, "");
    }

    case "io":
      return /no space left/i.test(error.message) ? t("error_disk_full") : error.message;

    case "spawn":
      return error.message;

    case "cancelled":
      return t("status_cancelled");

    case "network":
      // The key this read never existed, so every network failure showed the
      // literal text "error_network".
      return t("error_network");

    default:
      return t("job_failed");
  }
}
