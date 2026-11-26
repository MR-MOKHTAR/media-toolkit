import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatPreciseTimecode, formatTimecode } from "../../../lib/format";
import type { AudioAnalysis } from "../../../lib/ipc";
import { dbToAmplitude, snapPoints, type Silence } from "./silence";

interface Props {
  analysis: AudioAnalysis;
  mode: "range" | "silences";
  start: number;
  end: number;
  onRangeChange: (start: number, end: number) => void;
  silences: Silence[];
  /** In "remove silences" mode: what will be kept. */
  keep: [number, number][] | null;
  thresholdDb: number;
  snap: boolean;
  /** The preview player, for the playhead; seeks go back through `onSeek`. */
  audio: HTMLAudioElement | null;
  onSeek: (seconds: number) => void;
  view: { from: number; to: number };
  onViewChange: (view: { from: number; to: number }) => void;
}

const WAVE_HEIGHT = 156;
const AXIS_HEIGHT = 20;
const HANDLE_GRAB_PX = 10;
const SNAP_PX = 10;
const MIN_VIEW_SECS = 1.5;

type Drag =
  | { kind: "start" | "end" }
  | { kind: "pending"; downX: number; downT: number }
  | null;

/**
 * The file's sound, drawn: loud parts tall, silences flat and hatched, each
 * silence labelled with its length -- so the place to cut is the place that
 * looks empty, not a number to type.
 *
 * Time runs left to right in every language, like every waveform anyone has
 * seen; the container is pinned `ltr` for that reason.
 *
 * Drawn on a canvas, redrawn on change, never per frame: the playhead is a
 * DOM line moved by its own animation loop while the preview plays.
 */
