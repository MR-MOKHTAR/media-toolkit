import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { DownloadResult, ProgressPayload } from "./types";

interface DownloadMediaParams extends Record<string, unknown> {
  url: string;
  outputPath: string;
  filename: string;
  downloadType: "audio" | "video";
  quality: string;
}

export async function getDownloadSetup() {
  const [defaultPath, ytdlpReady] = await Promise.all([
    invoke<string>("get_default_download_path"),
    invoke<boolean>("check_ytdlp_installed"),
  ]);

  return { defaultPath, ytdlpReady };
}

export async function chooseDownloadFolder(defaultPath: string) {
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath,
  });

  return typeof selected === "string" ? selected : null;
}

export function downloadMedia(params: DownloadMediaParams) {
  return invoke<DownloadResult>("download_media", params);
}

export function cancelActiveDownload() {
  return invoke<void>("cancel_download");
}

export function revealInFolder(path: string) {
  return invoke<void>("reveal_in_folder", { path });
}

export function subscribeToDownloadProgress(
  onProgress: (payload: ProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<ProgressPayload>("download-progress", ({ payload }) => {
    onProgress(payload);
  });
}
