import { useEffect, useState, type ReactNode } from "react";
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
  AudioOptions,
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
  /** The row picked from the list, or null once the knobs under "More
   *  options" were set by hand. Kept as a key, not as the values, so it can
   *  be re-applied to the next file. */
  videoLevel: VideoLevelKey | null;
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

/**
 * The one choice a video asks for: how small. Each row is a quality preset, a
 * resolution cap and, at the very bottom, a frame-rate cap -- the three things
 * that move the size most, set together so they never fight (a "High" preset
 * squeezed to 360p, a "Small" one at 4K).
 */
type VideoLevelKey = "tiny" | "small" | "balanced" | "high";

const VIDEO_LEVELS: { key: VideoLevelKey; preset: Preset; height: number | null; maxFps: number | null }[] = [
  { key: "tiny", preset: "small", height: 480, maxFps: 30 },
  { key: "small", preset: "small", height: 720, maxFps: null },
  { key: "balanced", preset: "balanced", height: 1080, maxFps: null },
  { key: "high", preset: "high", height: null, maxFps: null },
];

/**
 * The one choice a sound file asks for: how small. Each level carries every
 * other setting with it -- AAC so the result plays on any phone or car stereo,
 * mono where the bitrate is a speech bitrate (stereo at 48k spends half its
 * bits on a second copy of the same voice), a lower sample rate at the very
 * bottom where 44.1k would leave too few bits per sample to sound like a person.
 */
type AudioLevelKey = "tiny" | "speech" | "podcast" | "balanced" | "music" | "high";

const AUDIO_LEVELS: { key: AudioLevelKey; value: AudioOptionsValue }[] = [
  { key: "tiny", value: { codec: "aac", bitrateKbps: 32, channels: "mono", sampleRate: 24000 } },
  { key: "speech", value: { codec: "aac", bitrateKbps: 48, channels: "mono", sampleRate: null } },
  { key: "podcast", value: { codec: "aac", bitrateKbps: 64, channels: "mono", sampleRate: null } },
  { key: "balanced", value: { codec: "aac", bitrateKbps: 96, channels: "auto", sampleRate: null } },
  { key: "music", value: { codec: "aac", bitrateKbps: 128, channels: "auto", sampleRate: null } },
  { key: "high", value: { codec: "aac", bitrateKbps: 192, channels: "auto", sampleRate: null } },
];

/** A level has to save at least this much to be worth offering: below it the
 *  re-encode costs quality and M4A's own overhead eats most of the gain. */
const MIN_SAVING = 0.2;

/** The levels that would actually shrink this source. A lossless or unknown
 *  source can take any of them. */
const levelsFor = (source: Parameters<typeof sourceKbps>[0]) => {
  const ceiling = sourceKbps(source);
  return ceiling === null
    ? AUDIO_LEVELS
    : AUDIO_LEVELS.filter(({ value }) => value.bitrateKbps! <= ceiling * (1 - MIN_SAVING));
};

/** Roughly half the source, the way most people mean "make it smaller":
 *  128k → 64k, 320k → 128k. A source too small for that gets its smallest. */
const recommendedLevel = (levels: typeof AUDIO_LEVELS, source: Parameters<typeof sourceKbps>[0]) => {
  const ceiling = sourceKbps(source);
  if (!levels.length) return null;
  if (ceiling === null) return levels.find((level) => level.key === "music") ?? levels[0];
  const half = levels.filter(({ value }) => value.bitrateKbps! <= ceiling / 2);
  return half.length ? half[half.length - 1] : levels[0];
};

const sameAudio = (a: AudioOptionsValue, b: AudioOptionsValue) =>
  a.codec === b.codec &&
  a.bitrateKbps === b.bitrateKbps &&
  a.channels === b.channels &&
  a.sampleRate === b.sampleRate;

/** The extension an audio-only result gets, by codec -- mirrors ops.rs. */
const audioExt = (state: CompressState) =>
  state.audio.codec === "opus" ? "opus" : state.audio.codec === "mp3" ? "mp3" : "m4a";

/**
 * One choice -- how small -- for video and sound alike. Each row says what it
 * is for and roughly what the file will weigh afterwards; everything a row
 * implies (quality, resolution, frame rate; or codec, channels, sample rate)
 * comes with it. The individual knobs are still there, shut away under
 * "More options", for the few who want them.
 */
function CompressControls({
  path,
  info,
  state,
  setState,
  language,
}: MediaToolContext<CompressState>) {
  const { t } = useTranslation();
  const set = (patch: Partial<CompressState>) => setState((current) => ({ ...current, ...patch }));

  const audioOnly = isAudioOnly(info);
  const sized = state.target !== null;

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
            : audioOnly
              ? t("compress_target_hint")
              : t(state.videoCodec === "h264" ? "compress_target_hint" : "compress_target_h264")}
        </p>
      ) : (
        <p className="text-xs text-fg-muted">
          {t("compress_was", { size: formatBytes(info.sizeBytes, language) })}
        </p>
      )}
    </>
  );

  return audioOnly ? (
    <AudioCompress info={info} state={state} set={set} targetRow={targetRow} language={language} />
  ) : (
    <VideoCompress
      path={path}
      info={info}
      state={state}
      set={set}
      targetRow={targetRow}
      language={language}
    />
  );
}

