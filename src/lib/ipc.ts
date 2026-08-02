/**
 * The single boundary between the app and Tauri.
 *
 * Nothing else imports `@tauri-apps/*`. Keeping it in one file is what makes
 * the backend's shape reviewable in one screen, and it is the only place that
 * has to change when a command signature moves.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";

import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "./mediaKind";
import type {
  ApiKeyStatus,
  AppError,
  DownloadRequest,
  JobProgress,
  JobStatusEvent,
  Quota,
  ToolStatus,
  TranscribeModel,
  TranscriptText,
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

// ------------------------------------------------------------- transcribe

/** Groq's remaining audio-seconds for a model, as best this machine can tell.
 *  See the note in the Rust `ledger`: it can only ever be optimistic, so the
 *  screen warns on it and never blocks. */
export const groqQuota = (model: TranscribeModel) =>
  invoke<Quota>("groq_quota", { model });

/** What a file of this length will cost, overlaps included. */
export const estimateTranscribeSecs = (durationSecs: number) =>
  invoke<number>("estimate_transcribe_secs", { durationSecs });

/** Reads a finished transcript back for display. Narrow by design -- the
 *  backend checks the extension and the size, because the webview names the
 *  path and a general file read would be an arbitrary-read primitive. */
export const readTranscript = (path: string) =>
  invoke<TranscriptText>("read_transcript", { path });

/** Whether a Groq key is stored, and its last four characters. The key itself
 *  is never returned: Rust makes every HTTP call, so it has no reason to exist
 *  on this side of the bridge. */
export const apiKeyStatus = () => invoke<ApiKeyStatus>("api_key_status");

export const setApiKey = (key: string) => invoke<void>("set_api_key", { key });

export const clearApiKey = () => invoke<void>("clear_api_key");

/** Checks the key that is actually stored, not one passed in -- the saved key
 *  is the thing that can be wrong. */
export const testApiKey = () => invoke<void>("test_api_key");

/**
 * Copies text to the system clipboard.
 *
 * Goes through the Tauri plugin rather than `navigator.clipboard`, which is
 * unavailable or rejects outside a secure context in the WebKitGTK webview the
 * Linux build ships on -- while working perfectly in `vite dev` on localhost.
 * That difference is the worst kind: a copy button that passes every manual
 * test and is dead for every user.
 */
export const copyText = (text: string) => writeText(text);

export const onJobProgress = (
  handler: (payload: JobProgress) => void,
): Promise<UnlistenFn> =>
  listen<JobProgress>(PROGRESS_EVENT, ({ payload }) => handler(payload));

export const onJobStatus = (
  handler: (payload: JobStatusEvent) => void,
): Promise<UnlistenFn> =>
  listen<JobStatusEvent>(STATUS_EVENT, ({ payload }) => handler(payload));
