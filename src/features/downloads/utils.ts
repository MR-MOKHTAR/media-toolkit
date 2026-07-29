import type { DownloadStatus } from "./types";

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function isActiveDownload(status: DownloadStatus): boolean {
  return status === "preparing" || status === "downloading";
}
