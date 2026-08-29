import {
  File,
  FileArchive,
  FileAudio2,
  FileImage,
  FileText,
  FileVideo2,
  Package,
  type LucideIcon,
} from "lucide-react";

/**
 * What a file *is*, for a screen that no longer knows in advance.
 *
 * The app began as a media downloader, so the only question anything asked was
 * "video or audio", and `mediaKind.ts` answers that one for the media tools --
 * where every path has already been through a picker filter or ffprobe, and a
 * video floor is the right guess. The download screen lost that guarantee the
 * moment any http link became downloadable: an installer, an archive or a PDF
 * fed through that floor came back as "video", complete with a film icon.
 *
 * So this is the wider question, and it has an honest "other" at the bottom
 * rather than a floor. The extension tables for video and audio live here and
 * `mediaKind.ts` re-exports them, so the two answers cannot drift apart.
 */
export type FileKind =
  | "video"
  | "audio"
  | "image"
  | "archive"
  | "document"
  | "app"
  | "other";

export const VIDEO_EXTENSIONS = [
  "mp4", "mkv", "mov", "webm", "avi", "m4v", "ts", "flv", "wmv", "mpg", "mpeg",
];

export const AUDIO_EXTENSIONS = [
  "mp3", "m4a", "wav", "flac", "aac", "ogg", "opus", "wma",
];

const IMAGE_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "tif", "tiff",
  "heic", "avif",
];

const ARCHIVE_EXTENSIONS = [
  "zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso",
];

const DOCUMENT_EXTENSIONS = [
  "pdf", "txt", "md", "srt", "vtt", "doc", "docx", "xls", "xlsx", "ppt",
  "pptx", "csv", "json", "xml", "epub",
];

/** Installers and packages. `bin` is here because that is what the direct
 *  downloader names a file whose type it could not work out, and an unknown
 *  blob is far more often something to run than something to read. */
const APP_EXTENSIONS = [
  "exe", "msi", "dmg", "pkg", "deb", "rpm", "appimage", "apk", "snap",
  "flatpak", "bin",
];

const EXTENSION_KIND: Record<string, FileKind> = {};
for (const [kind, extensions] of [
  ["video", VIDEO_EXTENSIONS],
  ["audio", AUDIO_EXTENSIONS],
  ["image", IMAGE_EXTENSIONS],
  ["archive", ARCHIVE_EXTENSIONS],
  ["document", DOCUMENT_EXTENSIONS],
  ["app", APP_EXTENSIONS],
] as const) {
  for (const extension of extensions) EXTENSION_KIND[extension] = kind;
}

/** Lowercased extension, or null for a path that has none. */
export function extensionOf(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  // A leading dot is a hidden file, not an extension.
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/**
 * The same extension, but only when it looks like one: up to eight characters,
 * letters and digits only.
 *
 * This mirrors `split_name` in `direct.rs`, and it exists for the strings this
 * module is handed that are not file names. A job that has not finished yet is
 * often identified by its source URL, and the tail of one of those is
 * `setup.exe?token=abc` -- an "extension" the plain `extensionOf` is happy to
 * return, and which would be shown to the user as the format `EXE?TOKEN=ABC`.
 */
function strictExtensionOf(path: string): string | null {
  const extension = extensionOf(path);
  if (!extension) return null;
  const usable =
    extension.length <= 8 && /^[a-z0-9]+$/.test(extension);
  return usable ? extension : null;
}

/**
 * The content type, when the name could not answer.
 *
 * Only the families worth naming: everything else is `other`, which is what the
 * backend's own `extension_for_type` says by declining to guess. `text/*` lands
 * on document rather than other because a `.txt`, a `.csv` and an `.srt` are
 * all things to open and read.
 */
function kindOfContentType(contentType: string): FileKind | null {
  const type = contentType.split(";")[0].trim().toLowerCase();

  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("text/")) return "document";

  switch (type) {
    case "application/pdf":
    case "application/json":
    case "application/xml":
    case "application/epub+zip":
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.ms-powerpoint":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return "document";

    case "application/zip":
    case "application/x-7z-compressed":
    case "application/x-rar-compressed":
    case "application/vnd.rar":
    case "application/gzip":
    case "application/x-gzip":
    case "application/x-tar":
    case "application/x-bzip2":
    case "application/x-xz":
    case "application/zstd":
    case "application/x-iso9660-image":
      return "archive";

    case "application/x-msdownload":
    case "application/vnd.microsoft.portable-executable":
    case "application/x-msi":
    case "application/x-apple-diskimage":
    case "application/vnd.debian.binary-package":
    case "application/x-rpm":
    case "application/vnd.android.package-archive":
      return "app";

    default:
      return null;
  }
}

/**
 * What this is, from the best evidence there is.
 *
 * The name first: it is what the user will see on disk, and an extension is a
 * stronger claim than a header a CDN filled in by default -- `application/
 * octet-stream` is the most common content type on earth for a file that knows
 * perfectly well it is a zip.
 */
export function fileKindOf(
  nameOrPath: string,
  contentType?: string | null,
): FileKind {
  const extension = strictExtensionOf(nameOrPath);
  const byExtension = extension ? EXTENSION_KIND[extension] : undefined;
  if (byExtension) return byExtension;
  return (contentType && kindOfContentType(contentType)) || "other";
}

/** `setup.exe` -> `EXE`, for the format chip. Null when there is nothing
 *  trustworthy to show, which is better than a chip reading `PHP?ID=4`. */
export function formatLabelOf(nameOrPath: string): string | null {
  return strictExtensionOf(nameOrPath)?.toUpperCase() ?? null;
}

export const FILE_KIND_ICON: Record<FileKind, LucideIcon> = {
  video: FileVideo2,
  audio: FileAudio2,
  image: FileImage,
  archive: FileArchive,
  document: FileText,
  app: Package,
  other: File,
};

/**
 * Icon colour plus a wash of the same hue behind it, at the 10% tint the rest
 * of the app already uses.
 *
 * Four hues for seven kinds. Document and other share the neutral, because a
 * PDF and an unidentified blob are both "a file, opened elsewhere" and giving
 * them separate colours would imply a distinction nobody acts on.
 */
export const FILE_KIND_TINT: Record<FileKind, string> = {
  video: "bg-accent/10 text-accent",
  audio: "bg-media-audio/10 text-media-audio",
  image: "bg-media-image/10 text-media-image",
  archive: "bg-media-archive/10 text-media-archive",
  document: "bg-fg-muted/10 text-fg-soft",
  app: "bg-media-app/10 text-media-app",
  other: "bg-fg-muted/10 text-fg-soft",
};

/** The i18n key naming this kind, for the download form's file panel. */
export const FILE_KIND_LABEL_KEY: Record<FileKind, string> = {
  video: "file_kind_video",
  audio: "file_kind_audio",
  image: "file_kind_image",
  archive: "file_kind_archive",
  document: "file_kind_document",
  app: "file_kind_app",
  other: "file_kind_other",
};
