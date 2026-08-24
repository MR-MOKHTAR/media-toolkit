import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import { ControlGroup } from "../../../components/ui/Card";
import { Checkbox } from "../../../components/ui/CheckRow";
import { Segmented } from "../../../components/ui/Segmented";
import { TextInput } from "../../../components/ui/TextInput";
import { cn } from "../../../lib/cn";
import { formatBytes } from "../../../lib/format";
import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolScreen";
import { defaultOutputName } from "../useMediaJob";

type Preset = "small" | "balanced" | "high";

const PRESETS: Preset[] = ["small", "balanced", "high"];

/** The three sizes anything is ever asked to fit: a screen, an upload limit, a
 *  messaging app. This is the whole of what the resize tool offered, and it
 *  belongs here -- both tools made a video smaller, and which one to reach for
 *  was a question about codecs that nobody should have to answer. */
const HEIGHTS = [1080, 720, 480] as const;

/** The "leave it alone" option, as a value the segmented control can hold
 *  alongside the numbers. Not the empty string: that is a React key. */
const ORIGINAL = "original";

/** Below this the picture is a smear whatever the bitrate maths says, and
 *  ffmpeg clamps there anyway -- so the file lands over the target rather than
 *  under it. Worth saying before the encode, not after. */
const MIN_VIDEO_KBPS = 100;

interface CompressState {
  preset: Preset;
  /** Null keeps the source resolution. */
  height: number | null;
  /** Null is the switch being off. While it is on this is the field's own text,
   *  so a half-typed number is not rewritten under the cursor. */
  target: string | null;
}

/** Audio-only input is fine here. The file picker has always offered audio
 *  extensions, so requiring a video stream meant the app handed the user an
 *  MP3 it then refused to work on. */
const isAudioOnly = (info: MediaToolContext<CompressState>["info"]) =>
  Boolean(info && !info.video && info.audio);

