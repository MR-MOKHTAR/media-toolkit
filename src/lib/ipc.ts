/**
 * The single boundary between the app and Tauri.
 *
 * Nothing else imports `@tauri-apps/*`. Keeping it in one file is what makes
 * the backend's shape reviewable in one screen, and it is the only place that
 * has to change when a command signature moves.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "./mediaKind";
import type {
  AppError,
  DownloadRequest,
  JobProgress,
  JobStatusEvent,
  ToolStatus,
  UpdateResult,
  UrlInfo,
} from "../features/jobs/types";

export const PROGRESS_EVENT = "job-progress";
export const STATUS_EVENT = "job-status";

/** Rust rejects with a serialized `AppError`. Anything else is a bug in the
 *  bridge itself, so it is wrapped rather than silently swallowed. */
export function toAppError(error: unknown): AppError {
  if (error && typeof error === "object" && "kind" in error) {
    return error as AppError;
  }
  return { kind: "spawn", tool: "app", message: String(error) };
}

export const getToolStatus = () => invoke<ToolStatus>("tool_status");

/** Downloads a current yt-dlp into the app data dir, which is searched ahead
 *  of the bundled copy. The only way an existing install stays working when
 *  YouTube changes something. */
export const updateYtdlp = () => invoke<UpdateResult>("update_ytdlp");

export const getDefaultDownloadPath = () =>
  invoke<string>("get_default_download_path");

export const probeUrl = (url: string) => invoke<UrlInfo>("probe_url", { url });

/** Returns a job id immediately; the work reports itself through events. */
export const startDownload = (request: DownloadRequest) =>
  invoke<string>("start_download", { request });

export const cancelJob = (id: string) => invoke<void>("cancel_job", { id });

export const cancelAllJobs = () => invoke<void>("cancel_all_jobs");

/** Jobs the backend is still running. The webview reloads on every save in
 *  dev, and would otherwise lose track of work that is still going. */
export const listJobs = () =>
  invoke<{ id: string; kind: string; title: string }[]>("list_jobs");

export const revealInFolder = (path: string) =>
  invoke<void>("reveal_in_folder", { path });

export const openPath = (path: string) => invoke<void>("open_path", { path });

export async function chooseFolder(defaultPath?: string) {
  const selected = await open({ directory: true, multiple: false, defaultPath });
  return typeof selected === "string" ? selected : null;
}

export async function chooseMediaFile(defaultPath?: string) {
  const selected = await open({
    multiple: false,
    directory: false,
    defaultPath,
    filters: [
      { name: "Media", extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] },
      { name: "Video", extensions: VIDEO_EXTENSIONS },
      { name: "Audio", extensions: AUDIO_EXTENSIONS },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export const onJobProgress = (
  handler: (payload: JobProgress) => void,
): Promise<UnlistenFn> =>
  listen<JobProgress>(PROGRESS_EVENT, ({ payload }) => handler(payload));

export const onJobStatus = (
  handler: (payload: JobStatusEvent) => void,
): Promise<UnlistenFn> =>
  listen<JobStatusEvent>(STATUS_EVENT, ({ payload }) => handler(payload));
