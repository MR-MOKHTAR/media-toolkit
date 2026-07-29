import type { DownloadItem, DownloadStatus } from "./types";

const HISTORY_KEY = "youtube-downloader-history-v2";
const HISTORY_LIMIT = 100;

export function loadStoredDownloads(): DownloadItem[] {
  try {
    const value = localStorage.getItem(HISTORY_KEY);
    const items = value ? (JSON.parse(value) as DownloadItem[]) : [];

    if (!Array.isArray(items)) return [];

    return items.map((item) =>
      item.status === "downloading" || item.status === "preparing"
        ? {
            ...item,
            status: "failed" as DownloadStatus,
            speed: "—",
            eta: "—",
          }
        : item,
    );
  } catch {
    return [];
  }
}

export function saveDownloads(downloads: DownloadItem[]): void {
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(downloads.slice(0, HISTORY_LIMIT)),
  );
}