export function WaveformCanvas({
  analysis,
  mode,
  start,
  end,
  onRangeChange,
  silences,
  keep,
  thresholdDb,
  snap,
  audio,
  onSeek,
  view,
  onViewChange,
}: Props) {
  const { t } = useTranslation();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playheadLine = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const drag = useRef<Drag>(null);
  const duration = analysis.durationSecs;
  const span = Math.max(view.to - view.from, 0.001);

  const xOf = useCallback((seconds: number) => ((seconds - view.from) / span) * width, [view.from, span, width]);
  const tOf = useCallback(
    (x: number) => Math.min(duration, Math.max(0, view.from + (x / width) * span)),
    [view.from, span, width, duration],
  );

  // Size follows the container.
  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ---------------------------------------------------------------- draw
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    const height = WAVE_HEIGHT + AXIS_HEIGHT;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const css = getComputedStyle(element);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const dark = document.documentElement.classList.contains("dark");
    const accent = color("--color-accent", "#2dd4bf");
    const onAccent = color("--color-on-accent", dark ? "#071f1d" : "#ffffff");
    const audioHue = color("--color-media-audio", "#5eead4");
    const muted = color("--color-fg-muted", "#7f8ca1");
    const warning = color("--color-warning", "#f0ac40");
    const danger = color("--color-danger", "#f06470");
    const line = color("--color-line", "#263244");

    const mid = WAVE_HEIGHT / 2;
    // Normalised to the loudest moment, so a quiet recording still fills the
    // card; the threshold lines use the same gain.
    const gain = Math.min(8, 0.92 / Math.max(dbToAmplitude(analysis.peakDb), 0.001));
    const columns = analysis.peaks.length / 2;
    const secondsPerColumn = duration / Math.max(columns, 1);
    const windowsPerPx = span / width / analysis.windowSecs;
    const columnsPerPx = span / width / secondsPerColumn;

    // Inside the selection (range mode) or the kept parts (silences mode).
    const kept = (seconds: number) => {
      if (mode === "range") return seconds >= start && seconds <= end;
      return keep ? keep.some(([a, b]) => seconds >= a && seconds <= b) : true;
    };
    const silent = (seconds: number) => silences.some((s) => seconds >= s.startSecs && seconds < s.endSecs);

    const gradient = ctx.createLinearGradient(0, 0, 0, WAVE_HEIGHT);
    gradient.addColorStop(0, audioHue);
    gradient.addColorStop(0.5, accent);
    gradient.addColorStop(1, audioHue);

    // Silences: a hatched band behind the waveform.
    const hatch = document.createElement("canvas");
    hatch.width = 8;
    hatch.height = 8;
    const h = hatch.getContext("2d")!;
    h.strokeStyle = warning;
    h.globalAlpha = dark ? 0.35 : 0.45;
    h.lineWidth = 1;
    h.beginPath();
    h.moveTo(0, 8);
    h.lineTo(8, 0);
    h.stroke();
    const pattern = ctx.createPattern(hatch, "repeat");
    for (const s of silences) {
      if (s.endSecs < view.from || s.startSecs > view.to) continue;
      const x0 = Math.max(0, xOf(s.startSecs));
      const x1 = Math.min(width, xOf(s.endSecs));
      ctx.fillStyle = withAlpha(warning, dark ? 0.08 : 0.1);
      ctx.fillRect(x0, 0, x1 - x0, WAVE_HEIGHT);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(x0, 0, x1 - x0, WAVE_HEIGHT);
      }
    }

    // The waveform, one column per pixel: peaks when zoomed out, RMS windows
    // when zoomed in past the peak resolution.
    for (let x = 0; x < width; x++) {
      const t0 = view.from + (x / width) * span;
      const t1 = t0 + span / width;
      let low = 0;
      let high = 0;
      if (columnsPerPx >= 1) {
        const c0 = Math.floor(t0 / secondsPerColumn);
        const c1 = Math.max(c0 + 1, Math.ceil(t1 / secondsPerColumn));
        for (let c = c0; c < c1 && c < columns; c++) {
          low = Math.min(low, analysis.peaks[c * 2]);
          high = Math.max(high, analysis.peaks[c * 2 + 1]);
        }
      } else {
        const w0 = Math.floor(t0 / analysis.windowSecs);
        const w1 = Math.max(w0 + 1, Math.ceil(t1 / analysis.windowSecs));
        let db = -90;
        for (let w = w0; w < w1 && w < analysis.rmsDb.length; w++) db = Math.max(db, analysis.rmsDb[w]);
        // RMS to an approximate peak, so the zoomed-in height matches.
        high = Math.min(1, dbToAmplitude(db) * 1.41);
        low = -high;
      }
      void windowsPerPx;
      const top = mid - high * gain * mid;
      const bottom = mid - low * gain * mid;
      const tMid = (t0 + t1) / 2;
      ctx.fillStyle = kept(tMid) ? (silent(tMid) ? withAlpha(muted, 0.55) : gradient) : withAlpha(muted, 0.35);
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }

    // The threshold: anything between the dashed lines is "silence".
    const amp = dbToAmplitude(thresholdDb) * gain * mid;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = withAlpha(warning, 0.8);
    ctx.lineWidth = 1;
    for (const y of [mid - amp, mid + amp]) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // Silence lengths, where there is room to write them.
    ctx.font = "600 11px InterVar, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const s of silences) {
      const x0 = xOf(s.startSecs);
      const x1 = xOf(s.endSecs);
      if (x1 < 0 || x0 > width || x1 - x0 < 38) continue;
      const label = `${(s.endSecs - s.startSecs).toFixed(1)}s`;
      const cx = Math.min(Math.max((x0 + x1) / 2, 20), width - 20);
      ctx.fillStyle = withAlpha(dark ? "#21222c" : "#ffffff", 0.8);
      const w = ctx.measureText(label).width + 8;
      roundRect(ctx, cx - w / 2, 4, w, 16, 4);
      ctx.fill();
      ctx.fillStyle = warning;
      ctx.fillText(label, cx, 6);
    }

    if (mode === "range") {
      // Everything outside the selection, dimmed.
      ctx.fillStyle = dark ? "rgba(25, 26, 36, 0.52)" : "rgba(255, 255, 255, 0.55)";
      const xs = xOf(start);
      const xe = xOf(end);
      if (xs > 0) ctx.fillRect(0, 0, Math.min(xs, width), WAVE_HEIGHT);
      if (xe < width) ctx.fillRect(Math.max(xe, 0), 0, width - Math.max(xe, 0), WAVE_HEIGHT);
      for (const x of [xs, xe]) {
        if (x < -2 || x > width + 2) continue;
        ctx.fillStyle = accent;
        ctx.fillRect(x - 1, 0, 2, WAVE_HEIGHT);
        roundRect(ctx, x - 5, mid - 16, 10, 32, 4);
        ctx.fill();
        ctx.fillStyle = onAccent;
        ctx.fillRect(x - 1.5, mid - 7, 1, 14);
        ctx.fillRect(x + 0.5, mid - 7, 1, 14);
      }
    } else if (keep) {
      // What is cut, marked: a red wash over each removed stretch.
      let cursor = 0;
      ctx.fillStyle = withAlpha(danger, dark ? 0.16 : 0.14);
      for (const [a, b] of [...keep, [duration, duration] as [number, number]]) {
        if (a > cursor) {
          const x0 = Math.max(0, xOf(cursor));
          const x1 = Math.min(width, xOf(a));
          if (x1 > x0) ctx.fillRect(x0, 0, x1 - x0, WAVE_HEIGHT);
        }
        cursor = b;
      }
    }

    // The time axis.
    ctx.fillStyle = withAlpha(line, 1);
    ctx.fillRect(0, WAVE_HEIGHT, width, 1);
    const step = niceStep(span, width);
    ctx.fillStyle = muted;
    ctx.font = "11px InterVar, system-ui, sans-serif";
    ctx.textBaseline = "top";
    for (let tick = Math.ceil(view.from / step) * step; tick <= view.to; tick += step) {
      const x = xOf(tick);
      ctx.fillRect(x, WAVE_HEIGHT, 1, 4);
      ctx.textAlign = x < 20 ? "left" : x > width - 20 ? "right" : "center";
      ctx.fillText(step < 1 ? `${tick.toFixed(1)}s` : formatTimecode(tick), x, WAVE_HEIGHT + 5);
    }
  }, [analysis, mode, start, end, silences, keep, thresholdDb, view, width, span, duration, xOf]);

  // ------------------------------------------------------------- playhead
  useEffect(() => {
    if (!audio) return;
    let frame = 0;
    const place = () => {
      const line = playheadLine.current;
      if (line) {
        const x = xOf(audio.currentTime);
        line.style.transform = `translateX(${x}px)`;
        line.style.opacity = x >= 0 && x <= width && (audio.currentTime > 0 || !audio.paused) ? "1" : "0";
      }
      if (!audio.paused) frame = requestAnimationFrame(place);
    };
    const onPlay = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("seeked", place);
    audio.addEventListener("pause", place);
    place();
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("seeked", place);
      audio.removeEventListener("pause", place);
    };
  }, [audio, xOf, width]);

  // ------------------------------------------------------------ pointer
  const snapped = (seconds: number) => {
    if (!snap) return seconds;
    let best = seconds;
    let bestPx = SNAP_PX;
    for (const point of snapPoints(silences)) {
      const px = Math.abs(xOf(point) - xOf(seconds));
      if (px < bestPx) {
        best = point;
        bestPx = px;
      }
    }
    return best;
  };

  const localX = (event: React.PointerEvent | PointerEvent | WheelEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    return Math.min(width, Math.max(0, event.clientX - box.left));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const x = localX(event);
    if (event.clientY - canvas.current!.getBoundingClientRect().top > WAVE_HEIGHT) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "range" && Math.abs(x - xOf(start)) <= HANDLE_GRAB_PX) drag.current = { kind: "start" };
    else if (mode === "range" && Math.abs(x - xOf(end)) <= HANDLE_GRAB_PX) drag.current = { kind: "end" };
    else drag.current = { kind: "pending", downX: x, downT: tOf(x) };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const x = localX(event);
    const seconds = tOf(x);
    setHover({ x, t: seconds });
    const current = drag.current;
    if (!current || mode !== "range") return;

    if (current.kind === "pending") {
      if (Math.abs(x - current.downX) < 4) return;
      // A drag across empty waveform draws a new selection.
      drag.current = { kind: seconds > current.downT ? "end" : "start" };
      const anchor = snapped(current.downT);
      if (seconds > current.downT) onRangeChange(anchor, Math.max(anchor + 0.05, snapped(seconds)));
      else onRangeChange(Math.min(anchor - 0.05, snapped(seconds)), anchor);
      return;
    }
    const target = snapped(seconds);
    if (current.kind === "start") onRangeChange(Math.min(target, end - 0.05), end);
    else onRangeChange(start, Math.max(target, start + 0.05));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    drag.current = null;
    if (current?.kind !== "pending") return;
    const seconds = tOf(localX(event));
    // A click on a silence, in range mode, moves the nearer handle into the
    // middle of it -- the quickest way to say "cut here".
    const inside = silences.find((s) => seconds >= s.startSecs && seconds < s.endSecs);
    if (mode === "range" && inside) {
      const middle = (inside.startSecs + inside.endSecs) / 2;
      if (Math.abs(middle - start) <= Math.abs(middle - end)) onRangeChange(Math.min(middle, end - 0.05), end);
      else onRangeChange(start, Math.max(middle, start + 0.05));
      return;
    }
    onSeek(seconds);
  };

  // Wheel: zoom around the pointer; sideways (or with Shift): pan. Attached
  // natively, because React's wheel listener is passive and cannot stop the
  // dialog from scrolling.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const x = localX(event);
      const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (horizontal) {
        const delta = ((event.shiftKey ? event.deltaY : event.deltaX) / width) * span;
        const from = Math.min(Math.max(0, view.from + delta), duration - span);
        onViewChange({ from, to: from + span });
        return;
      }
      const factor = event.deltaY > 0 ? 1.25 : 0.8;
      const next = Math.min(duration, Math.max(Math.min(MIN_VIEW_SECS, duration), span * factor));
      const anchor = view.from + (x / width) * span;
      const from = Math.min(Math.max(0, anchor - (x / width) * next), duration - next);
      onViewChange({ from, to: from + next });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, width, span, duration, onViewChange]);

  const hoverSilence = hover ? silences.find((s) => hover.t >= s.startSecs && hover.t < s.endSecs) : null;
  const zoomed = span < duration - 0.01;
  const cursor =
    hover && mode === "range" && (Math.abs(hover.x - xOf(start)) <= HANDLE_GRAB_PX || Math.abs(hover.x - xOf(end)) <= HANDLE_GRAB_PX)
      ? "ew-resize"
      : hoverSilence && mode === "range"
        ? "pointer"
        : "crosshair";

  return (
    <div dir="ltr" className="flex flex-col gap-2">
      <div ref={wrap} className="relative w-full overflow-hidden rounded-md">
        <canvas
          ref={canvas}
          className="block touch-none"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={() => onViewChange({ from: 0, to: duration })}
          role="img"
          aria-label={t("trim_waveform")}
        />
        <div
          ref={playheadLine}
          className="pointer-events-none absolute top-0 left-0 w-0.5 bg-fg opacity-0 shadow-[0_0_6px_var(--color-accent)]"
          style={{ height: WAVE_HEIGHT }}
        />
        {hover && (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-sm bg-tooltip px-1.5 py-0.5 text-xs whitespace-nowrap text-tooltip-fg tnum"
            style={{ left: Math.min(Math.max(hover.x, 44), width - 44), top: WAVE_HEIGHT - 26 }}
          >
            {formatPreciseTimecode(hover.t)}
            {hoverSilence && (
              <span className="ms-1.5 text-warning">
                {t("trim_silence_len", { secs: (hoverSilence.endSecs - hoverSilence.startSecs).toFixed(1) })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Where the view is in the whole file, and a handle to move it, once
          zoomed in. */}
      {zoomed && (
        <ViewScroller duration={duration} view={view} onViewChange={onViewChange} />
      )}
    </div>
  );
}

function ViewScroller({
  duration,
  view,
  onViewChange,
}: {
  duration: number;
  view: { from: number; to: number };
  onViewChange: (view: { from: number; to: number }) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const grab = useRef<{ x: number; from: number } | null>(null);
  const span = view.to - view.from;

  return (
    <div
      ref={track}
      className="relative h-2 w-full rounded-full bg-line"
      onPointerMove={(event) => {
        if (!grab.current || !track.current) return;
        const width = track.current.getBoundingClientRect().width;
        const delta = ((event.clientX - grab.current.x) / width) * duration;
        const from = Math.min(Math.max(0, grab.current.from + delta), duration - span);
        onViewChange({ from, to: from + span });
      }}
      onPointerUp={() => (grab.current = null)}
    >
      <div
        className="absolute top-0 h-2 cursor-grab rounded-full bg-accent/70 active:cursor-grabbing"
        style={{ left: `${(view.from / duration) * 100}%`, width: `${Math.max(2, (span / duration) * 100)}%` }}
        onPointerDown={(event) => {
          event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
          grab.current = { x: event.clientX, from: view.from };
        }}
      />
    </div>
  );
}

/** A tick spacing that leaves ~80px between labels. */
function niceStep(span: number, width: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const wanted = (span / width) * 80;
  return steps.find((step) => step >= wanted) ?? 7200;
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4 ? color.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : color;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return color;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
