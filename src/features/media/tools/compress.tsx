import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

import { ControlGroup } from "../../../components/ui/Card";
import { Checkbox, CheckRow } from "../../../components/ui/CheckRow";
import { Disclosure } from "../../../components/ui/Disclosure";
import { Segmented } from "../../../components/ui/Segmented";
import { TextInput } from "../../../components/ui/TextInput";
import { cn } from "../../../lib/cn";
import { formatBytes, formatPercent } from "../../../lib/format";
import {
  AUTO_AUDIO,
  Labeled,
  audioRequest,
  effectiveKbps,
  sourceKbps,
  type AudioOptionsValue,
} from "../components/AudioOptions";
import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolForm";
import { detailKey } from "../../jobs/detail";
import { defaultOutputName } from "../useMediaJob";

type Preset = "small" | "balanced" | "high";

const PRESET_AUDIO_KBPS: Record<Preset, number> = { small: 96, balanced: 128, high: 192 };
const MIN_VIDEO_KBPS = 100;
const AUDIO_BITRATES = [32, 48, 64, 96, 128, 192] as const;
const VIDEO_AUDIO_BITRATES = [48, 64, 96, 128, 192] as const;

interface CompressState {
  preset: Preset;
  height: number | null;
  target: string | null;
  maxFps: number | null;
  dropAudio: boolean;
  audio: AudioOptionsValue;
  videoAudioKbps: number | null;
  videoLevel: VideoLevelKey;
  audioLevel: AudioLevelKey | "recommended" | "custom";
  advancedOpen: boolean;
}

const isAudioOnly = (info: MediaToolContext<CompressState>["info"]) =>
  Boolean(info && !info.video && info.audio);

