/**
 * Silences, recomputed in the browser from the analysis' RMS windows.
 *
 * `detectSilences` mirrors `analyze::detect_silences` in Rust exactly -- the
 * backend's answer at the default threshold and this one at any other agree
 * window for window -- which is what lets the sensitivity slider move without
 * decoding the file again.
 */

export interface Silence {
  startSecs: number;
  endSecs: number;
}

/** A run of windows strictly quieter than the threshold, at least `minSecs`
 *  long. No hysteresis, no padding. The end is clamped to the duration. */
export function detectSilences(
  rmsDb: number[],
  windowSecs: number,
  thresholdDb: number,
  minSecs: number,
  durationSecs: number,
): Silence[] {
  const out: Silence[] = [];
  let start = -1;
  const close = (from: number, to: number) => {
    if ((to - from) * windowSecs >= minSecs) {
      out.push({
        startSecs: from * windowSecs,
        endSecs: Math.min(to * windowSecs, durationSecs),
      });
    }
  };
  for (let i = 0; i < rmsDb.length; i++) {
    if (rmsDb[i] < thresholdDb) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      close(start, i);
      start = -1;
    }
  }
  if (start >= 0) close(start, rmsDb.length);
  return out;
}

/**
 * What "remove the silences" keeps: everything else, with a breath of each
 * silence left on both sides so words are not clipped at their edges. A
 * silence shorter than the two breaths is left alone.
 */
export function keepSegments(
  silences: Silence[],
  durationSecs: number,
  breathSecs = 0.12,
): [number, number][] {
  const keep: [number, number][] = [];
  let cursor = 0;
  for (const silence of silences) {
    const cutFrom = silence.startSecs === 0 ? 0 : silence.startSecs + breathSecs;
    const cutTo = silence.endSecs >= durationSecs ? durationSecs : silence.endSecs - breathSecs;
    if (cutTo - cutFrom <= 0.05) continue;
    if (cutFrom > cursor) keep.push([cursor, cutFrom]);
    cursor = cutTo;
  }
  if (cursor < durationSecs) keep.push([cursor, durationSecs]);
  return keep.filter(([a, b]) => b - a > 0.05).map(([a, b]) => [round3(a), round3(b)]);
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** The range that cuts the silence off both ends -- and only the ends. */
export function trimmedEnds(
  silences: Silence[],
  durationSecs: number,
  breathSecs = 0.12,
): { start: number; end: number } {
  const first = silences[0];
  const last = silences[silences.length - 1];
  const start = first && first.startSecs <= 0.05 ? Math.max(0, first.endSecs - breathSecs) : 0;
  const end =
    last && last.endSecs >= durationSecs - 0.05
      ? Math.min(durationSecs, last.startSecs + breathSecs)
      : durationSecs;
  return end > start ? { start: round3(start), end: round3(end) } : { start: 0, end: durationSecs };
}

/** Where a handle may snap: each silence's edges and middle. */
export function snapPoints(silences: Silence[]): number[] {
  return silences.flatMap((s) => [s.startSecs, (s.startSecs + s.endSecs) / 2, s.endSecs]);
}

/** The next snap point after (or before) `t`, for the step buttons. */
export function stepTo(points: number[], t: number, direction: 1 | -1): number | null {
  const sorted = [...points].sort((a, b) => a - b);
  if (direction > 0) return sorted.find((p) => p > t + 0.01) ?? null;
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i] < t - 0.01) return sorted[i];
  return null;
}

/** dBFS to linear amplitude, for drawing the threshold over the waveform. */
export const dbToAmplitude = (db: number) => Math.pow(10, db / 20);
