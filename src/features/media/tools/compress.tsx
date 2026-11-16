import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import { ControlGroup } from "../../../components/ui/Card";
import { Checkbox, CheckRow } from "../../../components/ui/CheckRow";
import { Disclosure } from "../../../components/ui/Disclosure";
import { Segmented } from "../../../components/ui/Segmented";
import { TextInput } from "../../../components/ui/TextInput";
import { cn } from "../../../lib/cn";
import { formatBytes } from "../../../lib/format";
import {
  AUTO_AUDIO,
  AudioOptions,
  Labeled,
  audioRequest,
  effectiveKbps,
  type AudioOptionsValue,
} from "../components/AudioOptions";
import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolForm";
import { detailKey } from "../../jobs/detail";
import { defaultOutputName } from "../useMediaJob";

type Preset = "small" | "balanced" | "high";
type VideoCodec = "h264" | "h265" | "av1";

const PRESETS: Preset[] = ["small", "balanced", "high"];
const VIDEO_CODECS: VideoCodec[] = ["h264", "h265", "av1"];

/** The sizes anything is asked to fit: a 4K source brought to 1440p, a screen,
 *  an upload limit, a messaging app, a phone on a slow line. */
const HEIGHTS = [1440, 1080, 720, 480, 360] as const;

/** Frame-rate caps. A 60 fps screen recording at 30 is close to half the bits. */
const FPS_CAPS = [60, 30, 24] as const;

/** The "leave it alone" option, as a value the segmented control can hold
 *  alongside the numbers. Not the empty string: that is a React key. */
const ORIGINAL = "original";

/** The audio bitrate each preset spends when none was chosen -- mirrors
 *  `CompressPreset::audio_kbps` in ops.rs. */
const PRESET_AUDIO_KBPS: Record<Preset, number> = { small: 96, balanced: 128, high: 192 };

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
  videoCodec: VideoCodec;
  /** Null keeps the source frame rate. */
  maxFps: number | null;
  dropAudio: boolean;
  audio: AudioOptionsValue;
  advancedOpen: boolean;
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

/** The extension an audio-only result gets, by codec -- mirrors ops.rs. */
const audioExt = (state: CompressState) =>
  state.audio.codec === "opus" ? "opus" : state.audio.codec === "mp3" ? "mp3" : "m4a";

