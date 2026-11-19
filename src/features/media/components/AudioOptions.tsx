import { useTranslation } from "react-i18next";
import { BookOpen, Headphones, Mic, Music } from "lucide-react";

import { ControlGroup } from "../../../components/ui/Card";
import { Segmented } from "../../../components/ui/Segmented";
import { cn } from "../../../lib/cn";
import { formatCount } from "../../../lib/format";
import type { AudioTrack } from "../useMediaFile";

/** The codecs a tool can offer. Mirrors `ops::AudioCodec`. */
export type AudioCodecChoice = "aac" | "opus" | "mp3" | "flac" | "wav" | "vorbis";

/** What the backend's `AudioOpts` takes. */
export interface AudioOptionsValue {
  codec: AudioCodecChoice | null;
  /** Null is automatic: the tool's default, never above the source. */
  bitrateKbps: number | null;
  channels: "auto" | "mono" | "stereo";
  sampleRate: number | null;
}

export const AUTO_AUDIO: AudioOptionsValue = {
  codec: null,
  bitrateKbps: null,
  channels: "auto",
  sampleRate: null,
};

/** The bitrates offered, kbps. Low ones are for speech; Opus handles them
 *  far better than AAC or MP3. */
const BITRATES = [32, 48, 64, 96, 128, 160, 192, 256, 320] as const;
const SAMPLE_RATES = [48000, 44100, 32000, 24000, 16000] as const;

/** One tap for the four things people compress audio for. */
const PRESETS: {
  key: "voice" | "podcast" | "music" | "high";
  icon: typeof Mic;
  value: AudioOptionsValue;
}[] = [
  { key: "voice", icon: Mic, value: { codec: "opus", bitrateKbps: 32, channels: "mono", sampleRate: 24000 } },
  { key: "podcast", icon: BookOpen, value: { codec: "aac", bitrateKbps: 64, channels: "mono", sampleRate: null } },
  { key: "music", icon: Music, value: { codec: "aac", bitrateKbps: 160, channels: "auto", sampleRate: null } },
  { key: "high", icon: Headphones, value: { codec: "aac", bitrateKbps: 256, channels: "auto", sampleRate: null } },
];

const LOSSLESS: AudioCodecChoice[] = ["flac", "wav"];

/** The source's bitrate in kbps, when it is lossy and known. */
export function sourceKbps(source: AudioTrack | null | undefined): number | null {
  if (!source?.bitRate) return null;
  if (/^(flac|alac|pcm_|wav)/i.test(source.codec)) return null;
  return Math.max(1, Math.round(source.bitRate / 1000));
}

/**
 * The audio half of every tool: presets, bitrate, codec, channels, rate.
 *
 * `codecs` is what this tool can write; omit it where the format already
 * decides the codec (Convert to MP3). Bitrates above a lossy source are
 * offered disabled with the reason -- re-encoding upwards makes a bigger file
 * that sounds no better, and the backend would clamp it anyway.
 */
