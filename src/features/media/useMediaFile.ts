import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import * as ipc from "../../lib/ipc";
import type { AppError } from "../jobs/types";

export interface MediaInfo {
  path: string;
  container: string;
  durationSecs: number;
  sizeBytes: number;
  bitRate: number | null;
  video: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    bitRate: number | null;
  } | null;
  audio: {
    codec: string;
    channels: number;
    sampleRate: number | null;
    bitRate: number | null;
  } | null;
}

/**
 * Holds the file a tool screen is working on, and its probed metadata.
 *
 * Shared by every tool that takes one: the input step is identical everywhere,
 * which is what lets the screens look like one another.
 */
export function useMediaFile(initialPath?: string) {
  const [path, setPath] = useState<string | null>(initialPath ?? null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) {
      setInfo(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    void invoke<MediaInfo>("probe_media", { path })
      .then((result) => {
        if (!cancelled) setInfo(result);
      })
      .catch((raw) => {
        if (!cancelled) {
          setError(ipc.toAppError(raw));
          setInfo(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  const browse = useCallback(async () => {
    const selected = await ipc.chooseMediaFile(path ?? undefined);
    if (selected) setPath(selected);
  }, [path]);

  /** A multi-file drop takes the first; these tools work on one file. */
  const acceptDrop = useCallback((paths: string[]) => {
    if (paths.length > 0) setPath(paths[0]);
  }, []);

  return { path, info, error, loading, setPath, browse, acceptDrop };
}
