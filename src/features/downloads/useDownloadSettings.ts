import { useCallback, useEffect, useState } from "react";

import type { AudioFormatChoice, CodecPref } from "../jobs/types";

const STORAGE_KEY = "media-toolkit-download-v1";

export const QUALITIES = ["best", "1080", "720", "480"] as const;

export type DownloadQuality = (typeof QUALITIES)[number];

export const AUDIO_FORMATS: AudioFormatChoice[] = ["original", "mp3", "m4a"];

export type AudioFormat = AudioFormatChoice;

export type CookieBrowser = string;

export const NO_COOKIES = "";

export interface DownloadSettings {
  quality: DownloadQuality;
  mediaType: "video" | "audio";
  audioFormat: AudioFormat;
  cookiesFrom: CookieBrowser;
  parallel: boolean;
  scheduleTime: string;
  codec: CodecPref;
  container: "mp4" | "mkv";
  mp3Bitrate: number;
  embedMetadata: boolean;
  embedCover: boolean;
  subtitleLangs: string[];
  subtitleEmbed: boolean;
  sponsorBlock: boolean;
  playlistFolder: boolean;
  playlistNumbers: boolean;
  advancedOpen: boolean;
}

const DEFAULTS: DownloadSettings = {
  quality: "1080",
  mediaType: "video",
  audioFormat: "original",
  cookiesFrom: NO_COOKIES,
  parallel: true,
  scheduleTime: "02:00",
  codec: "auto",
  container: "mp4",
  mp3Bitrate: 0,
  embedMetadata: true,
  embedCover: true,
  subtitleLangs: [],
  subtitleEmbed: true,
  sponsorBlock: false,
  playlistFolder: true,
  playlistNumbers: true,
  advancedOpen: false,
};

function normalizeQuality(raw: unknown): DownloadQuality {
  if (raw === "best" || raw === "2160" || raw === "1440") return "best";
  if (raw === "1080") return "1080";
  if (raw === "720") return "720";
  if (raw === "480" || raw === "360") return "480";
  return DEFAULTS.quality;
}

function load(): DownloadSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DownloadSettings> & { quality?: string };
    const stored: DownloadSettings = {
      ...DEFAULTS,
      ...parsed,
      quality: normalizeQuality(parsed.quality),
      codec: "auto",
      container: "mp4",
      mp3Bitrate: 0,
      embedMetadata: true,
      embedCover: true,
    };
    if (!AUDIO_FORMATS.includes(stored.audioFormat)) {
      stored.audioFormat = DEFAULTS.audioFormat;
    }
    if (!Array.isArray(stored.subtitleLangs)) stored.subtitleLangs = [];
    return stored;
  } catch {
    return DEFAULTS;
  }
}

export function useDownloadSettings() {
  const [settings, setSettings] = useState<DownloadSettings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Session-only when storage is unavailable.
    }
  }, [settings]);

  const update = useCallback(
    <K extends keyof DownloadSettings>(key: K, value: DownloadSettings[K]) => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  return { settings, update };
}

export function qualityLabel(quality: string, best: string): string {
  return quality === "best" ? best : `${quality}p`;
}
