/**
 * Formatting, with three deliberately different rules for numbers.
 *
 * 1. Counts, percentages and dates are localized. Persian renders ۳ where
 *    plain `ar` renders 3 -- CLDR defaults `ar` to Latin digits and only
 *    region tags like ar-EG select Arabic-Indic. That per-locale nuance is
 *    exactly why this goes through Intl rather than a hand-written digit map.
 * 2. Sizes and speeds localize the number but keep the unit in Latin. MB and
 *    KB are what Persian and Arabic speakers actually read; translating them
 *    hurts comprehension.
 * 3. Timecodes stay in ASCII digits in every language. Persian digits in an
 *    mm:ss field are hard to scan and awkward to edit, and the same goes for
 *    URLs and file paths.
 */

/** Intl formatters are expensive to construct and get called per render. */
const numberFormatters = new Map<string, Intl.NumberFormat>();
/** Dates inside the current year; see `formatDate`. */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
/** And the ones that have to name their year. */
const datedYearFormatters = new Map<string, Intl.DateTimeFormat>();

function numberFormatter(language: string, digits: number) {
  const key = `${language}:${digits}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(language, {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    });
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatCount(value: number, language: string): string {
  return numberFormatter(language, 0).format(value);
}

/** Rule 1: a percentage is a count, so it localizes -- ۴۲٪ in Persian, ٤٢٪ in
 *  Arabic, including the percent sign's own position. Intl wants a fraction,
 *  not 0-100. */
export function formatPercent(value: number, language: string): string {
  const key = `${language}:pct`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(language, {
      style: "percent",
      maximumFractionDigits: 0,
    });
    numberFormatters.set(key, formatter);
  }
  return formatter.format(Math.min(100, Math.max(0, value)) / 100);
}

/** Rule 2: localized number, Latin unit. */
export function formatBytes(bytes: number | undefined, language: string): string {
  if (bytes === undefined || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${numberFormatter(language, digits).format(value)} ${units[unit]}`;
}

/**
 * Rule 2 again: a transfer rate, from bytes per second.
 *
 * The single place either download engine's speed is written. It used to be two
 * places -- yt-dlp's own `_speed_str` produced "3.36MiB/s" and the direct
 * downloader formatted "3.4 MB/s" in Rust -- and the two appeared on adjacent
 * rows of the same list, in different units, with Latin digits in a Persian
 * interface. Both now send a number and this writes it.
 */
export function formatSpeed(
  bytesPerSecond: number | undefined,
  language: string,
): string {
  if (bytesPerSecond === undefined || bytesPerSecond <= 0) return "";
  return `${formatBytes(bytesPerSecond, language)}/s`;
}

/**
 * ffmpeg's realtime multiplier, as "2.0×".
 *
 * Not a transfer rate and not interchangeable with one: it says how many
 * seconds of media are processed per second of wall clock. The multiplication
 * sign is U+00D7 rather than the letter x.
 */
export function formatRate(
  rate: number | undefined,
  language: string,
): string {
  if (rate === undefined || rate <= 0) return "";
  return `${numberFormatter(language, rate >= 10 ? 0 : 1).format(rate)}×`;
}

/** Rule 3: ASCII, always, and zero-padded so the width does not jump. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${pad(minutes)}:${pad(secs)}`;
}

/** Parses "1:23" or "83" back to seconds, for the trim inputs. */
export function parseTimecode(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n) || n < 0) return null;
    seconds = seconds * 60 + n;
  }
  return seconds;
}

export function formatDuration(seconds: number | undefined | null): string {
  return seconds === undefined || seconds === null ? "—" : formatTimecode(seconds);
}

export function formatEta(seconds: number | undefined, language: string): string {
  if (seconds === undefined || seconds < 0) return "";
  if (seconds < 60) return `${formatCount(seconds, language)}s`;
  const minutes = Math.round(seconds / 60);
  return `${formatCount(minutes, language)}m`;
}

export function formatRelativeTime(timestamp: number, language: string): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
  ];

  let value = seconds;
  for (const [unit, step] of units) {
    if (Math.abs(value) < step) {
      return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(
        value,
        unit,
      );
    }
    value = Math.round(value / step);
  }
  return formatDate(timestamp, language);
}

/**
 * A past date, at the length a metadata line can afford.
 *
 * `dateStyle: "medium"` with `timeStyle: "short"` spells out both the year and
 * the minute on every row -- "Aug 1, 2026, 10:05 AM" is 21 characters, wider in
 * the history panel than the status, the format and the quality put together,
 * so the metadata line wrapped and the card grew a third row. Both halves of
 * that string are the parts nobody reads:
 *
 *   - the year, because this list is newest-first and the rows old enough to
 *     reach this formatter at all are overwhelmingly from the year in progress.
 *     It is spelled only when it differs, which is exactly where it informs.
 *   - the time of day, because anything inside a week is still relative here
 *     ("3 days ago"). By the time a row falls through to a date, the minute it
 *     started is not what anyone is scanning for -- the day is.
 *
 * What is left is "Aug 1", a third of the width, which is what lets the whole
 * metadata line hold one row at the panel's 400px.
 */
export function formatDate(timestamp: number, language: string): string {
  const sameYear =
    new Date(timestamp).getFullYear() === new Date().getFullYear();
  const cache = sameYear ? dateFormatters : datedYearFormatters;

  let formatter = cache.get(language);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
    cache.set(language, formatter);
  }
  return formatter.format(timestamp);
}

/**
 * A job's title, as something worth reading in the width a card gives it.
 *
 * Almost every job is titled with a file name and needs nothing done to it.
 * The exception is a download whose probe never answered: `startDownload`
 * falls back to `title: url`, and a raw link truncated to fit a 250px column
 * shows `https://www.youtube.com/liv…` -- twenty characters of which nineteen
 * are shared by every YouTube link ever pasted. The scheme and the `www.` are
 * the two pieces of a URL that identify nothing, so dropping them hands those
 * characters back to the part that does. A trailing slash goes with them for
 * the same reason.
 *
 * Only ever for display: the full link stays in the `title` attribute, and the
 * job's own `title` is untouched, because that is what the retry request and
 * the file on disk are named after.
 */
export function displayTitleOf(title: string): string {
  if (!/^https?:\/\//i.test(title)) return title;
  return title.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "");
}

export const fileNameOf = (path: string) => path.split(/[/\\]/).pop() ?? path;

export const fileStemOf = (path: string) =>
  fileNameOf(path).replace(/\.[^.]+$/, "");
