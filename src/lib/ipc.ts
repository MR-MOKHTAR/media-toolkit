/**
 * The single boundary between the app and Tauri.
 *
 * Nothing else imports `@tauri-apps/*`. Keeping it in one file is what makes
 * the backend's shape reviewable in one screen, and it is the only place that
 * has to change when a command signature moves.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";

import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "./mediaKind";
import type {
  AppError,
  DownloadRequest,
  JobMetaEvent,
  JobProgress,
  JobStatusEvent,
  JobSummary,
  LibraryInfo,
  LibrarySlot,
  NetworkSettings,
  ProxyTest,
  PlaylistListing,
  ToolStatus,
  TraySettings,
  UpdateResult,
  UrlInfo,
} from "../features/jobs/types";

export const PROGRESS_EVENT = "job-progress";
export const STATUS_EVENT = "job-status";
export const META_EVENT = "job-meta";

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

// ---------------------------------------------------------------- library
//
// Where the app's own files live. Rust owns the layout -- see `library.rs` --
// so no screen ever builds an output path itself.

/** The folder for one kind of result, created on the way out. */
export const getLibraryFolder = (slot: LibrarySlot) =>
  invoke<string>("library_folder", { slot });

export const getLibraryInfo = () => invoke<LibraryInfo>("library_info");

/** Rejects a folder the app cannot write to, so the failure lands in the
 *  picker rather than in the first download that uses it. */
export const setLibraryRoot = (path: string) =>
  invoke<LibraryInfo>("set_library_root", { path });

export const resetLibraryRoot = () =>
  invoke<LibraryInfo>("reset_library_root");

export const setLibraryOrganize = (enabled: boolean) =>
  invoke<LibraryInfo>("set_library_organize", { enabled });

export const setSaveNextToInput = (enabled: boolean) =>
  invoke<LibraryInfo>("set_save_next_to_input", { enabled });

// ------------------------------------------------------------------- tray

export const getTraySettings = () => invoke<TraySettings>("get_tray_settings");

export const setCloseToTray = (enabled: boolean) =>
  invoke<TraySettings>("set_close_to_tray", { enabled });

/** The tray menu's words, in the interface language. Never throws: no tray in
 *  `vite dev`, and the English defaults are a fine fallback. */
export const setTrayLabels = async (show: string, quit: string) => {
  try {
    await invoke("set_tray_labels", { show, quit });
  } catch {
    // Nothing to label.
  }
};

// ---------------------------------------------------------------- network

export const getNetworkSettings = () => invoke<NetworkSettings>("get_network_settings");

/** Validates, saves and applies; answers with what is now in force. */
export const setNetworkSettings = (settings: NetworkSettings) =>
  invoke<NetworkSettings>("set_network_settings", { settings });

/** Whether YouTube answers through `proxy` (null: without one). */
export const testProxy = (proxy: string | null) =>
  invoke<ProxyTest>("test_proxy", { proxy });

export const probeUrl = (url: string, cookiesFrom?: string) =>
  invoke<UrlInfo>("probe_url", { url, cookiesFrom });

/** The browsers this build can read cookies from, in yt-dlp's own spelling.
 *
 *  Asked for rather than hard-coded here, so the list Settings offers and the
 *  list the backend accepts cannot drift apart. */
export const getCookieBrowsers = () => invoke<string[]>("cookie_browsers");

/** The videos behind a playlist link.
 *
 *  Separate from `probeUrl` because it is the slow half -- yt-dlp walking a
 *  whole list -- and it only runs once the user has asked for the whole thing
 *  rather than on every paste. */
export const listPlaylist = (url: string, cookiesFrom?: string) =>
  invoke<PlaylistListing>("list_playlist", { url, cookiesFrom });

/** Returns a job id immediately; the work reports itself through events. */
export const startDownload = (request: DownloadRequest) =>
  invoke<string>("start_download", { request });

export const cancelJob = (id: string) => invoke<void>("cancel_job", { id });

export const cancelAllJobs = () => invoke<void>("cancel_all_jobs");

/** Jobs the backend is still running. The webview reloads on every save in
 *  dev, and would otherwise lose track of work that is still going. */
export const listJobs = () => invoke<JobSummary[]>("list_jobs");

export const revealInFolder = (path: string) =>
  invoke<void>("reveal_in_folder", { path });

export const openPath = (path: string) => invoke<void>("open_path", { path });

export async function chooseFolder(defaultPath?: string) {
  const selected = await open({ directory: true, multiple: false, defaultPath });
  return typeof selected === "string" ? selected : null;
}

/** The names the file picker shows for its three filters, in the reader's
 *  language. They were hard-coded English inside a Persian dialog. */
export interface MediaFilterNames {
  media: string;
  video: string;
  audio: string;
}

export async function chooseMediaFile(defaultPath: string | undefined, names: MediaFilterNames) {
  const selected = await open({
    multiple: false,
    directory: false,
    defaultPath,
    filters: [
      { name: names.media, extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] },
      { name: names.video, extensions: VIDEO_EXTENSIONS },
      { name: names.audio, extensions: AUDIO_EXTENSIONS },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

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

/**
 * What is on the clipboard, or null.
 *
 * Through the plugin for the same reason as `copyText`, plus one of its own:
 * `navigator.clipboard.readText()` needs a user gesture and a permission prompt
 * in a browser, and the download form wants to look the moment it opens.
 *
 * Never throws. An empty clipboard, a clipboard holding an image, no native
 * window at all in `vite dev` -- all of them are "nothing to paste", which is
 * not a failure worth a toast when nobody asked for anything.
 */
export const readClipboardText = async (): Promise<string | null> => {
  try {
    return (await readText()) ?? null;
  } catch {
    return null;
  }
};

/**
 * Paints the native window and the webview's own base layer in the theme's
 * canvas colour.
 *
 * The webview has a background of its own, underneath the document, and a
 * resize repaints from that before any CSS applies. On Windows that showed as
 * a white flash across the whole window on every minimise and maximise in dark
 * mode -- the one frame where WebView2's default white was all there was to
 * draw. Setting it once per theme change means the worst case is a frame of
 * the right colour.
 *
 * Failure is ignored: this is cosmetic, and it is unavailable in a plain
 * browser (`vite dev` without Tauri) and on mobile.
 */
/** Never throws: no native window in `vite dev`, and a title is cosmetic. */
export const setWindowTitle = async (title: string) => {
  try {
    await getCurrentWindow().setTitle(title);
  } catch {
    // No native window to name.
  }
};

export const setWindowBackground = async (color: string) => {
  try {
    await getCurrentWindow().setBackgroundColor(color);
  } catch {
    // No native window to colour, or a webview that does not support it.
  }
};

export const onJobProgress = (
  handler: (payload: JobProgress) => void,
): Promise<UnlistenFn> =>
  listen<JobProgress>(PROGRESS_EVENT, ({ payload }) => handler(payload));

export const onJobStatus = (
  handler: (payload: JobStatusEvent) => void,
): Promise<UnlistenFn> =>
  listen<JobStatusEvent>(STATUS_EVENT, ({ payload }) => handler(payload));

export const onJobMeta = (
  handler: (payload: JobMetaEvent) => void,
): Promise<UnlistenFn> =>
  listen<JobMetaEvent>(META_EVENT, ({ payload }) => handler(payload));
