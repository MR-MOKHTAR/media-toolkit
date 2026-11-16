import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Slider from "@radix-ui/react-slider";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Magnet,
  Pause,
  Play,
  Scissors,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { ControlGroup } from "../../../components/ui/Card";
import { CheckRow } from "../../../components/ui/CheckRow";
import { Segmented } from "../../../components/ui/Segmented";
import { TextInput } from "../../../components/ui/TextInput";
import { cn } from "../../../lib/cn";
import { formatCount, formatPercent, formatPreciseTimecode, formatTimecode, parseTimecode } from "../../../lib/format";
import * as ipc from "../../../lib/ipc";
import { extensionOf } from "../../../lib/mediaKind";
import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolForm";
import { RangeSlider } from "../components/RangeSlider";
import { AudioStatsCard } from "../trim/AudioStatsCard";
import { detectSilences, keepSegments, snapPoints, stepTo, trimmedEnds } from "../trim/silence";
import { useAudioAnalysis } from "../trim/useAudioAnalysis";
import { WaveformCanvas } from "../trim/WaveformCanvas";
import { detailKey } from "../../jobs/detail";
import { defaultOutputName } from "../useMediaJob";

type Mode = "range" | "silences";

interface TrimState {
  start: number;
  end: number;
  /** Re-encode to land on the exact frame asked for, instead of the nearest
   *  preceding keyframe. */
  exact: boolean;
  /** Keep one stretch, or cut every silence out. */
  mode: Mode;
  /** Quieter than this, for at least `minSilence` seconds, is silence. */
  thresholdDb: number;
  minSilence: number;
  /** Handles stick to silence edges and middles while dragged. */
  snap: boolean;
  /** In "silences" mode: the stretches that stay, sent as `keep`. */
  keep: [number, number][] | null;
}

const MIN_SILENCES = [0.3, 0.5, 1, 2] as const;

/**
 * Trim, by looking at the sound.
 *
 * The file is decoded once into a waveform and its loudness, and the silences
 * in it are found and drawn -- hatched, with their lengths on them. Cutting
 * becomes pointing at the quiet part: drag a handle and it snaps to the
 * silence, click a silence and the nearer handle jumps into it, or press one
 * button to shave the silence off both ends.
 *
 * Or keep everything but the silences: a lecture or a podcast with its pauses
 * taken out, in one run.
 *
 * A file with no sound at all gets the plain slider it always had.
 */
