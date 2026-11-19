import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import { ControlGroup } from "../../../components/ui/Card";
import { Segmented } from "../../../components/ui/Segmented";
import { formatBytes } from "../../../lib/format";
import {
  AUTO_AUDIO,
  AudioOptions,
  audioRequest,
  effectiveKbps,
  type AudioOptionsValue,
} from "../components/AudioOptions";
import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolForm";
import { InstantBadge } from "../components/ToolFormParts";
import { defaultOutputName } from "../useMediaJob";

/** The one value that is not a format: the file decides what comes out. */
const ORIGINAL = "original";

const FORMATS = ["mp3", "m4a", "opus", "ogg", "flac", "wav"] as const;
const LOSSLESS = ["flac", "wav"];

/** What the lossy formats spend when no bitrate is chosen. Mirrors the
 *  defaults in media/ops.rs, so the estimate and the file agree. */
const KBPS: Record<string, number> = { mp3: 190, m4a: 160, opus: 128, ogg: 160 };

interface ExtractAudioState {
  /** `original`, or one of FORMATS. */
  format: string;
  /**
   * The extension the source's audio can be copied into, `null` when it cannot
   * be, and `undefined` until the answer arrives.
   *
   * Three states rather than two: while it is unknown the lossless option is
   * offered with no promise attached. Disabling it once the answer is "no" is
   * honest; disabling it for the moment before any answer is a flicker.
   */
  copyExt?: string | null;
  /** Bitrate, channels, sample rate -- for the formats that encode. */
  audio: AudioOptionsValue;
  /** Which audio track, for a file with several (a dubbed film). */
  track: number;
}

/** Rough output size, so picking a format is not a guess. WAV is exact --
 *  uncompressed PCM is arithmetic -- and the other two are close, because a
 *  target bitrate is very nearly what VBR delivers over a whole file. */
function estimateBytes(
  state: ExtractAudioState,
  info: NonNullable<MediaToolContext<ExtractAudioState>["info"]>,
) {
  const seconds = info.durationSecs;
  const source = info.audioStreams?.[state.track] ?? info.audio;
  if (LOSSLESS.includes(state.format)) {
    const rate = state.audio.sampleRate ?? source?.sampleRate ?? 44_100;
    const channels = state.audio.channels === "mono" ? 1 : source?.channels || 2;
    // FLAC lands at about 60% of the PCM it encodes.
    return seconds * rate * channels * 2 * (state.format === "flac" ? 0.6 : 1);
  }
  const kbps = effectiveKbps(state.audio, KBPS[state.format] ?? 160, source);
  return (kbps * 1000 * seconds) / 8;
}

/**
 * One control: what the extracted track should be.
 *
 * The first option is the reason this tool exists beside Convert. The audio
 * inside an MP4 is already a finished AAC file, so lifting it out is a copy that
 * takes a moment and loses nothing -- where re-encoding it to MP3, which is what
 * everybody reaches for by habit, spends a minute making it measurably worse.
 * The three named formats stay for when something downstream insists on one.
 */
function ExtractAudioControls({
  path,
  info,
  state,
  setState,
  language,
}: MediaToolContext<ExtractAudioState>) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);

  // Asked of the backend rather than mapped from `info.audio.codec` here: which
  // container can hold which codec is what decides whether this job is a copy,
  // and that belongs in the one place that then builds the ffmpeg arguments.
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
          // A file whose track cannot be copied would otherwise leave the
          // selection pointing at an option it can no longer honour.
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
    <ControlGroup>
      <Segmented
        label={t("extract_audio_format")}
        value={state.format}
        onChange={(format) => setState((current) => ({ ...current, format }))}
        options={[
          {
            value: ORIGINAL,
            label: t("extract_audio_original"),
            // The extension, because "original" does not say what lands on disk
            // and this is the one option whose answer belongs to the file.
            hint: copyable ? `.${copyable}` : undefined,
            // Only once the answer is in -- see `copyExt`.
            disabled: asked && copyable === null,
            disabledReason: t("extract_audio_no_copy"),
          },
          ...FORMATS.map((format) => ({
            value: format as string,
            label: format === "opus" ? "Opus" : format.toUpperCase(),
          })),
        ]}
        columns={4}
      />
      {state.format !== ORIGINAL && (
        <p className="text-xs text-fg-muted">{t(`extract_audio_hint_${state.format}`)}</p>
      )}

      {/* A film with three dubs has three answers to "the audio". */}
      {(info.audioStreams?.length ?? 0) > 1 && (
        <Segmented
          label={t("audio_track")}
          value={String(state.track)}
          onChange={(value) => setState((current) => ({ ...current, track: Number(value) }))}
          options={info.audioStreams!.map((stream, index) => ({
            value: String(index),
            label: stream.title || stream.language?.toUpperCase() || t("audio_track_n", { n: index + 1 }),
            hint: `${stream.codec.toUpperCase()}${stream.channels > 2 ? ` · ${stream.channels}ch` : ""}`,
          }))}
        />
      )}

      {state.format !== ORIGINAL && !LOSSLESS.includes(state.format) && (
        <AudioOptions
          value={state.audio}
          onChange={(audio) => setState((current) => ({ ...current, audio }))}
          source={info.audioStreams?.[state.track] ?? info.audio}
          presets={state.format !== "flac"}
        />
      )}

      {isCopy ? (
        <InstantBadge text={t("instant_copy")} />
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
  // Audio, not video: pulling the track out of an audio file that is in the
  // wrong format is the same job, and refusing it would send someone to Convert
  // to do the identical thing.
  requires: "audio",
  initialState: { format: ORIGINAL, audio: AUTO_AUDIO, track: 0 },
  Controls: ExtractAudioControls,
  toRequest: ({ path, state }) => {
    const stem = defaultOutputName(path);
    // Mirrors what the backend picks (media/ops.rs): a copy keeps whatever
    // container suits the codec, and a codec with no such container lands as M4A.
    const ext =
      state.format === ORIGINAL ? (state.copyExt ?? "m4a") : state.format;
    return {
      args: {
        input: path,
        outputName: stem,
        format: state.format,
        audio: state.format === ORIGINAL ? undefined : audioRequest(state.audio),
        streamIndex: state.track,
      },
      title: `${stem}.${ext}`,
      detail: ext.toUpperCase(),
    };
  },
};
