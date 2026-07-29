import type { DownloadStatus } from "./types";

export function isYoutubeUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be"
    );
  } catch {
    return false;
  }
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function isActiveDownload(status: DownloadStatus): boolean {
  return status === "preparing" || status === "downloading";
}