const targetMb = (state: CompressState) => {
  if (state.target === null) return null;
  const value = Number(state.target.replace(/[٫,]/g, "."));
  return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * Three clear, smart video compression levels:
 * - `small`: 720p max, 30 fps cap if high-fps — compact for chat apps while staying sharp.
 * - `balanced`: 1080p max — recommended sweet spot of clarity and file size.
 * - `high`: original resolution — minimal visual loss, cleans up bloated bitrates.
 */
type VideoLevelKey = "small" | "balanced" | "high";

const VIDEO_LEVELS: { key: VideoLevelKey; preset: Preset; height: number | null; maxFps: number | null }[] = [
  { key: "small", preset: "small", height: 720, maxFps: 30 },
  { key: "balanced", preset: "balanced", height: 1080, maxFps: null },
  { key: "high", preset: "high", height: null, maxFps: null },
];

type AudioLevelKey = "speech" | "podcast" | "music" | "high";
type AudioSource = Parameters<typeof sourceKbps>[0];
type LevelCodec = "aac" | "opus" | "mp3";

const AUDIO_LEVELS: { key: AudioLevelKey; value: Omit<AudioOptionsValue, "codec"> }[] = [
  { key: "speech", value: { bitrateKbps: 48, channels: "mono", sampleRate: null } },
  { key: "podcast", value: { bitrateKbps: 64, channels: "mono", sampleRate: null } },
  { key: "music", value: { bitrateKbps: 128, channels: "auto", sampleRate: null } },
  { key: "high", value: { bitrateKbps: 192, channels: "auto", sampleRate: null } },
];

function levelCodec(source: AudioSource): LevelCodec {
  const codec = source?.codec.toLowerCase() ?? "";
  if (codec === "mp3" || codec === "mp3float") return "mp3";
  if (codec === "opus") return "opus";
  return "aac";
}

const codecLabelKey = (codec: LevelCodec) =>
  codec === "opus" ? "audio_choice_opus" : codec === "mp3" ? "audio_choice_mp3" : "audio_choice_m4a";

const MIN_SAVING = 0.12;

const levelsFor = (source: AudioSource) => {
  const codec = levelCodec(source);
  const ceiling = sourceKbps(source);
  return AUDIO_LEVELS.filter(
    ({ value }) => ceiling === null || value.bitrateKbps! <= ceiling * (1 - MIN_SAVING),
  ).map(({ key, value }) => ({ key, value: { ...value, codec } as AudioOptionsValue }));
};

const recommendedLevel = (levels: ReturnType<typeof levelsFor>, source: AudioSource) => {
  const ceiling = sourceKbps(source);
  if (!levels.length) return null;
  if (ceiling === null) return levels.find((level) => level.key === "music") ?? levels[0];
  const half = levels.filter(({ value }) => value.bitrateKbps! <= ceiling * 0.6);
  return half.length ? half[half.length - 1] : levels[0];
};

const videoAudioValue = (kbps: number | null): AudioOptionsValue =>
  kbps === null
    ? AUTO_AUDIO
    : {
        codec: null,
        bitrateKbps: kbps,
        channels: kbps <= 64 ? "mono" : "auto",
        sampleRate: null,
      };

const sameAudio = (a: AudioOptionsValue, b: AudioOptionsValue) =>
  a.codec === b.codec &&
  a.bitrateKbps === b.bitrateKbps &&
  a.channels === b.channels &&
  a.sampleRate === b.sampleRate;

const audioExt = (state: CompressState) =>
  state.audio.codec === "opus" ? "opus" : state.audio.codec === "mp3" ? "mp3" : "m4a";

function CompressControls({
  path,
  info,
  state,
  setState,
  language,
  folderRow,
}: MediaToolContext<CompressState>) {
  const { t } = useTranslation();
  const set = (patch: Partial<CompressState>) => setState((current) => ({ ...current, ...patch }));
  const prevPath = useRef(path);

  useEffect(() => {
    if (prevPath.current !== path) {
      prevPath.current = path;
      set({
        audio: AUTO_AUDIO,
        videoAudioKbps: null,
        audioLevel: "recommended",
        target: null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const audioOnly = isAudioOnly(info);
  const sized = state.target !== null;

  if (!info) return null;

  const wanted = targetMb(state);
  const activeVideoAudio = videoAudioValue(state.videoAudioKbps);
  const audioKbps = state.dropAudio
    ? 0
    : effectiveKbps(
        audioOnly ? state.audio : activeVideoAudio,
        PRESET_AUDIO_KBPS[state.preset],
        info.audio,
      );
  const videoKbps =
    wanted && info.durationSecs > 0 && !audioOnly
      ? (wanted * 8 * 1024 * 0.97) / info.durationSecs - audioKbps
      : null;

  const targetRow = (
    <ControlGroup>
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
        <p className="text-xs text-danger-text">
          {t("compress_target_invalid", { size: formatBytes(info.sizeBytes, language) })}
        </p>
      ) : sized && videoKbps !== null && videoKbps < MIN_VIDEO_KBPS ? (
        <p className="text-xs text-warning-text">{t("compress_target_too_low")}</p>
      ) : null}
    </ControlGroup>
  );

  return audioOnly ? (
    <AudioCompress
      info={info}
      state={state}
      set={set}
      targetRow={targetRow}
      folderRow={folderRow}
      language={language}
    />
  ) : (
    <VideoCompress
      path={path}
      info={info}
      state={state}
      set={set}
      targetRow={targetRow}
      folderRow={folderRow}
      language={language}
    />
  );
}

interface LevelItem {
  key: string;
  title: string;
  tag?: string;
  hint: string;
  bytes: number;
}

function LevelList({
  items,
  activeKey,
  recommendedKey,
  sourceBytes,
  onPick,
  language,
}: {
  items: LevelItem[];
  activeKey: string | undefined;
  recommendedKey: string | undefined;
  sourceBytes: number;
  onPick: (key: string) => void;
  language: string;
}) {
  const { t } = useTranslation();

  return (
    <div role="radiogroup" aria-label={t("compress_pick")} className="flex flex-col gap-2">
      {items.map(({ key, title, tag, hint, bytes }) => {
        const on = activeKey === key;
        const saving = bytes && sourceBytes ? (1 - bytes / sourceBytes) * 100 : 0;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(key)}
            className={cn(
              "flex items-center gap-3 rounded-md border px-3.5 py-2.5 text-start transition-colors duration-(--duration-fast)",
              on
                ? "border-accent bg-accent-soft"
                : "border-line bg-surface hover:border-line-strong hover:bg-surface-hover",
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border",
                on ? "border-accent bg-accent text-on-accent" : "border-line-strong",
              )}
            >
              {on && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn("flex flex-wrap items-center gap-1.5 text-sm font-medium", on ? "text-accent" : "text-fg")}>
                <span>{title}</span>
                {tag && (
                  <span
                    dir="ltr"
                    className={cn(
                      "rounded-sm px-1.5 py-px text-[11px] font-medium tnum",
                      on
                        ? "bg-accent/15 text-accent"
                        : "border border-line-soft bg-surface-soft text-fg-muted",
                    )}
                  >
                    {tag}
                  </span>
                )}
                {key === recommendedKey && (
                  <span className="rounded-sm bg-accent/12 px-1.5 py-px text-[11px] font-medium text-accent">
                    {t("compress_recommended")}
                  </span>
                )}
              </span>
              <span className="truncate text-xs text-fg-muted">{hint}</span>
            </span>
            {bytes > 0 && (
              <span className="flex shrink-0 flex-col items-end">
                <span dir="ltr" className={cn("text-sm font-medium tnum", on ? "text-accent" : "text-fg")}>
                  ≈ {formatBytes(bytes, language)}
                </span>
                {saving >= 5 ? (
                  <span className="text-xs text-fg-muted">
                    {t("compress_level_saving", { percent: formatPercent(saving, language) })}
                  </span>
                ) : (
                  <span className="text-xs text-warning-text">{t("compress_level_no_saving")}</span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

type VideoInfo = NonNullable<MediaToolContext<CompressState>["info"]>;

function audioTrackWithFallback(info: VideoInfo): AudioSource {
  if (!info.audio) return null;
  if (info.audio.bitRate || info.video) return info.audio;
  const fallbackBitRate =
    info.bitRate ??
    (info.durationSecs > 0 && info.sizeBytes > 0
      ? Math.round((info.sizeBytes * 8) / info.durationSecs)
      : null);
  return fallbackBitRate ? { ...info.audio, bitRate: fallbackBitRate } : info.audio;
}

function resolveVideoLevel(key: VideoLevelKey, info: VideoInfo) {
  const level = VIDEO_LEVELS.find((candidate) => candidate.key === key)!;
  const video = info.video;
  const sourceHeight = video ? Math.min(video.height, video.width || video.height) : 0;
  const sourceFps = video?.fps ?? 0;
  return {
    key,
    preset: level.preset,
    height: level.height !== null && sourceHeight > 0 && level.height < sourceHeight ? level.height : null,
    maxFps: level.maxFps !== null && sourceFps > level.maxFps + 1 ? level.maxFps : null,
    outHeight: level.height !== null && sourceHeight > level.height ? level.height : sourceHeight,
  };
}

type ResolvedVideoLevel = ReturnType<typeof resolveVideoLevel>;

const sameVideo = (
  a: Pick<ResolvedVideoLevel, "preset" | "height" | "maxFps">,
  b: Pick<ResolvedVideoLevel, "preset" | "height" | "maxFps">,
) => a.preset === b.preset && a.height === b.height && a.maxFps === b.maxFps;

function VideoCompress({
  path,
  info,
  state,
  set,
  targetRow,
  folderRow,
  language,
}: {
  path: string | null;
  info: VideoInfo;
  state: CompressState;
  set: (patch: Partial<CompressState>) => void;
  targetRow: ReactNode;
  folderRow: ReactNode;
  language: string;
}) {
  const { t } = useTranslation();
  const [estimates, setEstimates] = useState<Partial<Record<VideoLevelKey, number>>>({});
  const sized = state.target !== null;
  const audioCeiling = sourceKbps(info.audio);
  const videoAudio = videoAudioValue(state.videoAudioKbps);

  const levels = VIDEO_LEVELS.map(({ key }) => resolveVideoLevel(key, info)).filter(
    (level, index, all) => all.findIndex((other) => sameVideo(other, level)) === index,
  );
  const chosen = resolveVideoLevel(state.videoLevel, info);
  const active = sized ? undefined : levels.find((level) => sameVideo(level, chosen));

  useEffect(() => {
    if (!sameVideo(chosen, state)) {
      set({ preset: chosen.preset, height: chosen.height, maxFps: chosen.maxFps });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen.preset, chosen.height, chosen.maxFps, state.preset, state.height, state.maxFps]);

  const levelsKey = JSON.stringify(levels);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const input = path;

    void Promise.all(
      levels.map((level) =>
        invoke<number>("estimate_compressed_size", {
          path: input,
          preset: level.preset,
          maxHeight: level.height,
          audio: state.dropAudio ? undefined : audioRequest(videoAudio),
          videoCodec: "h264",
          maxFps: level.maxFps,
          dropAudio: state.dropAudio,
        })
          .then((bytes) => [level.key, bytes] as const)
          .catch(() => [level.key, 0] as const),
      ),
    ).then((pairs) => {
      if (!cancelled) setEstimates(Object.fromEntries(pairs.filter(([, bytes]) => bytes > 0)));
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, levelsKey, state.dropAudio, state.videoAudioKbps]);

  const describe = (level: ResolvedVideoLevel) =>
    [
      t(`compress_vlevel_${level.key}_hint`),
      level.outHeight > 0 ? `${level.outHeight}p` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const summary = [
    sized ? `≤ ${state.target} MB` : null,
    state.dropAudio
      ? t("compress_no_audio")
      : state.videoAudioKbps
        ? `${state.videoAudioKbps}k`
        : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ControlGroup className="gap-3.5">
      <Labeled label={t("compress_pick")}>
        <LevelList
          items={levels.map((level) => ({
            key: level.key,
            title: t(`compress_vlevel_${level.key}`),
            hint: describe(level),
            bytes: sized ? 0 : (estimates[level.key] ?? 0),
          }))}
          activeKey={active?.key}
          recommendedKey={levels.find((level) => level.key === "balanced")?.key ?? levels[levels.length - 1]?.key}
          sourceBytes={info.sizeBytes}
          onPick={(key) => {
            const level = resolveVideoLevel(key as VideoLevelKey, info);
            set({
              videoLevel: level.key,
              preset: level.preset,
              height: level.height,
              maxFps: level.maxFps,
              target: null,
            });
          }}
          language={language}
        />
      </Labeled>

      <Disclosure
        label={t("more_options")}
        summary={summary || undefined}
        open={state.advancedOpen}
        onOpenChange={(advancedOpen) => set({ advancedOpen })}
      >
        {folderRow}
        {targetRow}
        {info.audio && !state.dropAudio && (
          <Labeled label={`${t("format_audio")} · ${t("audio_bitrate")}`}>
            <Segmented
              label={t("audio_bitrate")}
              columns={3}
              value={state.videoAudioKbps === null ? "auto" : String(state.videoAudioKbps)}
              onChange={(next) =>
                set({ videoAudioKbps: next === "auto" ? null : Number(next) })
              }
              options={[
                { value: "auto", label: t("audio_bitrate_auto") },
                ...VIDEO_AUDIO_BITRATES.map((kbps) => {
                  const aboveSource = audioCeiling !== null && kbps > audioCeiling;
                  return {
                    value: String(kbps),
                    label: `${kbps}k`,
                    disabled: aboveSource,
                    disabledReason: aboveSource ? t("already_smaller") : undefined,
                  };
                }),
              ]}
            />
          </Labeled>
        )}
        <CheckRow
          label={t("compress_drop_audio")}
          hint={t("compress_drop_audio_hint")}
          checked={state.dropAudio}
          onChange={(dropAudio) => set({ dropAudio })}
        />
      </Disclosure>
    </ControlGroup>
  );
}

function AudioCompress({
  info,
  state,
  set,
  targetRow,
  folderRow,
  language,
}: {
  info: VideoInfo;
  state: CompressState;
  set: (patch: Partial<CompressState>) => void;
  targetRow: ReactNode;
  folderRow: ReactNode;
  language: string;
}) {
  const { t } = useTranslation();
  const source = audioTrackWithFallback(info);
  const ceiling = sourceKbps(source);
  const levels = levelsFor(source);
  const recommended = recommendedLevel(levels, source);
  const sized = state.target !== null;
  const recommendedKey = recommended?.key;

  const defaultCodec = levelCodec(source);
  const defaultKbps =
    [...AUDIO_BITRATES].reverse().find((kbps) => ceiling === null || kbps <= ceiling) ??
    AUDIO_BITRATES[0];
  const fallbackAudio: AudioOptionsValue = {
    codec: defaultCodec,
    bitrateKbps: defaultKbps,
    channels: defaultKbps <= 64 ? "mono" : "auto",
    sampleRate: null,
  };

  const chosen =
    state.audioLevel === "custom"
      ? undefined
      : (levels.find(({ key }) => key === state.audioLevel) ?? recommended ?? undefined);
  const active = sized
    ? undefined
    : (chosen ?? levels.find(({ value }) => sameAudio(value, state.audio)));

  const targetAudio = chosen ? chosen.value : state.audioLevel === "custom" ? null : fallbackAudio;
  const targetAudioKey = targetAudio ? JSON.stringify(targetAudio) : null;
  useEffect(() => {
    if (targetAudio && !sameAudio(targetAudio, state.audio)) {
      set({ audio: targetAudio });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAudioKey, state.audio]);

  const currentCodec: LevelCodec =
    state.audio.codec === "opus" || state.audio.codec === "mp3" || state.audio.codec === "aac"
      ? state.audio.codec
      : defaultCodec;
  const currentKbps = state.audio.bitrateKbps ?? defaultKbps;

  const applyCustomAudio = (nextCodec: LevelCodec, nextKbps: number) => {
    const nextAudio: AudioOptionsValue = {
      codec: nextCodec,
      bitrateKbps: nextKbps,
      channels: nextKbps <= 64 ? "mono" : "auto",
      sampleRate: null,
    };
    const matched = levels.find((level) => sameAudio(level.value, nextAudio));
    set({
      audioLevel: matched ? matched.key : "custom",
      audio: nextAudio,
      target: null,
    });
  };

  const sizeAt = (kbps: number) =>
    info.durationSecs > 0 ? (kbps * 1000 * info.durationSecs * 1.01) / 8 : 0;

  const summary = sized
    ? `≤ ${state.target} MB`
    : state.audioLevel === "custom"
      ? `${t(codecLabelKey(currentCodec))} · ${currentKbps}k`
      : `${currentKbps}k`;

  return (
    <ControlGroup className="gap-3.5">
      {levels.length ? (
        <Labeled label={t("compress_pick")}>
          <LevelList
            items={levels.map(({ key, value }) => ({
              key,
              title: t(`compress_level_${key}`),
              tag: `${value.bitrateKbps}k`,
              hint: t(`compress_level_${key}_hint`),
              bytes: sizeAt(value.bitrateKbps!),
            }))}
            activeKey={active?.key}
            recommendedKey={recommendedKey}
            sourceBytes={info.sizeBytes}
            onPick={(key) =>
              set({
                audioLevel: key as AudioLevelKey,
                audio: levels.find((level) => level.key === key)!.value,
                target: null,
              })
            }
            language={language}
          />
        </Labeled>
      ) : (
        <p className="text-sm text-fg-muted">{t("compress_audio_smallest")}</p>
      )}

      <Disclosure
        label={t("more_options")}
        summary={summary}
        open={state.advancedOpen}
        onOpenChange={(advancedOpen) => set({ advancedOpen })}
      >
        <Labeled label={t("audio_codec")}>
          <Segmented
            label={t("audio_codec")}
            value={currentCodec}
            onChange={(codec) => applyCustomAudio(codec as LevelCodec, currentKbps)}
            options={[
              { value: "aac", label: t("audio_choice_m4a"), hint: t("audio_codec_aac_hint") },
              { value: "opus", label: t("audio_choice_opus"), hint: t("audio_codec_opus_hint") },
              { value: "mp3", label: t("audio_choice_mp3"), hint: t("audio_codec_mp3_hint") },
            ]}
          />
        </Labeled>

        <Labeled label={t("audio_bitrate")}>
          <Segmented
            label={t("audio_bitrate")}
            columns={3}
            value={String(currentKbps)}
            onChange={(kbps) => applyCustomAudio(currentCodec, Number(kbps))}
            options={AUDIO_BITRATES.map((kbps, index) => {
              const aboveSource = index > 0 && ceiling !== null && kbps > ceiling;
              return {
                value: String(kbps),
                label: `${kbps}k`,
                disabled: aboveSource,
                disabledReason: aboveSource ? t("already_smaller") : undefined,
              };
            })}
          />
        </Labeled>

        {folderRow}
        {targetRow}
      </Disclosure>
    </ControlGroup>
  );
}

export const compressTool: MediaToolConfig<CompressState> = {
  kind: "compress",
  command: "start_compress",
  requires: "media",
  handlesFolderRow: true,
  initialState: {
    preset: "balanced",
    height: null,
    target: null,
    maxFps: null,
    dropAudio: false,
    audio: AUTO_AUDIO,
    videoAudioKbps: null,
    videoLevel: "balanced",
    audioLevel: "recommended",
    advancedOpen: false,
  },
  Controls: CompressControls,
  isReady: ({ info, state }) => {
    if (state.target === null) return true;
    const wanted = targetMb(state);
    return wanted !== null && wanted * 1024 * 1024 < (info?.sizeBytes ?? 0);
  },
  toRequest: ({ path, info, state }) => {
    const stem = defaultOutputName(path);
    const audioOnly = isAudioOnly(info);
    const height = audioOnly ? null : state.height;
    const name = height ? `${stem}-${height}p` : `${stem}-compressed`;
    const wanted = targetMb(state);
    const activeAudio = audioOnly ? state.audio : videoAudioValue(state.videoAudioKbps);

    const detail = wanted
      ? [
          `${wanted} MB`,
          !audioOnly && !state.dropAudio && state.videoAudioKbps
            ? `${state.videoAudioKbps}k`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : audioOnly && state.audio.bitrateKbps
        ? `${state.audio.bitrateKbps}k`
        : [
            detailKey(`compress_${state.preset}`),
            height ? `${height}p` : null,
            !state.dropAudio && state.videoAudioKbps ? `${state.videoAudioKbps}k` : null,
          ]
            .filter(Boolean)
            .join(" · ");

    return {
      args: {
        input: path,
        outputName: name,
        preset: state.preset,
        maxHeight: height,
        targetSizeMb: wanted,
        audio: state.dropAudio ? undefined : audioRequest(activeAudio),
        videoCodec: audioOnly ? undefined : "h264",
        maxFps: audioOnly ? undefined : state.maxFps,
        dropAudio: audioOnly ? false : state.dropAudio,
      },
      title: `${name}.${audioOnly ? audioExt(state) : "mp4"}`,
      detail,
    };
  },
};