function TrimControls({ path, info, state, setState }: MediaToolContext<TrimState>) {
  const { t, i18n } = useTranslation();
  const duration = info?.durationSecs ?? 0;
  const hasAudio = Boolean(info?.audio);
  const { analysis, progress, error, loading } = useAudioAnalysis(path, hasAudio);
  const set = useCallback(
    (patch: Partial<TrimState>) => setState((current) => ({ ...current, ...patch })),
    [setState],
  );

  useEffect(() => {
    if (duration > 0) setState((current) => ({ ...current, start: 0, end: duration }));
  }, [duration, setState]);

  const total = analysis?.durationSecs ?? duration;
  const silences = useMemo(
    () =>
      analysis
        ? detectSilences(analysis.rmsDb, analysis.windowSecs, state.thresholdDb, state.minSilence, analysis.durationSecs)
        : [],
    [analysis, state.thresholdDb, state.minSilence],
  );
  const keep = useMemo(() => (analysis ? keepSegments(silences, total) : null), [analysis, silences, total]);
  const silenceTotal = silences.reduce((sum, s) => sum + (s.endSecs - s.startSecs), 0);

  // The segments the backend will keep, carried in the tool's state so the
  // request can read them.
  useEffect(() => {
    set({ keep: state.mode === "silences" ? keep : null });
  }, [keep, state.mode, set]);

  // ----------------------------------------------------------- the view
  const [view, setView] = useState({ from: 0, to: duration || 1 });
  useEffect(() => setView({ from: 0, to: total || 1 }), [total]);
  const zoom = (factor: number) =>
    setView((current) => {
      const span = Math.min(total, Math.max(Math.min(1.5, total), (current.to - current.from) * factor));
      const centre = (current.from + current.to) / 2;
      const from = Math.min(Math.max(0, centre - span / 2), total - span);
      return { from, to: from + span };
    });

  // -------------------------------------------------------- the preview
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const transcoded = useRef(false);
  useEffect(() => {
    setSrc(null);
    transcoded.current = false;
    if (!path || !hasAudio) return;
    let cancelled = false;
    void ipc
      .previewUrl(path)
      .then((url) => !cancelled && setSrc(url))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path, hasAudio]);

  /** WebKitGTK plays what GStreamer can; anything else goes through a small
   *  MP3 made for the purpose, once. */
  const onAudioError = () => {
    if (!path || transcoded.current) return;
    transcoded.current = true;
    void ipc
      .transcodedPreviewUrl(path)
      .then(setSrc)
      .catch(() => undefined);
  };

  // Stop at the end of the selection when playing it.
  const stopAt = useRef<number | null>(null);
  useEffect(() => {
    if (!audioEl) return;
    const onTime = () => {
      if (stopAt.current !== null && audioEl.currentTime >= stopAt.current) {
        audioEl.pause();
        stopAt.current = null;
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audioEl.addEventListener("timeupdate", onTime);
    audioEl.addEventListener("play", onPlay);
    audioEl.addEventListener("pause", onPause);
    return () => {
      audioEl.removeEventListener("timeupdate", onTime);
      audioEl.removeEventListener("play", onPlay);
      audioEl.removeEventListener("pause", onPause);
    };
  }, [audioEl]);

  const togglePlay = () => {
    if (!audioEl) return;
    if (!audioEl.paused) {
      audioEl.pause();
      return;
    }
    if (state.mode === "range") {
      const inside = audioEl.currentTime >= state.start && audioEl.currentTime < state.end - 0.05;
      if (!inside) audioEl.currentTime = state.start;
      stopAt.current = state.end;
    } else {
      stopAt.current = null;
    }
    void audioEl.play().catch(onAudioError);
  };

  const seek = (seconds: number) => {
    if (audioEl) audioEl.currentTime = seconds;
  };

  const setRange = useCallback(
    (start: number, end: number) => set({ start: Math.max(0, start), end: Math.min(total, end) }),
    [set, total],
  );

  if (duration <= 0) return null;

  // No sound to look at: the plain slider.
  if (!hasAudio || error) {
    return (
      <>
        {error && <p className="text-xs text-warning-text">{t("trim_analysis_failed")}</p>}
        <RangeSlider
          durationSecs={duration}
          start={state.start}
          end={state.end}
          onChange={(start, end) => set({ start, end })}
        />
        <ExactRow state={state} set={set} />
      </>
    );
  }

  const points = snapPoints(silences);
  const resultSecs = state.mode === "silences" && keep ? keep.reduce((sum, [a, b]) => sum + (b - a), 0) : state.end - state.start;
  const removedSilences = silences.length;

  return (
    <div className="flex flex-col gap-4">
      {src && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio ref={setAudioEl} src={src} preload="auto" onError={onAudioError} className="hidden" />
      )}

      {loading || !analysis ? (
        <div className="glass-inset flex flex-col gap-2 rounded-lg border p-4" role="status">
          <span className="flex items-center gap-2 text-sm text-fg-soft">
            <Loader2 size={15} className="shrink-0 animate-spin text-accent" />
            {t("trim_analyzing")}
            <span className="ms-auto text-xs text-fg-muted tnum">{formatPercent(progress, i18n.language)}</span>
          </span>
          <div dir="ltr" className="h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-(image:--gradient-accent) transition-[width] duration-200"
              style={{ width: `${Math.max(3, progress)}%` }}
            />
          </div>
        </div>
      ) : (
        <>
          <AudioStatsCard
            durationSecs={analysis.durationSecs}
            silenceSecs={silenceTotal}
            silenceCount={silences.length}
            peakDb={analysis.peakDb}
            meanDb={analysis.meanRmsDb}
          />

          <Segmented
            label={t("trim_mode")}
            value={state.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: "range" as const, label: t("trim_mode_range"), icon: <Scissors size={16} />, hint: t("trim_mode_range_hint") },
              { value: "silences" as const, label: t("trim_mode_silences"), icon: <WandSparkles size={16} />, hint: t("trim_mode_silences_hint") },
            ]}
          />

          {/* The waveform card: tools along the top, the sound below. */}
          <div className="glass-inset flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <ToolButton onClick={togglePlay} disabled={!src} label={playing ? t("trim_pause") : state.mode === "range" ? t("trim_play_selection") : t("trim_play")} primary>
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </ToolButton>
              <ToolButton onClick={() => zoom(0.5)} label={t("trim_zoom_in")}>
                <ZoomIn size={15} />
              </ToolButton>
              <ToolButton onClick={() => zoom(2)} label={t("trim_zoom_out")} disabled={view.to - view.from >= total - 0.01}>
                <ZoomOut size={15} />
              </ToolButton>
              {state.mode === "range" && (
                <ToolButton onClick={() => set({ snap: !state.snap })} label={t("trim_snap")} pressed={state.snap}>
                  <Magnet size={15} />
                </ToolButton>
              )}
              {state.mode === "range" && silences.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const { start, end } = trimmedEnds(silences, total);
                    set({ start, end });
                  }}
                  className="ms-auto flex h-8 items-center gap-1.5 rounded-md border border-accent-line bg-accent-soft px-3 text-sm font-medium text-accent transition-colors hover:bg-accent-soft/70"
                >
                  <WandSparkles size={14} />
                  {t("trim_cut_silent_ends")}
                </button>
              )}
            </div>

            <WaveformCanvas
              analysis={analysis}
              mode={state.mode}
              start={state.start}
              end={state.end}
              onRangeChange={setRange}
              silences={silences}
              keep={keep}
              thresholdDb={state.thresholdDb}
              snap={state.snap}
              audio={audioEl}
              onSeek={seek}
              view={view}
              onViewChange={setView}
            />
            <p className="text-xs text-fg-muted">
              {state.mode === "range" ? t("trim_waveform_hint") : t("trim_waveform_hint_silences")}
            </p>
          </div>

          {state.mode === "range" ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TimeStepper
                label={t("trim_start")}
                value={state.start}
                onCommit={(start) => setRange(Math.min(start, state.end - 0.05), state.end)}
                onStep={(direction) => {
                  const next = stepTo(points, state.start, direction);
                  if (next !== null && next < state.end - 0.05) setRange(next, state.end);
                }}
              />
              <span className="text-sm text-fg-muted">
                {t("trim_length")}{" "}
                <span dir="ltr" className="font-medium text-fg tnum">
                  {formatPreciseTimecode(resultSecs)}
                </span>
              </span>
              <TimeStepper
                label={t("trim_end")}
                value={state.end}
                onCommit={(end) => setRange(state.start, Math.max(end, state.start + 0.05))}
                onStep={(direction) => {
                  const next = stepTo(points, state.end, direction);
                  if (next !== null && next > state.start + 0.05) setRange(state.start, next);
                }}
              />
            </div>
          ) : (
            <p className="text-sm text-fg-soft">
              {t("trim_silences_summary", {
                silences: formatCount(removedSilences, i18n.language),
                result: formatTimecode(resultSecs),
                saved: formatPercent(total > 0 ? (1 - resultSecs / total) * 100 : 0, i18n.language),
              })}
            </p>
          )}

          {/* How quiet counts as silent, and for how long. */}
          <ControlGroup className="gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between text-xs font-medium text-fg-muted">
                {t("trim_threshold")}
                <span dir="ltr" className="tnum text-fg-soft">
                  {state.thresholdDb} dB
                </span>
              </span>
              <Slider.Root
                dir="ltr"
                min={-60}
                max={-20}
                step={1}
                value={[state.thresholdDb]}
                onValueChange={([value]) => set({ thresholdDb: value })}
                className="relative flex h-6 w-full touch-none items-center select-none"
              >
                <Slider.Track className="relative h-1.5 w-full rounded-full bg-line">
                  <Slider.Range className="absolute h-full rounded-full bg-warning/70" />
                </Slider.Track>
                <Slider.Thumb
                  aria-label={t("trim_threshold")}
                  className="block size-4 rounded-full border-2 border-surface bg-warning shadow-(--shadow-raise) focus-visible:outline-2 focus-visible:outline-accent"
                />
              </Slider.Root>
              {/* Left to right like the slider above it: -60 (strict) on the
                  left, -20 (loose) on the right, in every language. */}
              <span dir="ltr" className="flex justify-between text-xs text-fg-muted">
                <span dir="auto">{t("trim_threshold_strict")}</span>
                <span dir="auto">{t("trim_threshold_loose")}</span>
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">{t("trim_min_silence")}</span>
              <Segmented
                label={t("trim_min_silence")}
                value={String(state.minSilence)}
                onChange={(value) => set({ minSilence: Number(value) })}
                options={MIN_SILENCES.map((secs) => ({
                  value: String(secs),
                  label: t("trim_secs", {
                    secs: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(secs),
                  }),
                }))}
              />
            </div>
          </ControlGroup>

          {state.mode === "range" && <ExactRow state={state} set={set} />}
        </>
      )}
    </div>
  );
}

