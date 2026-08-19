import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "media-toolkit-download-v1";

export const QUALITIES = ["best", "1080", "720", "480"] as const;

export type DownloadQuality = (typeof QUALITIES)[number];

export interface DownloadSettings {
  quality: DownloadQuality;
  /** Video or MP3, for the links where that is a question at all. A direct file
   *  is fetched as whatever it is, so this has nothing to say about one. */
  mediaType: "video" | "audio";
}

/**
 * 720p and video.
 *
 * "Best available" is whatever the site happens to serve -- on YouTube that is
 * often 4K, which is a multi-gigabyte file and a long wait for something most
 * people watch on a laptop. 720p is the size everyone can afford; anyone who
 * wants the full thing sets it once in Settings and never thinks about it
 * again.
 */
const DEFAULTS: DownloadSettings = { quality: "720", mediaType: "video" };

function load(): DownloadSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    // Spread over the defaults rather than trusting the parse: a settings blob
    // written by an older build is missing whatever was added since, and a
    // hand-edited one can be missing anything at all.
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DownloadSettings>) };
  } catch {
    return DEFAULTS;
  }
}

/**
 * What every download asks for, remembered between runs.
 *
 * Quality used to be a segmented control on the download form, reset to 720p on
 * every visit and asked again for every link. It is not a decision about a
 * particular video though -- it is a standing answer to "how big do I want my
 * files", the same one for months at a time -- so it belongs in Settings with
 * the theme and the library folder, and the form is one control shorter for it.
 *
 * Video-or-MP3 is here for the same reason, with one difference: the form can
 * still change it, for the one kind of link where it is a real question. It
 * writes straight through to this store rather than keeping a copy of its own,
 * so the choice is remembered for the next link and the two places can never
 * disagree about which one is set.
 *
 * localStorage like the theme, the language and the Whisper choices, not the
 * Rust config file: none of this is a secret, and the webview is the only thing
 * that reads it. The two screens that touch it are never mounted at the same
 * time -- routes swap rather than stack -- so each one reads the stored value
 * fresh when it appears.
 */
export function useDownloadSettings() {
  const [settings, setSettings] = useState<DownloadSettings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // The choice still applies for this session when storage is unavailable.
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

/** The quality as it is written on screen: "720p", or the translated words for
 *  the one option that is not a number. */
export function qualityLabel(quality: string, best: string): string {
  return quality === "best" ? best : `${quality}p`;
}