export function AudioOptions({
  value,
  onChange,
  source,
  codecs,
  presets = true,
  /** The codec the tool falls back to when `value.codec` is null. */
  defaultCodec = "aac",
}: {
  value: AudioOptionsValue;
  onChange: (value: AudioOptionsValue) => void;
  source: AudioTrack | null | undefined;
  codecs?: AudioCodecChoice[];
  presets?: boolean;
  defaultCodec?: AudioCodecChoice;
}) {
  const { t, i18n } = useTranslation();
  const codec = value.codec ?? defaultCodec;
  const lossless = LOSSLESS.includes(codec);
  const ceiling = sourceKbps(source);
  const set = (patch: Partial<AudioOptionsValue>) => onChange({ ...value, ...patch });
  const activePreset = PRESETS.find(
    (preset) =>
      preset.value.bitrateKbps === value.bitrateKbps &&
      preset.value.channels === value.channels &&
      (!codecs || preset.value.codec === value.codec),
  )?.key;

  return (
    <ControlGroup className="gap-3">
      {presets && !lossless && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRESETS.map(({ key, icon: Icon, value: preset }) => {
            const on = activePreset === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange({
                    ...preset,
                    // A tool whose format fixes the codec keeps its own.
                    codec: codecs?.includes(preset.codec!) ? preset.codec : value.codec,
                  })
                }
                className={cn(
                  "flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-start transition-all duration-(--duration-fast)",
                  on
                    ? "border-accent-line bg-accent-soft text-accent shadow-(--shadow-glow)"
                    : "border-line bg-surface/65 text-fg-soft hover:border-line-strong",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon size={14} className="shrink-0" />
                  {t(`audio_preset_${key}`)}
                </span>
                <span className="text-xs opacity-80">{t(`audio_preset_${key}_hint`)}</span>
              </button>
            );
          })}
        </div>
      )}

      {codecs && codecs.length > 1 && (
        <Labeled label={t("audio_codec")}>
        <Segmented
          label={t("audio_codec")}
          value={codec}
          onChange={(next) => set({ codec: next })}
          options={codecs.map((choice) => ({
            value: choice,
            label: choice === "aac" ? "AAC" : choice === "opus" ? "Opus" : choice.toUpperCase(),
            hint: t(`audio_codec_${choice}_hint`),
          }))}
        />
        </Labeled>
      )}

      {!lossless && (
        <Labeled label={t("audio_bitrate")}>
        <Segmented
          label={t("audio_bitrate")}
          value={value.bitrateKbps === null ? "auto" : String(value.bitrateKbps)}
          onChange={(next) => set({ bitrateKbps: next === "auto" ? null : Number(next) })}
          columns={5}
          options={[
            { value: "auto", label: t("audio_bitrate_auto") },
            ...BITRATES.map((kbps) => {
              const tooHigh = ceiling !== null && kbps > ceiling;
              // Said once below, not on each chip: nine copies of the
              // same sentence turned the row into a wall of text.
              return { value: String(kbps), label: `${kbps}k`, disabled: tooHigh };
            }),
          ]}
        />
        {ceiling !== null && ceiling < BITRATES[BITRATES.length - 1] && (
          <p className="text-xs text-fg-muted">
            {t("audio_bitrate_capped", { kbps: formatCount(ceiling, i18n.language) })}
          </p>
        )}
        </Labeled>
      )}

      {/* At speech bitrates Opus is the codec that still sounds like a person;
          said where the choice is being made, with the switch beside it. */}
      {codecs?.includes("opus") && codec !== "opus" && value.bitrateKbps !== null && value.bitrateKbps <= 64 && (
        <p className="text-xs text-fg-muted">
          {t("audio_opus_tip")}{" "}
          <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => set({ codec: "opus" })}>
            {t("audio_use_opus")}
          </button>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled label={t("audio_channels")}>
        <Segmented
          label={t("audio_channels")}
          value={value.channels}
          onChange={(channels) => set({ channels })}
          options={(["auto", "mono", "stereo"] as const).map((channels) => ({
            value: channels,
            label: t(`audio_channels_${channels}`),
            // Never upmixed: a mono source asked for stereo stays mono.
            disabled: channels === "stereo" && (source?.channels ?? 2) < 2,
            disabledReason: t("audio_channels_mono_source"),
          }))}
        />
        </Labeled>
        <Labeled label={t("audio_sample_rate")}>
        <Segmented
          label={t("audio_sample_rate")}
          value={value.sampleRate === null ? "auto" : String(value.sampleRate)}
          onChange={(next) => set({ sampleRate: next === "auto" ? null : Number(next) })}
          options={[
            { value: "auto", label: t("audio_bitrate_auto") },
            ...SAMPLE_RATES.filter((rate) => rate !== 32000).map((rate) => ({
              value: String(rate),
              label: `${rate / 1000}k`,
            })),
          ]}
        />
        </Labeled>
      </div>
    </ControlGroup>
  );
}

/** The opts object the backend takes, or undefined for "all automatic". */
export function audioRequest(value: AudioOptionsValue): Record<string, unknown> | undefined {
  if (
    value.codec === null &&
    value.bitrateKbps === null &&
    value.channels === "auto" &&
    value.sampleRate === null
  ) {
    return undefined;
  }
  return {
    codec: value.codec ?? undefined,
    bitrateKbps: value.bitrateKbps ?? undefined,
    channels: value.channels,
    sampleRate: value.sampleRate ?? undefined,
  };
}

/** The bitrate a value will spend, for size estimates: the chosen one, or the
 *  tool's default clamped to the source. */
export function effectiveKbps(
  value: AudioOptionsValue,
  fallback: number,
  source: AudioTrack | null | undefined,
): number {
  const chosen = value.bitrateKbps ?? fallback;
  const ceiling = sourceKbps(source);
  return ceiling ? Math.min(chosen, ceiling) : chosen;
}

/** A small visible caption over a control -- the segmented rows' own labels
 *  are for screen readers only, and four unlabelled rows of numbers read as a
 *  puzzle. */
export function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </div>
  );
}