interface LevelItem {
  key: string;
  title: string;
  hint: string;
  /** Estimated output size; 0 while unknown. */
  bytes: number;
}

/**
 * The list both halves share: a radio group of rows, each with what it is for
 * on one side and the size it should come out at on the other.
 */
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
      {items.map(({ key, title, hint, bytes }) => {
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
              "flex items-center gap-3 rounded-md border px-3.5 py-2.5 text-start transition-all duration-(--duration-fast)",
              on
                ? "border-accent-line bg-accent-soft shadow-(--shadow-glow)"
                : "border-line bg-surface/65 hover:border-line-strong",
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
              <span className={cn("flex items-center gap-2 text-sm font-medium", on ? "text-accent" : "text-fg")}>
                {title}
                {key === recommendedKey && (
                  <span className="rounded-full bg-accent-soft px-2 py-px text-[11px] font-medium text-accent">
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
                  // An estimate at or over the source is worth saying before
                  // the encode rather than discovering after it.
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

/** A video level as this source will actually get it: caps at or above the
 *  source fall away, since upscaling or "capping" 30 fps at 30 changes nothing. */
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

/**
 * Compress for a video: four rows from "fits in a chat" to "close to the
 * original", each a preset, a resolution and sometimes a frame-rate cap, with
 * the backend's size estimate beside it.
 */
function VideoCompress({
  path,
  info,
  state,
  set,
  targetRow,
  language,
}: {
  path: string | null;
  info: VideoInfo;
  state: CompressState;
  set: (patch: Partial<CompressState>) => void;
  targetRow: ReactNode;
  language: string;
}) {
  const { t } = useTranslation();
  const [estimates, setEstimates] = useState<Partial<Record<VideoLevelKey, number>>>({});
  const sized = state.target !== null;
  const sourceHeight = info.video ? Math.min(info.video.height, info.video.width || info.video.height) : 0;
  const sourceFps = info.video?.fps ?? 0;

  // On a small source two levels can collapse into the same settings (480p
  // and 720p are both "original" on a 360p clip); the list shows one.
  const levels = VIDEO_LEVELS.map(({ key }) => resolveVideoLevel(key, info)).filter(
    (level, index, all) => all.findIndex((other) => sameVideo(other, level)) === index,
  );
  const chosen = state.videoLevel ? resolveVideoLevel(state.videoLevel, info) : null;
  const active = sized || !chosen ? undefined : levels.find((level) => sameVideo(level, chosen));
  const custom = !sized && state.videoLevel === null;

  // The picked level follows the file: picking "Small" and then a 4K source
  // means 720p of that source, not whatever the last file needed.
  useEffect(() => {
    if (chosen && !sameVideo(chosen, state)) {
      set({ preset: chosen.preset, height: chosen.height, maxFps: chosen.maxFps });
    }
    // `set` is rebuilt every render; the values it writes are the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.preset, chosen?.height, chosen?.maxFps, state.preset, state.height, state.maxFps]);

  // A hand-set height the new file is already under would upscale: it moves
  // off itself rather than producing a bigger file that looks no better.
  useEffect(() => {
    if (state.height !== null && sourceHeight > 0 && state.height >= sourceHeight) set({ height: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceHeight, state.height]);

  // Choosing between rows without having to run both is the whole point of
  // the estimate. Re-asked whenever anything that changes the size changes.
  const audioKey = JSON.stringify(state.audio);
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
          audio: audioRequest(state.audio),
          videoCodec: state.videoCodec,
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
    // `levelsKey` and `audioKey` stand for `levels` and `state.audio`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, levelsKey, state.videoCodec, state.dropAudio, audioKey]);

  const describe = (level: ResolvedVideoLevel) =>
    [
      t(`compress_vlevel_${level.key}_hint`),
      level.outHeight > 0 ? `${level.outHeight}p` : null,
      level.maxFps ? `${level.maxFps} fps` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  // Hand-set controls drop the row: what is on screen is no longer any of them.
  const manual = (patch: Partial<CompressState>) => set({ ...patch, videoLevel: null });

  return (
    <ControlGroup className="gap-4">
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
        {!custom && !sized && <p className="text-xs text-fg-muted">{t("compress_video_note")}</p>}
      </Labeled>

      <Disclosure
        label={t("more_options")}
        summary={
          sized
            ? `≤ ${state.target} MB`
            : [
                custom ? t("compress_custom") : null,
                custom ? t(`compress_${state.preset}`) : null,
                custom && state.height ? `${state.height}p` : null,
                custom && state.maxFps ? `${state.maxFps} fps` : null,
                state.videoCodec !== "h264" ? t(`video_codec_${state.videoCodec}`) : null,
                state.dropAudio
                  ? t("compress_no_audio")
                  : state.audio.bitrateKbps
                    ? `${state.audio.bitrateKbps}k`
                    : null,
              ]
                .filter(Boolean)
                .join(" · ") || t("compress_more_hint")
        }
        open={state.advancedOpen}
        onOpenChange={(advancedOpen) => set({ advancedOpen })}
      >
        <ControlGroup>{targetRow}</ControlGroup>

        <Labeled label={t("compress_quality")}>
          <Segmented
            label={t("compress_quality")}
            value={state.preset}
            onChange={(preset) => manual({ preset })}
            options={PRESETS.map((value) => ({ value, label: t(`compress_${value}`) }))}
          />
        </Labeled>

        <Labeled label={t("compress_resolution")}>
          <Segmented
            label={t("compress_resolution")}
            value={String(state.height ?? ORIGINAL)}
            onChange={(value) => manual({ height: value === ORIGINAL ? null : Number(value) })}
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
        </Labeled>

        <Labeled label={t("compress_fps")}>
          <Segmented
            label={t("compress_fps")}
            value={String(state.maxFps ?? ORIGINAL)}
            onChange={(value) => manual({ maxFps: value === ORIGINAL ? null : Number(value) })}
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

/**
 * Compress for a sound file. Each row carries its codec, channels and sample
 * rate; Opus or an exact bitrate are under "More options".
 */
function AudioCompress({
  info,
  state,
  set,
  targetRow,
  language,
}: {
  info: VideoInfo;
  state: CompressState;
  set: (patch: Partial<CompressState>) => void;
  targetRow: ReactNode;
  language: string;
}) {
  const { t } = useTranslation();
  const levels = levelsFor(info.audio);
  const recommended = recommendedLevel(levels, info.audio);
  const sized = state.target !== null;
  const active = sized ? undefined : levels.find(({ value }) => sameAudio(value, state.audio));
  const custom = !sized && !active && !sameAudio(state.audio, AUTO_AUDIO);

  // Something is always picked. A fresh form, or one whose level a newly
  // chosen file cannot use (a 64k pick on a 48k source), lands on the
  // recommendation; a hand-made setting from "More options" is left alone.
  const stale =
    sameAudio(state.audio, AUTO_AUDIO) ||
    (AUDIO_LEVELS.some(({ value }) => sameAudio(value, state.audio)) && !active && !sized);
  const recommendedKey = recommended?.key;
  useEffect(() => {
    if (stale && recommended) set({ audio: recommended.value });
    // `recommendedKey` stands for `recommended`; `set` is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, recommendedKey]);

  // Audio-only output is the bitrate times the length, plus a sliver of M4A.
  const sizeAt = (kbps: number) =>
    info.durationSecs > 0 ? (kbps * 1000 * info.durationSecs * 1.01) / 8 : 0;

  return (
    <ControlGroup className="gap-4">
      {levels.length ? (
        <Labeled label={t("compress_pick")}>
          <LevelList
            items={levels.map(({ key, value }) => ({
              key,
              title: t(`compress_level_${key}`),
              hint: t(`compress_level_${key}_hint`),
              bytes: sizeAt(value.bitrateKbps!),
            }))}
            activeKey={active?.key}
            recommendedKey={recommendedKey}
            sourceBytes={info.sizeBytes}
            onPick={(key) => set({ audio: levels.find((level) => level.key === key)!.value, target: null })}
            language={language}
          />
          {/* Only true of the rows: a hand-picked Opus or MP3 is neither M4A
              nor set for you. */}
          {!custom && (
            <p className="text-xs text-fg-muted">
              {t("compress_audio_note", { size: formatBytes(info.sizeBytes, language) })}
            </p>
          )}
        </Labeled>
      ) : (
        <p className="text-sm text-fg-muted">{t("compress_audio_smallest")}</p>
      )}

      <Disclosure
        label={t("more_options")}
        summary={
          sized
            ? `≤ ${state.target} MB`
            : custom
              ? [
                  t("compress_custom"),
                  state.audio.codec ? state.audio.codec.toUpperCase() : null,
                  state.audio.bitrateKbps ? `${state.audio.bitrateKbps}k` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("compress_audio_more_hint")
        }
        open={state.advancedOpen}
        onOpenChange={(advancedOpen) => set({ advancedOpen })}
      >
        <AudioOptions
          value={state.audio}
          onChange={(audio) => set({ audio })}
          source={info.audio}
          codecs={["aac", "opus", "mp3"]}
          presets={false}
        />
        <ControlGroup>{targetRow}</ControlGroup>
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
    videoLevel: "balanced",
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
