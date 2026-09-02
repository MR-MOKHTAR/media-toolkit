import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "media-toolkit-download-v1";

/** The heights offered, largest first after "best".
 *
 * 1440 and 2160 are here because the backend has always accepted them -- the
 * selector is built from whatever number arrives -- and the list simply never
 * offered them, so a 4K monitor's only route to 4K was "best", which on a phone
 * recording means something else entirely. */
export const QUALITIES = ["best", "2160", "1440", "1080", "720", "480"] as const;

export type DownloadQuality = (typeof QUALITIES)[number];

/** What an audio download ends up as.
 *
 * `original` hands over the stream the site served -- already a finished AAC or
 * Opus file -- without decoding it. `mp3` re-encodes, which every version before
 * this one did unconditionally and which is still what something downstream
 * occasionally insists on.
 *
 * The same two words the extract-audio tool uses, on purpose: it is one promise
 * made in two places. */
export const AUDIO_FORMATS = ["original", "mp3"] as const;

export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export interface DownloadSettings {
  quality: DownloadQuality;
  /** Video or audio, for the links where that is a question at all. A direct
   *  file is fetched as whatever it is, so this has nothing to say about one. */
  mediaType: "video" | "audio";
  audioFormat: AudioFormat;
  /** Fetch a video's streams on many connections instead of letting yt-dlp
   *  fetch them on one. On by default, and the reason downloads are fast; the
   *  switch exists so a site that objects to it can be worked around without
   *  waiting for a release. */
  parallel: boolean;
}

/**
 * 720p, video, and the audio left alone.
 *
 * "Best available" is whatever the site happens to serve -- on YouTube that is
 * often 4K, which is a multi-gigabyte file and a long wait for something most
 * people watch on a laptop. 720p is the size everyone can afford; anyone who
 * wants the full thing sets it once in Settings and never thinks about it
 * again.
 *
 * `original` is the audio default for the reason the extract-audio tool already
 * gives: the stream a site serves is a finished AAC or Opus file, and re-encoding
 * it to MP3 spends a minute to make it measurably worse. MP3 stays one click
 * away for whatever still insists on it. This is a change in what an audio
 * download produces -- an `.m4a` where an `.mp3` used to appear -- which is why
 * it is the default rather than a hidden option: the old behaviour was a loss
 * nobody asked for.
 */
const DEFAULTS: DownloadSettings = {
  quality: "720",
  mediaType: "video",
  audioFormat: "original",
  parallel: true,
};

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
