import type { AudioFormatChoice, CodecPref, MediaSummary } from "../jobs/types";
import { QUALITIES } from "./useDownloadSettings";

/**
 * The download form's choices, worked out from what the page offers.
 *
 * Pure, so the form, the job card's label and Settings agree on every answer.
 */

/** The short side the request will actually be capped at, or "best". */
export type Quality = string;

/** The resolutions to offer: the ones this video has, or -- for a batch, a
 *  playlist, or a page that listed no formats -- the standing list. */
export function qualityChoices(summary: MediaSummary | null): Quality[] {
  if (!summary || summary.heights.length === 0) return [...QUALITIES];
  return ["best", ...summary.heights.map((h) => String(h.height))];
}

/**
 * The remembered quality, applied to this video.
 *
 * "1080" on a video that tops out at 720 is the 720 -- what the backend's
 * `res:1080` would fetch anyway -- and the chip that lights up should say so,
 * rather than a 1080p chip that does not exist. With no summary the remembered
 * value stands as it is.
 */
export function effectiveQuality(summary: MediaSummary | null, remembered: Quality): Quality {
  if (remembered === "best" || !summary || summary.heights.length === 0) return remembered;
  const cap = Number(remembered);
  const fits = summary.heights.find((h) => h.height <= cap);
  // Nothing at or under the cap: yt-dlp takes the smallest above it.
  return String(fits?.height ?? summary.heights[summary.heights.length - 1].height);
}

/** The largest resolution H.264 reaches on this page. */
export function maxCompatibleHeight(summary: MediaSummary | null): number | null {
  const found = summary?.heights.find((h) => h.compatibleSizeBytes !== null);
  return found ? found.height : null;
}

/** The estimated size for a choice, picture and sound, or null. */
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
  // AV1 runs about half of H.264 for the same picture -- measured on YouTube's
  // own pairs -- and "small" asks for it.
  if (codec === "small") return option.sizeBytes ? Math.round(option.sizeBytes * 0.55) : null;
  return option.sizeBytes;
}

/** "1080p", "1080p60", "2160p" -- and the HDR mark when the picture has it. */
export function qualityTag(summary: MediaSummary | null, quality: Quality): string | null {
  if (quality === "best") return null;
  const option = summary?.heights.find((h) => String(h.height) === quality);
  const fps = option && option.fps > 30 ? String(Math.round(option.fps)) : "";
  return `${quality}p${fps}`;
}

/** What each audio choice would deliver here: codec and bitrate as a short
 *  tag, whether it is a copy, and the estimated size. */
export interface AudioChoiceInfo {
  tag: string | null;
  copy: boolean;
  sizeBytes: number | null;
}

/** LAME's best VBR averages about this on music. */
const MP3_VBR_KBPS = 245;

export function audioChoiceInfo(
  summary: MediaSummary | null,
  durationSecs: number | null,
  format: AudioFormatChoice,
  mp3Kbps: number,
): AudioChoiceInfo {
  const tracks = summary?.audio ?? [];
  const best = tracks[0];
  const ofCodec = (codec: string) => tracks.find((track) => track.codec === codec);
  const tagOf = (codec: string, kbps: number | null) =>
    `${codec === "aac" ? "AAC" : codec === "opus" ? "Opus" : codec.toUpperCase()}${kbps ? ` · ${Math.round(kbps)}k` : ""}`;
  const bySeconds = (kbps: number) =>
    durationSecs && durationSecs > 0 ? Math.round((kbps * 1000 * durationSecs) / 8) : null;

  switch (format) {
    case "original":
      return best
        ? { tag: tagOf(best.codec, best.bitrate), copy: true, sizeBytes: best.sizeBytes }
        : { tag: null, copy: true, sizeBytes: null };
    case "m4a": {
      const aac = ofCodec("aac");
      return aac
        ? { tag: tagOf("aac", aac.bitrate), copy: true, sizeBytes: aac.sizeBytes }
        : { tag: "AAC · 192k", copy: false, sizeBytes: bySeconds(192) };
    }
    case "opus": {
      const opus = ofCodec("opus");
      return opus
        ? { tag: tagOf("opus", opus.bitrate), copy: true, sizeBytes: opus.sizeBytes }
        : { tag: "Opus · 160k", copy: false, sizeBytes: bySeconds(160) };
    }
    case "mp3":
      return {
        tag: mp3Kbps ? `MP3 · ${mp3Kbps}k` : "MP3 · VBR",
        copy: false,
        sizeBytes: bySeconds(mp3Kbps || MP3_VBR_KBPS),
      };
  }
}

/** The word on the job card for an audio download, as a detail token or a
 *  literal -- see `renderDetail`. */
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

/** Seconds as `h:mm:ss` or `m:ss`, for the section fields. */
export function clockOf(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** `h:mm:ss`, `m:ss` or plain seconds back to seconds; null when unreadable. */
export function secondsOf(text: string): number | null {
  const parts = text.trim().replace(/[٫,]/g, ".").split(":");
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => p === "")) return null;
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return numbers.reduce((total, n) => total * 60 + n, 0);
}
