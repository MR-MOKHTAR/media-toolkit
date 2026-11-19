import { useEffect, useState } from "react";

import * as ipc from "../../../lib/ipc";
import type { AppError } from "../../jobs/types";

/**
 * The waveform and loudness of a file, from one ffmpeg decode in the backend.
 *
 * Cancelled when the file changes or the form closes -- a long podcast takes a
 * few seconds to decode, and finishing it for nobody would hold a CPU slot a
 * real job is waiting for.
 */
export function useAudioAnalysis(path: string | null, hasAudio: boolean) {
  const [analysis, setAnalysis] = useState<ipc.AudioAnalysis | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setAnalysis(null);
    setError(null);
    setProgress(0);
    if (!path || !hasAudio) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const token = `an-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setLoading(true);

    let stop: (() => void) | undefined;
    void ipc
      .onAnalysisProgress((payload) => {
        if (!cancelled && payload.token === token) setProgress(payload.percent);
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);

    void ipc
      .analyzeAudio(path, token)
      .then((result) => {
        if (!cancelled) setAnalysis(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(ipc.toAppError(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      stop?.();
      void ipc.cancelAnalysis(token);
    };
  }, [path, hasAudio]);

  return { analysis, progress, error, loading };
}
