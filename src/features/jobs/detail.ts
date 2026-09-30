import type { TFunction } from "i18next";

/**
 * A job's detail line, written in words for whoever reads it.
 *
 * Details are stored with the job and outlive the language they were written
 * in: a compression started in Persian kept saying "متعادل" after the app was
 * switched to English, and a video download said "720" with no unit at all.
 * So a detail is stored as tokens and put into words here, at display time:
 *
 *   - `t:<key>` is a translation key -- `t:trim_exact`, `t:compress_balanced`;
 *   - a download's quality is its raw value -- `720`, `best`;
 *   - anything else (`MP3`, `50 MB`, `1080p`) is shown as it is, which is also
 *     what every row written before this reads as.
 *
 * Segments are joined with ` · `, the separator the detail line already uses.
 */
export function renderDetail(detail: string, t: TFunction): string {
  return detail
    .split(" · ")
    .map((part) => {
      if (part.startsWith("t:")) return t(part.slice(2));
      if (part === "best") return t("quality_best");
      if (/^\d{3,4}$/.test(part)) return `${part}p`;
      return part;
    })
    .join(" · ");
}

/** A translation key, as a detail token. */
export const detailKey = (key: string) => `t:${key}`;