/** Megabytes as typed, or null for anything that is not a positive number. */
const targetMb = (state: CompressState) => {
  if (state.target === null) return null;
  const value = Number(state.target.replace(/[٫,]/g, "."));
  return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * Three controls: how hard to squeeze, how big the picture should be, and --
 * optionally -- a size to land under.
 *
 * The third one is the only place a number is typed in this app. It earns that
 * because "under 25 MB" is not a quality judgement anybody can make from a
 * preset: it is a limit somebody else set, and the encoder can hit it exactly.
 */
function CompressControls({
  path,
  info,
  state,
  setState,
  language,
}: MediaToolContext<CompressState>) {
  const { t } = useTranslation();
  const [estimates, setEstimates] = useState<Partial<Record<Preset, number>>>({});

  const audioOnly = isAudioOnly(info);
  const sourceHeight = info?.video?.height ?? 0;
  const sized = state.target !== null;

  // Upscaling makes a bigger file that looks no better, so a height at or above
  // the source is offered greyed out with the reason rather than hidden -- and
  // a selection that a new file has just made impossible moves off itself.
  useEffect(() => {
    if (state.height !== null && sourceHeight > 0 && state.height >= sourceHeight) {
      setState((current) => ({ ...current, height: null }));
    }
  }, [sourceHeight, state.height, setState]);

  // The whole reason the estimate exists: choosing between Small and Balanced
  // without having to run both. Re-asked when the height changes, because half
  // the size of a compression is its resolution.
  useEffect(() => {
    if (!path || !info || sized) return;
    let cancelled = false;
    const input = path;

    void Promise.all(
      PRESETS.map((value) =>
        invoke<number>("estimate_compressed_size", {
          path: input,
          preset: value,
          maxHeight: state.height,
        })
          .then((bytes) => [value, bytes] as const)
          .catch(() => [value, 0] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setEstimates(Object.fromEntries(pairs.filter(([, bytes]) => bytes > 0)));
    });

    return () => {
      cancelled = true;
    };
  }, [path, info, state.height, sized]);

  if (!info) return null;

  const wanted = targetMb(state);
  // What the encoder would have left for the picture once the audio is paid
  // for. Mirrors the arithmetic in media/ops.rs so the warning and the result
  // agree.
  const videoKbps =
    wanted && info.durationSecs > 0 && !audioOnly
      ? (wanted * 8 * 1024 * 0.97) / info.durationSecs - 128
      : null;

  return (
    <ControlGroup>
      <Segmented
        label={t("compress_quality")}
        value={state.preset}
        onChange={(preset) => setState((current) => ({ ...current, preset }))}
        options={PRESETS.map((value) => ({
          value,
          label: t(`compress_${value}`),
          // Silent while a target size is set: the output size is the number
          // in the field then, not a consequence of the preset.
          hint:
            !sized && estimates[value]
              ? `≈ ${formatBytes(estimates[value], language)}`
              : undefined,
        }))}
      />

      {!audioOnly && (
        <Segmented
          label={t("compress_resolution")}
          value={String(state.height ?? ORIGINAL)}
          onChange={(value) =>
            setState((current) => ({
              ...current,
              height: value === ORIGINAL ? null : Number(value),
            }))
          }
          options={[
            { value: ORIGINAL, label: t("compress_original") },
            ...HEIGHTS.map((value) => ({
              value: String(value),
              label: `${value}p`,
              disabled: sourceHeight > 0 && value >= sourceHeight,
              disabledReason: t("already_smaller"),
            })),
          ]}
        />
      )}

      <label className="flex cursor-pointer items-center gap-2.5">
        <Checkbox
          checked={sized}
          onChange={(next) =>
            setState((current) => ({
              ...current,
              target: next ? "25" : null,
            }))
          }
        />
        <span className="text-sm text-fg">{t("compress_target_size")}</span>
        {sized && (
          <TextInput
            dir="ltr"
            inputMode="decimal"
            value={state.target ?? ""}
            onChange={(event) =>
              setState((current) => ({ ...current, target: event.target.value }))
            }
            onClick={(event) => event.stopPropagation()}
            aria-label={t("compress_target_size")}
            size="sm"
            className="w-24 text-center tnum"
          />
        )}
      </label>

      {sized ? (
        <p
          className={cn(
            "text-xs",
            videoKbps !== null && videoKbps < MIN_VIDEO_KBPS
              ? "text-warning"
              : "text-fg-muted",
          )}
        >
          {videoKbps !== null && videoKbps < MIN_VIDEO_KBPS
            ? t("compress_target_too_low")
            : t("compress_target_hint")}
        </p>
      ) : (
        <p className="text-xs text-fg-muted">
          {t("compress_was", { size: formatBytes(info.sizeBytes, language) })}
        </p>
      )}

      {audioOnly && (
        <p className="text-xs text-fg-muted">{t("compress_audio_note")}</p>
      )}
    </ControlGroup>
  );
}

export const compressTool: MediaToolConfig<CompressState> = {
  kind: "compress",
  command: "start_compress",
  requires: "media",
  initialState: { preset: "balanced", height: null, target: null },
  Controls: CompressControls,
  // A target that is not a number, or one that is bigger than the file already
  // is, would run an encode to produce something larger than the input.
  isReady: ({ info, state }) => {
    if (state.target === null) return true;
    const wanted = targetMb(state);
    return wanted !== null && wanted * 1024 * 1024 < (info?.sizeBytes ?? 0);
  },
  toRequest: ({ path, info, state, t }) => {
    const stem = defaultOutputName(path);
    const audioOnly = isAudioOnly(info);
    const height = audioOnly ? null : state.height;
    // The height is the more useful half of the name when one was asked for:
    // "clip-720p" says what came out, "clip-compressed" only says what was run.
    const name = height ? `${stem}-${height}p` : `${stem}-compressed`;
    const wanted = targetMb(state);

    return {
      args: {
        input: path,
        outputName: name,
        preset: state.preset,
        maxHeight: height,
        targetSizeMb: wanted,
      },
      title: `${name}.${audioOnly ? "m4a" : "mp4"}`,
      detail: wanted
        ? `${wanted} MB`
        : height
          ? `${t(`compress_${state.preset}`)} · ${height}p`
          : t(`compress_${state.preset}`),
    };
  },
};
