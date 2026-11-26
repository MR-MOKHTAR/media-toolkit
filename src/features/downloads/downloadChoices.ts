import type { AudioFormatChoice, CodecPref, MediaSummary } from "../jobs/types";
import { QUALITIES } from "./useDownloadSettings";

export type Quality = string;

const SIMPLE_HEIGHTS = [1080, 720, 480] as const;

/**
 * Smart, simplified quality choices (at most 4 options on a single row):
 * - Without probe metadata: `best`, `1080`, `720`, `480`.
 * - With probe metadata: includes `best` when >1080p (2K/4K) exists, plus the
 *   standard resolutions (`1080`, `720`, `480`) available on this video.
 */
export function qualityChoices(summary: MediaSummary | null): Quality[] {
  if (!summary || summary.heights.length === 0) return [...QUALITIES];

  const available = summary.heights.map((h) => h.height);
  const maxHeight = available[0] ?? 0;

  const matched = SIMPLE_HEIGHTS.filter((step) => available.includes(step)).map(String);
  const choices: Quality[] = [];

  if (maxHeight > 1080) {
    choices.push("best");
  }
  choices.push(...matched);

  if (choices.length === 0) {
    return ["best"];
  }
  return choices;
}

export function effectiveQuality(summary: MediaSummary | null, remembered: Quality): Quality {
  const choices = qualityChoices(summary);
  if (choices.includes(remembered)) return remembered;

  if (!summary || summary.heights.length === 0) return remembered;

  if (remembered === "best") {
    return choices[0];
  }

  const cap = Number(remembered);
  const numericChoices = choices.filter((c) => c !== "best").map(Number);
  const fits = numericChoices.find((h) => h <= cap);
  if (fits !== undefined) return String(fits);
  if (numericChoices.length > 0) return String(numericChoices[numericChoices.length - 1]);
  return "best";
}

export function videoSize(
  summary: MediaSummary | null,
  quality: Quality,
  codec: CodecPref,
): number | null {
  if (!summary || summary.heights.length === 0) return null;
  const option =
    quality === "best"
      ? summary.heights[0]
      : summary.heights.find((h) => String(h.height) === quality);
  if (!option) return null;
  if (codec === "compatible") return option.compatibleSizeBytes ?? null;
  if (codec === "small") return option.sizeBytes ? Math.round(option.sizeBytes * 0.55) : null;
  return option.sizeBytes;
}

export function bestHeightLabel(summary: MediaSummary | null): string | null {
  const top = summary?.heights[0]?.height;
  if (!top) return null;
  if (top >= 2160) return "4K";
  if (top >= 1440) return "2K";
  return `${top}p`;
}

const MP3_VBR_KBPS = 245;

export function audioSizeBytes(
  summary: MediaSummary | null,
  durationSecs: number | null,
  format: AudioFormatChoice,
): number | null {
  const tracks = summary?.audio ?? [];
  const best = tracks[0];
  const aac = tracks.find((track) => track.codec === "aac");
  const bySeconds = (kbps: number) =>
    durationSecs && durationSecs > 0 ? Math.round((kbps * 1000 * durationSecs) / 8) : null;

  switch (format) {
    case "original":
      return best?.sizeBytes ?? null;
    case "m4a":
      return aac?.sizeBytes ?? bySeconds(192);
    case "opus":
      return tracks.find((t) => t.codec === "opus")?.sizeBytes ?? bySeconds(160);
    case "mp3":
      return bySeconds(MP3_VBR_KBPS);
  }
}

export function audioDetail(format: AudioFormatChoice, mp3Kbps: number): string {
  switch (format) {
    case "original":
      return "t:audio_format_original";
    case "m4a":
      return "M4A";
    case "opus":
      return "Opus";
    case "mp3":
      return mp3Kbps ? `MP3 ${mp3Kbps}k` : "MP3";
  }
}

export function clockOf(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function secondsOf(text: string): number | null {
  const parts = text.trim().replace(/[٫,]/g, ".").split(":");
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => p === "")) return null;
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return numbers.reduce((total, n) => total * 60 + n, 0);
}
