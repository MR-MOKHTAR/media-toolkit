import {
  FileAudio2,
  FileImage,
  FileText,
  FileVideo2,
  type LucideIcon,
} from "lucide-react";

import { AUDIO_EXTENSIONS, extensionOf } from "./fileKind";

/**
 * What kind of *media* a file is, and how it should look.
 *
 * This lives in one place because two very different parts of the UI answer the
 * same question -- the file picker deciding what to offer, and the media tools
 * deciding which icon to draw. When those two disagreed, an `.opus` file was
 * selectable as audio and then drawn with a video icon.
 *
 * Deliberately narrower than `fileKind.ts`, and not merged into it: everything
 * that reaches this module has already been through the picker's filters or
 * ffprobe, so the video floor below is a good guess here and a bad one there.
 * The extension tables now live in `fileKind.ts` and are re-exported from here
 * so the picker's idea of "audio" and the job card's cannot drift apart.
 */
export type MediaKind = "video" | "audio" | "gif" | "text";

export { AUDIO_EXTENSIONS, extensionOf, VIDEO_EXTENSIONS } from "./fileKind";

const AUDIO_SET = new Set(AUDIO_EXTENSIONS);

/**
 * Video is the fallback, not a third "unknown" state. Every path reaching this
 * has already been through the picker's filters or ffprobe, so an extension
 * that is neither audio nor gif is video far more often than it is a mistake --
 * and a wrong icon is a smaller lie than a question mark.
 *
 * A download is the one thing that must not use this. It can be handed any
 * link at all; `fileKindOf` is the answer there.
 */
export function mediaKindOfPath(path: string): MediaKind {
  const ext = extensionOf(path);
  if (ext === "gif") return "gif";
  if (ext && AUDIO_SET.has(ext)) return "audio";
  return "video";
}

export const MEDIA_KIND_ICON: Record<MediaKind, LucideIcon> = {
  video: FileVideo2,
  audio: FileAudio2,
  gif: FileImage,
  text: FileText,
};

/**
 * Icon colour plus a wash of the same hue behind it. The 10% tint is the idiom
 * already used by the instant badge and the destructive hovers, so these chips
 * sit at the same weight as everything else rather than shouting.
 */
export const MEDIA_KIND_TINT: Record<MediaKind, string> = {
  video: "bg-accent/10 text-accent",
  audio: "bg-media-audio/10 text-media-audio",
  gif: "bg-warning/10 text-warning",
  // Neutral on purpose: a transcript is the one output that is not media, and
  // giving it a fourth hue would imply a distinction that does not exist.
  text: "bg-fg-muted/10 text-fg-soft",
};