function ExactRow({ state, set }: { state: TrimState; set: (patch: Partial<TrimState>) => void }) {
  const { t } = useTranslation();
  // One checkbox, off by default. A stream copy is instant and lossless but
  // snaps to the nearest preceding keyframe, so the clip can begin a moment
  // early -- said plainly rather than hidden.
  return (
    <CheckRow
      label={t("trim_exact")}
      hint={state.exact ? t("trim_exact_hint") : t("trim_fast_hint")}
      checked={state.exact}
      onChange={(exact) => set({ exact })}
    />
  );
}

function ToolButton({
  children,
  label,
  onClick,
  disabled,
  pressed,
  primary,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors duration-(--duration-fast)",
        "disabled:cursor-not-allowed disabled:opacity-disabled",
        primary
          ? "border-transparent bg-(image:--gradient-accent) text-on-accent"
          : pressed
            ? "border-accent-line bg-accent-soft text-accent"
            : "border-line bg-surface/65 text-fg-soft hover:enabled:border-line-strong",
      )}
    >
      {children}
      {primary && <span>{label}</span>}
    </button>
  );
}

/** A millisecond time field with steps to the previous / next silence. */
function TimeStepper({
  label,
  value,
  onCommit,
  onStep,
}: {
  label: string;
  value: number;
  onCommit: (seconds: number) => void;
  onStep: (direction: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? formatPreciseTimecode(value);
  const commit = () => {
    const parsed = parseTimecode(text);
    if (parsed !== null) onCommit(parsed);
    setDraft(null);
  };
  return (
    <div dir="ltr" className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onStep(-1)}
        aria-label={t("trim_prev_silence", { which: label })}
        title={t("trim_prev_silence", { which: label })}
        className="flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <ChevronLeft size={16} />
      </button>
      <TextInput
        aria-label={label}
        dir="ltr"
        size="sm"
        className="w-28 text-center tnum"
        data-own-escape=""
        value={text}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
      />
      <button
        type="button"
        onClick={() => onStep(1)}
        aria-label={t("trim_next_silence", { which: label })}
        title={t("trim_next_silence", { which: label })}
        className="flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export const trimTool: MediaToolConfig<TrimState> = {
  kind: "trim",
  command: "start_trim",
  requires: "media",
  wide: true,
  initialState: {
    start: 0,
    end: 0,
    exact: false,
    mode: "range",
    thresholdDb: -35,
    minSilence: 0.5,
    snap: true,
    keep: null,
  },
  Controls: TrimControls,
  isReady: ({ state }) =>
    state.mode === "silences" ? Boolean(state.keep && state.keep.length > 0) : state.end > state.start,
  toRequest: ({ path, info, state }) => {
    const stem = defaultOutputName(path);
    const silences = state.mode === "silences" && state.keep;
    // Mirrors what the backend picks (media/ops.rs): a stream copy keeps the
    // source container; a re-encode of a video lands as MP4 and of a sound file
    // stays in its own format.
    const source = extensionOf(path ?? "") ?? "mp4";
    const reencodes = state.exact || Boolean(silences);
    const ext = reencodes && info?.video ? "mp4" : source;
    const name = silences ? `${stem}-no-silence` : `${stem}-clip`;
    return {
      args: {
        input: path,
        outputName: name,
        startSecs: state.start,
        endSecs: state.end,
        exact: state.exact,
        keep: silences || undefined,
      },
      title: `${name}.${ext}`,
      detail: silences
        ? detailKey("trim_mode_silences")
        : detailKey(state.exact ? "trim_exact" : "trim_fast"),
    };
  },
};
