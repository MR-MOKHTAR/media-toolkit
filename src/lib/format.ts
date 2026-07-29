/**
 * Formatting, with three deliberately different rules for numbers.
 *
 * 1. Counts and dates are localized. Persian renders ۳, Arabic renders ٣ --
 *    genuinely different codepoints, which is why this goes through Intl
 *    rather than a hand-written digit map.
 * 2. Sizes and speeds localize the number but keep the unit in Latin. MB and
 *    KB are what Persian and Arabic speakers actually read; translating them
 *    hurts comprehension.
 * 3. Timecodes stay in ASCII digits in every language. Persian digits in an
 *    mm:ss field are hard to scan and awkward to edit, and the same goes for
 *    URLs and file paths.
 */

/** Intl formatters are expensive to construct and get called per render. */
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

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

export function formatDate(timestamp: number, language: string): string {
  let formatter = dateFormatters.get(language);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    dateFormatters.set(language, formatter);
  }
  return formatter.format(timestamp);
}

export const fileNameOf = (path: string) => path.split(/[/\\]/).pop() ?? path;

export const fileStemOf = (path: string) =>
  fileNameOf(path).replace(/\.[^.]+$/, "");
