import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Pause,
  Play,
  Scissors,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { CheckRow } from "../../../components/ui/CheckRow";
import { Disclosure } from "../../../components/ui/Disclosure";
import { Segmented } from "../../../components/ui/Segmented";
import { TextInput } from "../../../components/ui/TextInput";
import { cn } from "../../../lib/cn";
import {
  formatCount,
  formatPercent,
  formatPreciseTimecode,
  formatTimecode,
  parseTimecode,
} from "../../../lib/format";
import * as ipc from "../../../lib/ipc";
import { extensionOf } from "../../../lib/mediaKind";
import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolForm";
import { RangeSlider } from "../components/RangeSlider";
import { detectSilences, keepSegments, trimmedEnds } from "../trim/silence";
import { useAudioAnalysis } from "../trim/useAudioAnalysis";
import { WaveformCanvas } from "../trim/WaveformCanvas";
import { detailKey } from "../../jobs/detail";
import { defaultOutputName } from "../useMediaJob";

type Mode = "range" | "silences";
type Sensitivity = "strict" | "balanced" | "loose";

const SENSITIVITY_PARAMS: Record<Sensitivity, { thresholdDb: number; minSilence: number }> = {
  strict: { thresholdDb: -42, minSilence: 0.8 },
  balanced: { thresholdDb: -35, minSilence: 0.5 },
  loose: { thresholdDb: -28, minSilence: 0.35 },
};

interface TrimState {
  start: number;
  end: number;
  exact: boolean;
  mode: Mode;
  sensitivity: Sensitivity;
  keep: [number, number][] | null;
  advancedOpen: boolean;
}

