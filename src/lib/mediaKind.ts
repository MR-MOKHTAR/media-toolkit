import { FileAudio2, FileImage, FileVideo2, type LucideIcon } from "lucide-react";

/**
 * What kind of thing a file is, and how it should look.
 *
 * This lives in one place because two very different parts of the UI answer the
 * same question -- the file picker deciding what to offer, and the job card
 * deciding which icon to draw. When those two disagreed, an `.opus` file was
 * selectable as audio and then drawn with a video icon.
 */
export type MediaKind = "video" | "audio" | "gif";

export const VIDEO_EXTENSIONS = [
  "mp4", "mkv", "mov", "webm", "avi", "m4v", "ts", "flv", "wmv", "mpg", "mpeg",
];

export const AUDIO_EXTENSIONS = [
  "mp3", "m4a", "wav", "flac", "aac", "ogg", "opus", "wma",
];

const AUDIO_SET = new Set(AUDIO_EXTENSIONS);

/** Lowercased extension, or null for a path that has none. */
export function extensionOf(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  // A leading dot is a hidden file, not an extension.
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Video is the fallback, not a third "unknown" state. Every path reaching this
 * has already been through the picker's filters or ffprobe, so an extension
 * that is neither audio nor gif is video far more often than it is a mistake --
 * and a wrong icon is a smaller lie than a question mark.
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
};