/**
 * Quality, resolution and an optional size to land under -- and, a click
 * further, everything that changes how the bits are spent: the video codec,
 * the frame rate, the sound.
 *
 * For a sound file the sound *is* the control: four presets (voice, podcast,
 * music, high) and the bitrate itself, from 32k up, never above the source.
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
  const set = (patch: Partial<CompressState>) => setState((current) => ({ ...current, ...patch }));

  const audioOnly = isAudioOnly(info);
  const sourceHeight = info?.video ? Math.min(info.video.height, info.video.width || info.video.height) : 0;
  const sourceFps = info?.video?.fps ?? 0;
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
  // without having to run both. Re-asked whenever anything that changes the
  // size changes.
  const audioKey = JSON.stringify(state.audio);
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
          audio: audioRequest(state.audio),
          videoCodec: state.videoCodec,
          maxFps: state.maxFps,
          dropAudio: state.dropAudio,
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
    // `audioKey` stands for `state.audio`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, info, state.height, state.videoCodec, state.maxFps, state.dropAudio, audioKey, sized]);

  if (!info) return null;

  const wanted = targetMb(state);
  // What the encoder has left for the picture once the sound is paid for --
  // at the bitrate the sound will actually get, which is what ops.rs spends.
  const audioKbps = state.dropAudio
    ? 0
    : effectiveKbps(state.audio, PRESET_AUDIO_KBPS[state.preset], info.audio);
  const videoKbps =
    wanted && info.durationSecs > 0 && !audioOnly
      ? (wanted * 8 * 1024 * 0.97) / info.durationSecs - audioKbps
      : null;

  const targetRow = (
    <>
      <label className="flex cursor-pointer items-center gap-2.5">
        <Checkbox
          checked={sized}
          onChange={(next) => set({ target: next ? "25" : null })}
        />
        <span className="text-sm text-fg">{t("compress_target_size")}</span>
        {sized && (
          <TextInput
            dir="ltr"
            inputMode="decimal"
            value={state.target ?? ""}
            onChange={(event) => set({ target: event.target.value })}
            onClick={(event) => event.stopPropagation()}
            aria-label={t("compress_target_size")}
            size="sm"
            className="w-24 text-center tnum"
          />
        )}
      </label>

      {sized && (wanted === null || wanted * 1024 * 1024 >= info.sizeBytes) ? (
        // Why the Run button is off. It used to go grey with nothing on the
        // form saying which of the numbers was the problem.
        <p className="text-xs text-danger-text">
          {t("compress_target_invalid", { size: formatBytes(info.sizeBytes, language) })}
        </p>
      ) : sized ? (
        <p
          className={cn(
            "text-xs",
            videoKbps !== null && videoKbps < MIN_VIDEO_KBPS
              ? "text-warning-text"
              : "text-fg-muted",
          )}
        >
          {videoKbps !== null && videoKbps < MIN_VIDEO_KBPS
            ? t("compress_target_too_low")
            : t(state.videoCodec === "h264" ? "compress_target_hint" : "compress_target_h264")}
        </p>
      ) : (
        <p className="text-xs text-fg-muted">
          {t("compress_was", { size: formatBytes(info.sizeBytes, language) })}
        </p>
      )}
    </>
  );

  if (audioOnly) {
    return (
      <ControlGroup className="gap-4">
        <AudioOptions
          value={state.audio}
          onChange={(audio) => set({ audio })}
          source={info.audio}
          codecs={["aac", "opus", "mp3"]}
        />
        <ControlGroup>{targetRow}</ControlGroup>
      </ControlGroup>
    );
  }

  return (
    <ControlGroup className="gap-4">
      <Segmented
        label={t("compress_quality")}
        value={state.preset}
        onChange={(preset) => set({ preset })}
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

      <Segmented
        label={t("compress_resolution")}
        value={String(state.height ?? ORIGINAL)}
        onChange={(value) => set({ height: value === ORIGINAL ? null : Number(value) })}
        columns={HEIGHTS.length + 1 > 4 ? 3 : undefined}
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

      <ControlGroup>{targetRow}</ControlGroup>

      <Disclosure
        label={t("more_options")}
        summary={[
          state.videoCodec !== "h264" ? t(`video_codec_${state.videoCodec}`) : null,
          state.maxFps ? `${state.maxFps} fps` : null,
          state.dropAudio ? t("compress_no_audio") : state.audio.bitrateKbps ? `${state.audio.bitrateKbps}k` : null,
        ]
          .filter(Boolean)
          .join(" · ") || t("compress_more_hint")}
        open={state.advancedOpen}
        onOpenChange={(advancedOpen) => set({ advancedOpen })}
      >
        <ControlGroup>
          <Labeled label={t("video_codec")}>
            <Segmented
              label={t("video_codec")}
              value={state.videoCodec}
              onChange={(videoCodec) => set({ videoCodec })}
              options={VIDEO_CODECS.map((codec) => ({
                value: codec,
                label: t(`video_codec_${codec}`),
                hint: t(`video_codec_${codec}_hint`),
              }))}
            />
          </Labeled>
        </ControlGroup>

        <Labeled label={t("compress_fps")}>
          <Segmented
            label={t("compress_fps")}
            value={String(state.maxFps ?? ORIGINAL)}
            onChange={(value) => set({ maxFps: value === ORIGINAL ? null : Number(value) })}
            options={[
              { value: ORIGINAL, label: t("compress_original") },
              ...FPS_CAPS.map((fps) => ({
                value: String(fps),
                label: `${fps} fps`,
                disabled: sourceFps > 0 && fps >= Math.round(sourceFps),
                disabledReason: t("already_smaller"),
              })),
            ]}
          />
        </Labeled>

        <CheckRow
          label={t("compress_drop_audio")}
          hint={t("compress_drop_audio_hint")}
          checked={state.dropAudio}
          onChange={(dropAudio) => set({ dropAudio })}
        />

        {!state.dropAudio && info.audio && (
          <AudioOptions
            value={state.audio}
            onChange={(audio) => set({ audio })}
            source={info.audio}
            codecs={["aac", "opus", "mp3"]}
            presets={false}
          />
        )}
      </Disclosure>
    </ControlGroup>
  );
}

export const compressTool: MediaToolConfig<CompressState> = {
  kind: "compress",
  command: "start_compress",
  requires: "media",
  initialState: {
    preset: "balanced",
    height: null,
    target: null,
    videoCodec: "h264",
    maxFps: null,
    dropAudio: false,
    audio: AUTO_AUDIO,
    advancedOpen: false,
  },
  Controls: CompressControls,
  // A target that is not a number, or one that is bigger than the file already
  // is, would run an encode to produce something larger than the input.
  isReady: ({ info, state }) => {
    if (state.target === null) return true;
    const wanted = targetMb(state);
    return wanted !== null && wanted * 1024 * 1024 < (info?.sizeBytes ?? 0);
  },
  toRequest: ({ path, info, state }) => {
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
        audio: state.dropAudio ? undefined : audioRequest(state.audio),
        videoCodec: audioOnly ? undefined : state.videoCodec,
        maxFps: audioOnly ? undefined : state.maxFps,
        dropAudio: audioOnly ? false : state.dropAudio,
      },
      title: `${name}.${audioOnly ? audioExt(state) : "mp4"}`,
      // Tokens rather than words -- see `renderDetail` -- so the row follows
      // the app's language instead of the one it was started in.
      detail: wanted
        ? `${wanted} MB`
        : audioOnly && state.audio.bitrateKbps
          ? `${state.audio.bitrateKbps}k`
          : height
            ? `${detailKey(`compress_${state.preset}`)} · ${height}p`
            : detailKey(`compress_${state.preset}`),
    };
  },
};
