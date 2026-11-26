import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRightLeft, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolForm";
import { RangeSlider } from "../components/RangeSlider";
import { FormatGroup } from "../components/ToolFormParts";
import { defaultOutputName } from "../useMediaJob";

const VIDEO_FORMATS = ["mp4", "mkv", "mov", "webm"];
const AUDIO_FORMATS = ["mp3", "m4a", "flac", "wav"];
const ANIMATION_FORMATS = ["gif"];

interface ConvertState {
  format: string;
  range: { start: number; end: number } | null;
}

interface ConvertPreview {
  video: "copy" | "encode" | "none";
  audio: "copy" | "encode" | "none";
  droppedSubtitles: number;
}

type Kind = "video" | "audio" | "animation";
const kindOf = (format: string): Kind =>
  VIDEO_FORMATS.includes(format)
    ? "video"
    : ANIMATION_FORMATS.includes(format)
      ? "animation"
      : "audio";

const ANIMATION_DEFAULT_SECS = 8;

function ConvertControls({ path, info, state, setState }: MediaToolContext<ConvertState>) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<ConvertPreview | null>(null);
  const set = (patch: Partial<ConvertState>) => setState((current) => ({ ...current, ...patch }));
  const kind = kindOf(state.format);

  useEffect(() => {
    if (!path || !info) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void invoke<ConvertPreview>("convert_preview", {
      path,
      format: state.format,
      audio: undefined,
      maxHeight: undefined,
      fps: kind === "animation" ? 12 : undefined,
    })
      .then((value) => !cancelled && setPreview(value))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [path, info, state.format, kind]);

  const noVideo = Boolean(info && !info.video);
  useEffect(() => {
    if (noVideo && kind !== "audio") set({ format: AUDIO_FORMATS[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noVideo, kind]);

  useEffect(() => {
    if (kind === "animation" && info && state.range === null) {
      set({ range: { start: 0, end: Math.min(info.durationSecs, ANIMATION_DEFAULT_SECS) } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, info]);

  if (!info) return null;

  return (
    <div className="flex flex-col gap-3.5">
      {info.video && (
        <FormatGroup
          title={t("format_video")}
          formats={VIDEO_FORMATS}
          value={state.format}
          onChange={(format) => set({ format })}
        />
      )}

      <FormatGroup
        title={t("format_audio")}
        formats={AUDIO_FORMATS}
        value={state.format}
        onChange={(format) => set({ format })}
      />

      {info.video && (
        <FormatGroup
          title={t("format_animation")}
          formats={ANIMATION_FORMATS}
          value={state.format}
          onChange={(format) => set({ format })}
        />
      )}

      {kind === "animation" && state.range && info.durationSecs > 0 && (
        <RangeSlider
          durationSecs={info.durationSecs}
          start={state.range.start}
          end={state.range.end}
          onChange={(start, end) => set({ range: { start, end } })}
        />
      )}

      {preview && <WhatHappens preview={preview} kind={kind} />}
    </div>
  );
}

function WhatHappens({
  preview,
  kind,
}: {
  preview: ConvertPreview;
  kind: Kind;
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
    <p
      className={
        instant && kind !== "animation"
          ? "flex items-center gap-1.5 text-xs font-medium text-success-text"
          : "flex items-center gap-1.5 text-xs text-fg-muted"
      }
    >
      {instant && kind !== "animation" ? (
        <Zap size={13} className="shrink-0" />
      ) : (
        <ArrowRightLeft size={13} className="shrink-0" />
      )}
      {message}
    </p>
  );
}

export const convertTool: MediaToolConfig<ConvertState> = {
  kind: "convert",
  command: "start_convert",
  requires: "media",
  initialState: {
    format: "mp4",
    range: null,
  },
  Controls: ConvertControls,
  isReady: ({ state }) =>
    kindOf(state.format) !== "animation" || state.range === null || state.range.end > state.range.start,
  toRequest: ({ path, state }) => {
    const stem = defaultOutputName(path);
    const kind = kindOf(state.format);
    const range = kind === "animation" ? state.range : null;
    return {
      args: {
        input: path,
        outputName: stem,
        format: state.format,
        audio: undefined,
        quality: kind === "video" ? "high" : undefined,
        maxHeight: undefined,
        width: kind === "animation" ? 480 : undefined,
        fps: kind === "animation" ? 12 : undefined,
        startSecs: range?.start,
        endSecs: range?.end,
      },
      title: `${stem}.${state.format}`,
      detail: state.format.toUpperCase(),
    };
  },
};
