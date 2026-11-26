import type { ReactNode } from "react";

import type { AudioTrack } from "../useMediaFile";

export type AudioCodecChoice = "aac" | "opus" | "mp3" | "flac" | "wav" | "vorbis";

export interface AudioOptionsValue {
  codec: AudioCodecChoice | null;
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

export function sourceKbps(source: AudioTrack | null | undefined): number | null {
  if (!source?.bitRate) return null;
  if (/^(flac|alac|pcm_|wav)/i.test(source.codec)) return null;
  return Math.max(1, Math.round(source.bitRate / 1000));
}

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

export function effectiveKbps(
  value: AudioOptionsValue,
  fallback: number,
  source: AudioTrack | null | undefined,
): number {
  const chosen = value.bitrateKbps ?? fallback;
  const ceiling = sourceKbps(source);
  return ceiling ? Math.min(chosen, ceiling) : chosen;
}

export function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </div>
  );
}
