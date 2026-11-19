import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRightLeft, Captions, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ControlGroup } from "../../../components/ui/Card";
import { Segmented } from "../../../components/ui/Segmented";
import { formatCount } from "../../../lib/format";
import {
  AUTO_AUDIO,
  AudioOptions,
  Labeled,
  audioRequest,
  type AudioOptionsValue,
} from "../components/AudioOptions";
import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolForm";
import { RangeSlider } from "../components/RangeSlider";
import { FormatGroup } from "../components/ToolFormParts";
import { detailKey } from "../../jobs/detail";
import { defaultOutputName } from "../useMediaJob";

const VIDEO_FORMATS = ["mp4", "mkv", "mov", "webm", "avi"];
const AUDIO_FORMATS = ["mp3", "m4a", "opus", "ogg", "flac", "wav", "aiff"];
const ANIMATION_FORMATS = ["gif", "webp"];
const LOSSLESS = ["flac", "wav", "aiff"];

const QUALITIES = ["same", "high", "balanced", "small"] as const;
type Quality = (typeof QUALITIES)[number];

const HEIGHTS = [1080, 720, 480] as const;
const GIF_WIDTHS = [320, 480, 640, 800] as const;
const GIF_FPS = [10, 12, 15, 24] as const;
const ORIGINAL = "original";

interface ConvertState {
  format: string;
  quality: Quality;
  maxHeight: number | null;
  audio: AudioOptionsValue;
  /** gif/webp */
  width: number;
  fps: number;
  /** A range, for animations -- a GIF of a whole film is not a GIF. Null is
   *  the whole file. */
  range: { start: number; end: number } | null;
}

/** Mirrors `ops::ConvertPreview`. */
interface ConvertPreview {
  video: "copy" | "encode" | "none";
  audio: "copy" | "encode" | "none";
  droppedSubtitles: number;
}

type Kind = "video" | "audio" | "animation";
const kindOf = (format: string): Kind =>
  VIDEO_FORMATS.includes(format) ? "video" : ANIMATION_FORMATS.includes(format) ? "animation" : "audio";

/** An animation of more than this many seconds is offered the first stretch,
 *  not the whole file: a GIF of a ten-minute video is hundreds of megabytes. */
const ANIMATION_DEFAULT_SECS = 8;

/**
 * Any file to any of fourteen formats, with only the questions the target
 * raises: a quality and a size for video, the sound for audio, width, frame
 * rate and a stretch for an animation.
 *
 * And always one line saying what will happen -- "instant, nothing
 * re-encoded", "only the sound is re-encoded" -- because the difference
 * between a second and ten minutes is the thing people want to know before
 * they press Run.
 */