function TrimControls({ path, info, state, setState, folderRow }: MediaToolContext<TrimState>) {
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
  const { thresholdDb, minSilence } = SENSITIVITY_PARAMS[state.sensitivity];

  const silences = useMemo(
    () =>
      analysis
        ? detectSilences(analysis.rmsDb, analysis.windowSecs, thresholdDb, minSilence, analysis.durationSecs)
        : [],
    [analysis, thresholdDb, minSilence],
  );
  const keep = useMemo(() => (analysis ? keepSegments(silences, total) : null), [analysis, silences, total]);

  useEffect(() => {
    set({ keep: state.mode === "silences" ? keep : null });
  }, [keep, state.mode, set]);

  const [view, setView] = useState({ from: 0, to: duration || 1 });
  useEffect(() => setView({ from: 0, to: total || 1 }), [total]);
  const zoom = (factor: number) =>
    setView((current) => {
      const span = Math.min(total, Math.max(Math.min(1.5, total), (current.to - current.from) * factor));
      const centre = (current.from + current.to) / 2;
      const from = Math.min(Math.max(0, centre - span / 2), total - span);
      return { from, to: from + span };
    });

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

  const onAudioError = () => {
    if (!path || transcoded.current) return;
    transcoded.current = true;
    void ipc
      .transcodedPreviewUrl(path)
      .then(setSrc)
      .catch(() => undefined);
  };

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

  const moreDisclosure = (
    <Disclosure
      label={t("more_options")}
      summary={state.mode === "range" && state.exact ? t("trim_exact") : undefined}
      open={state.advancedOpen}
      onOpenChange={(advancedOpen) => set({ advancedOpen })}
    >
      {folderRow}
      {state.mode === "range" && (
        <CheckRow
          label={t("trim_exact")}
          hint={state.exact ? t("trim_exact_hint") : t("trim_fast_hint")}
          checked={state.exact}
          onChange={(exact) => set({ exact })}
        />
      )}
    </Disclosure>
  );

  if (!hasAudio || error) {
    return (
      <div className="flex flex-col gap-3.5">
        {error && <p className="text-xs text-warning-text">{t("trim_analysis_failed")}</p>}
        <RangeSlider
          durationSecs={duration}
          start={state.start}
          end={state.end}
          onChange={(start, end) => set({ start, end })}
        />
        {moreDisclosure}
      </div>
    );
  }

  const resultSecs =
    state.mode === "silences" && keep
      ? keep.reduce((sum, [a, b]) => sum + (b - a), 0)
      : state.end - state.start;
  const removedSilences = silences.length;

  return (
    <div className="flex flex-col gap-3.5">
      {src && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio ref={setAudioEl} src={src} preload="auto" onError={onAudioError} className="hidden" />
      )}

      {loading || !analysis ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-soft p-3.5" role="status">
          <span className="flex items-center gap-2 text-sm text-fg-soft">
            <Loader2 size={15} className="shrink-0 animate-spin text-accent" />
            {t("trim_analyzing")}
            <span className="ms-auto text-xs text-fg-muted tnum">
              {formatPercent(progress, i18n.language)}
            </span>
          </span>
          <div dir="ltr" className="h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.max(3, progress)}%` }}
            />
          </div>
        </div>
      ) : (
        <>
          <Segmented
            label={t("trim_mode")}
            value={state.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: "range" as const, label: t("trim_mode_range"), icon: <Scissors size={15} /> },
              { value: "silences" as const, label: t("trim_mode_silences"), icon: <WandSparkles size={15} /> },
            ]}
          />

          <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface-soft p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <ToolButton
                onClick={togglePlay}
                disabled={!src}
                label={playing ? t("trim_pause") : state.mode === "range" ? t("trim_play_selection") : t("trim_play")}
                primary
              >
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </ToolButton>
              <ToolButton onClick={() => zoom(0.5)} label={t("trim_zoom_in")}>
                <ZoomIn size={14} />
              </ToolButton>
              <ToolButton
                onClick={() => zoom(2)}
                label={t("trim_zoom_out")}
                disabled={view.to - view.from >= total - 0.01}
              >
                <ZoomOut size={14} />
              </ToolButton>
              {state.mode === "range" && silences.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const { start, end } = trimmedEnds(silences, total);
                    set({ start, end });
                  }}
                  className="ms-auto flex h-8 items-center gap-1.5 rounded-md border border-accent-line bg-accent-soft px-2.5 text-xs font-medium text-accent transition-colors hover:opacity-90"
                >
                  <WandSparkles size={13} />
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
              thresholdDb={thresholdDb}
              snap
              audio={audioEl}
              onSeek={seek}
              view={view}
              onViewChange={setView}
            />
          </div>

          {state.mode === "range" ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TimeField
                label={t("trim_start")}
                value={state.start}
                onCommit={(start) => setRange(Math.min(start, state.end - 0.05), state.end)}
              />
              <span className="text-sm text-fg-muted">
                {t("trim_length")}{" "}
                <span dir="ltr" className="font-medium text-fg tnum">
                  {formatPreciseTimecode(resultSecs)}
                </span>
              </span>
              <TimeField
                label={t("trim_end")}
                value={state.end}
                onCommit={(end) => setRange(state.start, Math.max(end, state.start + 0.05))}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <Segmented
                label={t("trim_threshold")}
                value={state.sensitivity}
                onChange={(sensitivity) => set({ sensitivity })}
                options={[
                  { value: "strict" as const, label: t("trim_threshold_strict") },
                  { value: "balanced" as const, label: t("compress_balanced") },
                  { value: "loose" as const, label: t("trim_threshold_loose") },
                ]}
              />
              <p className="text-xs text-fg-muted">
                {t("trim_silences_summary", {
                  silences: formatCount(removedSilences, i18n.language),
                  result: formatTimecode(resultSecs),
                  saved: formatPercent(total > 0 ? (1 - resultSecs / total) * 100 : 0, i18n.language),
                })}
              </p>
            </div>
          )}

          {moreDisclosure}
        </>
      )}
    </div>
  );
}

function ToolButton({
  children,
  label,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-(--duration-fast)",
        "disabled:cursor-not-allowed disabled:opacity-disabled",
        primary
          ? "border-transparent bg-accent text-on-accent hover:enabled:bg-accent-hover"
          : "border-line bg-surface text-fg-soft hover:enabled:border-line-strong hover:enabled:bg-surface-hover",
      )}
    >
      {children}
      {primary && <span>{label}</span>}
    </button>
  );
}

function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? formatPreciseTimecode(value);
  const commit = () => {
    const parsed = parseTimecode(text);
    if (parsed !== null) onCommit(parsed);
    setDraft(null);
  };
  return (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      <span>{label}</span>
      <TextInput
        aria-label={label}
        dir="ltr"
        size="sm"
        className="w-24 text-center tnum"
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
    </label>
  );
}

export const trimTool: MediaToolConfig<TrimState> = {
  kind: "trim",
  command: "start_trim",
  requires: "media",
  wide: true,
  handlesFolderRow: true,
  initialState: {
    start: 0,
    end: 0,
    exact: false,
    mode: "range",
    sensitivity: "balanced",
    keep: null,
    advancedOpen: false,
  },
  Controls: TrimControls,
  isReady: ({ state }) =>
    state.mode === "silences" ? Boolean(state.keep && state.keep.length > 0) : state.end > state.start,
  toRequest: ({ path, info, state }) => {
    const stem = defaultOutputName(path);
    const silences = state.mode === "silences" && state.keep;
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
