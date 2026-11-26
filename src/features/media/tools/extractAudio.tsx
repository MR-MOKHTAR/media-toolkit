import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import { ControlGroup, SectionLabel } from "../../../components/ui/Card";
import { Segmented } from "../../../components/ui/Segmented";
import { formatBytes } from "../../../lib/format";
import {
  AUTO_AUDIO,
  effectiveKbps,
} from "../components/AudioOptions";
import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolForm";
import { InstantBadge } from "../components/ToolFormParts";
import { defaultOutputName } from "../useMediaJob";

const ORIGINAL = "original";
const FORMATS = ["mp3", "m4a", "wav"] as const;
const KBPS: Record<string, number> = { mp3: 190, m4a: 160 };

interface ExtractAudioState {
  format: string;
  copyExt?: string | null;
  track: number;
}

function estimateBytes(
  state: ExtractAudioState,
  info: NonNullable<MediaToolContext<ExtractAudioState>["info"]>,
) {
  const seconds = info.durationSecs;
  const source = info.audioStreams?.[state.track] ?? info.audio;
  if (state.format === "wav") {
    const rate = source?.sampleRate ?? 44_100;
    const channels = source?.channels || 2;
    return seconds * rate * channels * 2;
  }
  const kbps = effectiveKbps(AUTO_AUDIO, KBPS[state.format] ?? 160, source);
  return (kbps * 1000 * seconds) / 8;
}

function ExtractAudioControls({
  path,
  info,
  state,
  setState,
  language,
}: MediaToolContext<ExtractAudioState>) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (!path || !info) return;
    let cancelled = false;
    setAsked(false);
    setState((current) => ({ ...current, copyExt: undefined }));

    void invoke<string | null>("audio_copy_format", { path })
      .then((ext) => {
        if (cancelled) return;
        setAsked(true);
        setState((current) => ({
          ...current,
          copyExt: ext,
          format:
            ext === null && current.format === ORIGINAL ? "m4a" : current.format,
        }));
      })
      .catch(() => {
        if (!cancelled) setAsked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [path, info, setState]);

  if (!info) return null;

  const copyable = state.copyExt ?? null;
  const isCopy = state.format === ORIGINAL && copyable !== null;

  return (
    <ControlGroup className="gap-3">
      <div className="flex flex-col gap-1.5">
        <SectionLabel>{t("extract_audio_format")}</SectionLabel>
        <Segmented
          label={t("extract_audio_format")}
          value={state.format}
          onChange={(format) => setState((current) => ({ ...current, format }))}
          options={[
            {
              value: ORIGINAL,
              label: t("extract_audio_original"),
              hint: copyable ? `.${copyable}` : undefined,
              disabled: asked && copyable === null,
              disabledReason: t("extract_audio_no_copy"),
            },
            ...FORMATS.map((format) => ({
              value: format as string,
              label: format.toUpperCase(),
            })),
          ]}
        />
      </div>

      {(info.audioStreams?.length ?? 0) > 1 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>{t("audio_track")}</SectionLabel>
          <Segmented
            label={t("audio_track")}
            value={String(state.track)}
            onChange={(value) => setState((current) => ({ ...current, track: Number(value) }))}
            options={info.audioStreams!.map((stream, index) => ({
              value: String(index),
              label: stream.title || stream.language?.toUpperCase() || t("audio_track_n", { n: index + 1 }),
            }))}
          />
        </div>
      )}

      {isCopy ? (
        <div>
          <InstantBadge text={t("instant_copy")} />
        </div>
      ) : (
        info.durationSecs > 0 && (
          <p className="text-xs text-fg-muted tnum">
            ≈ {formatBytes(estimateBytes(state, info), language)}
          </p>
        )
      )}
    </ControlGroup>
  );
}

export const extractAudioTool: MediaToolConfig<ExtractAudioState> = {
  kind: "extractAudio",
  command: "start_extract_audio",
  requires: "audio",
  initialState: { format: ORIGINAL, track: 0 },
  Controls: ExtractAudioControls,
  toRequest: ({ path, state }) => {
    const stem = defaultOutputName(path);
    const ext =
      state.format === ORIGINAL ? (state.copyExt ?? "m4a") : state.format;
    return {
      args: {
        input: path,
        outputName: stem,
        format: state.format,
        audio: undefined,
        streamIndex: state.track,
      },
      title: `${stem}.${ext}`,
      detail: ext.toUpperCase(),
    };
  },
};
