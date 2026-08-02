import { useCallback, useEffect, useState } from "react";

import type { TranscribeModel, TranscriptFormat } from "../jobs/types";

const STORAGE_KEY = "media-toolkit-whisper-v1";

export interface TranscribeSettings {
  model: TranscribeModel;
  /** ISO-639-1, or "" for auto-detect. */
  language: string;
  translate: boolean;
  /** `null` until the user has picked one, which is what lets the file's own
   *  kind choose the first time and never again. */
  format: TranscriptFormat | null;
}

/**
 * `whisper-large-v3`, not turbo.
 *
 * The two cost the same audio-seconds and draw on separate budgets, so turbo
 * buys speed and nothing else. Accuracy is what someone transcribing an
 * interview or a lecture actually came for, and it is the only one of the two
 * that can translate -- so the faster model is the deliberate choice, not the
 * default.
 */
const DEFAULTS: TranscribeSettings = {
  model: "whisperLargeV3",
  language: "",
  translate: false,
  format: null,
};

function load(): TranscribeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    // Spread over the defaults rather than trusting the parse: a settings blob
    // written by an older build is missing whatever was added since, and a
    // hand-edited one can be missing anything at all.
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<TranscribeSettings>) };
  } catch {
    return DEFAULTS;
  }
}

/**
 * The Whisper form's choices, remembered between runs.
 *
 * These outlive the screen for two reasons. Finishing a transcription now takes
 * you to a different route, so coming back remounts the form and would
 * otherwise reset everything you had set. And they are genuinely stable
 * preferences -- the language someone dictates in, and whether they want
 * subtitles or plain text, rarely change from one file to the next.
 *
 * localStorage like the theme and the language, not the Rust config file: none
 * of this is a secret, and the webview is the only thing that reads it.
 */
export function useTranscribeSettings() {
  const [settings, setSettings] = useState<TranscribeSettings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // The choices still apply for this session when storage is unavailable.
    }
  }, [settings]);

  const update = useCallback(
    <K extends keyof TranscribeSettings>(key: K, value: TranscribeSettings[K]) => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  return { settings, update };
}

/**
 * Which format to preselect for a file.
 *
 * A video is almost always wanted as subtitles and a recording as plain text,
 * so the first visit guesses from the file. Once a choice has been stored it
 * wins outright -- a guess must never overwrite a decision someone has already
 * made.
 */
export function formatFor(
  stored: TranscriptFormat | null,
  hasVideo: boolean,
): TranscriptFormat {
  return stored ?? (hasVideo ? "srt" : "txt");
}