function ConvertControls({ path, info, state, setState }: MediaToolContext<ConvertState>) {
  const { t, i18n } = useTranslation();
  const [preview, setPreview] = useState<ConvertPreview | null>(null);
  const set = (patch: Partial<ConvertState>) => setState((current) => ({ ...current, ...patch }));
  const kind = kindOf(state.format);

  // What this conversion will copy and what it will re-encode, asked of the
  // backend that decides it -- per stream, so "only the audio" is a real answer.
  const audioKey = JSON.stringify(state.audio);
  useEffect(() => {
    if (!path || !info) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void invoke<ConvertPreview>("convert_preview", {
      path,
      format: state.format,
      audio: kind === "audio" ? audioRequest(state.audio) : undefined,
      maxHeight: kind === "video" ? state.maxHeight : undefined,
      fps: kind === "animation" ? state.fps : undefined,
    })
      .then((value) => !cancelled && setPreview(value))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, info, state.format, state.maxHeight, state.fps, audioKey, kind]);

  // A file with no picture cannot become a video or an animation: moved to
  // the first audio format rather than left selected with Run enabled.
  const noVideo = Boolean(info && !info.video);
  useEffect(() => {
    if (noVideo && kind !== "audio") set({ format: AUDIO_FORMATS[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noVideo, kind]);

  // An animation starts on its first few seconds.
  useEffect(() => {
    if (kind === "animation" && info && state.range === null) {
      set({ range: { start: 0, end: Math.min(info.durationSecs, ANIMATION_DEFAULT_SECS) } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, info]);

  if (!info) return null;

  const sourceHeight = info.video ? Math.min(info.video.height, info.video.width || info.video.height) : 0;

  return (
    <div className="flex flex-col gap-4">
      <FormatGroup
        title={t("format_video")}
        formats={VIDEO_FORMATS}
        value={state.format}
        onChange={(format) => set({ format })}
        disabled={!info.video}
        disabledHint={t("no_video_track")}
      />
      <FormatGroup
        title={t("format_audio")}
        formats={AUDIO_FORMATS}
        value={state.format}
        onChange={(format) => set({ format })}
      />
      <FormatGroup
        title={t("format_animation")}
        formats={ANIMATION_FORMATS}
        value={state.format}
        onChange={(format) => set({ format })}
        disabled={!info.video}
        disabledHint={t("no_video_track")}
      />

      {kind === "video" && preview?.video === "encode" && (
        <ControlGroup className="gap-3">
          <Labeled label={t("convert_quality")}>
            <Segmented
              label={t("convert_quality")}
              value={state.quality}
              onChange={(quality) => set({ quality })}
              options={QUALITIES.map((quality) => ({
                value: quality,
                label: t(`convert_quality_${quality}`),
              }))}
            />
          </Labeled>
          <Labeled label={t("compress_resolution")}>
            <Segmented
              label={t("compress_resolution")}
              value={String(state.maxHeight ?? ORIGINAL)}
              onChange={(value) => set({ maxHeight: value === ORIGINAL ? null : Number(value) })}
              options={[
                { value: ORIGINAL, label: t("compress_original") },
                ...HEIGHTS.map((height) => ({
                  value: String(height),
                  label: `${height}p`,
                  disabled: sourceHeight > 0 && height >= sourceHeight,
                  disabledReason: t("already_smaller"),
                })),
              ]}
            />
          </Labeled>
        </ControlGroup>
      )}

      {kind === "audio" && !LOSSLESS.includes(state.format) && info.audio && (
        <AudioOptions
          value={state.audio}
          onChange={(audio) => set({ audio })}
          source={info.audio}
          presets={false}
        />
      )}

      {kind === "animation" && (
        <ControlGroup className="gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label={t("animation_width")}>
              <Segmented
                label={t("animation_width")}
                value={String(state.width)}
                onChange={(value) => set({ width: Number(value) })}
                options={GIF_WIDTHS.map((width) => ({
                  value: String(width),
                  label: `${width}px`,
                  disabled: Boolean(info.video && width > info.video.width),
                  disabledReason: t("already_smaller"),
                }))}
              />
            </Labeled>
            <Labeled label={t("animation_fps")}>
              <Segmented
                label={t("animation_fps")}
                value={String(state.fps)}
                onChange={(value) => set({ fps: Number(value) })}
                options={GIF_FPS.map((fps) => ({ value: String(fps), label: `${fps}` }))}
              />
            </Labeled>
          </div>
          {state.range && info.durationSecs > 0 && (
            <RangeSlider
              durationSecs={info.durationSecs}
              start={state.range.start}
              end={state.range.end}
              onChange={(start, end) => set({ range: { start, end } })}
            />
          )}
          <p className="text-xs text-fg-muted">{t("animation_hint")}</p>
        </ControlGroup>
      )}

      {preview && <WhatHappens preview={preview} kind={kind} count={(n) => formatCount(n, i18n.language)} />}
    </div>
  );
}

/** One line on what the run will do, from `convert_preview`. */
function WhatHappens({
  preview,
  kind,
  count,
}: {
  preview: ConvertPreview;
  kind: Kind;
  count: (n: number) => string;
}) {
  const { t } = useTranslation();
  const instant = preview.video !== "encode" && preview.audio !== "encode";
  const message =
    kind === "animation"
      ? t("convert_will_animation")
      : instant
        ? t("instant_copy")
        : preview.video === "encode" && preview.audio === "encode"
          ? t("convert_will_both")
          : preview.video === "encode"
            ? preview.audio === "copy"
              ? t("convert_will_video_only")
              : t("convert_will_both")
            : t("convert_will_audio_only");

  return (
    <div className="flex flex-col gap-1">
      <p
        className={
          instant && kind !== "animation"
            ? "flex items-center gap-1.5 text-sm font-medium text-success-text"
            : "flex items-center gap-1.5 text-sm text-fg-soft"
        }
      >
        {instant && kind !== "animation" ? (
          <Zap size={14} className="shrink-0" />
        ) : (
          <ArrowRightLeft size={14} className="shrink-0" />
        )}
        {message}
      </p>
      {preview.droppedSubtitles > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-warning-text">
          <Captions size={12} className="shrink-0" />
          {t("convert_drops_subtitles", { subs: count(preview.droppedSubtitles) })}
        </p>
      )}
    </div>
  );
}

export const convertTool: MediaToolConfig<ConvertState> = {
  kind: "convert",
  command: "start_convert",
  requires: "media",
  initialState: {
    format: "mp4",
    quality: "high",
    maxHeight: null,
    audio: AUTO_AUDIO,
    width: 480,
    fps: 12,
    range: null,
  },
  Controls: ConvertControls,
  isReady: ({ state }) => kindOf(state.format) !== "animation" || state.range === null || state.range.end > state.range.start,
  toRequest: ({ path, state }) => {
    const stem = defaultOutputName(path);
    const kind = kindOf(state.format);
    const range = kind === "animation" ? state.range : null;
    return {
      args: {
        input: path,
        outputName: stem,
        format: state.format,
        audio: kind === "audio" ? audioRequest(state.audio) : undefined,
        quality: kind === "video" ? state.quality : undefined,
        maxHeight: kind === "video" ? state.maxHeight : undefined,
        width: kind === "animation" ? state.width : undefined,
        fps: kind === "animation" ? state.fps : undefined,
        startSecs: range?.start,
        endSecs: range?.end,
      },
      title: `${stem}.${state.format}`,
      detail:
        kind === "audio" && state.audio.bitrateKbps
          ? `${state.format.toUpperCase()} · ${state.audio.bitrateKbps}k`
          : kind === "video" && state.quality !== "high"
            ? `${state.format.toUpperCase()} · ${detailKey(`convert_quality_${state.quality}`)}`
            : state.format.toUpperCase(),
    };
  },
};
