import type { TFunction } from "i18next";

import type { AppError } from "./types";

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

    case "network":
      return t("error_network");

    default:
      return t("job_failed");
  }
}
