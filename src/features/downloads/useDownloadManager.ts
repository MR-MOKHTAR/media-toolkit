import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import {
  cancelActiveDownload,
  chooseDownloadFolder,
  downloadMedia,
  getDownloadSetup,
  revealInFolder,
  subscribeToDownloadProgress,
} from "./downloadApi";
import { downloadReducer } from "./downloadReducer";
import { loadStoredDownloads, saveDownloads } from "./storage";
import type { ToastType } from "../../types/feedback";
import type { DownloadItem, DownloadRequest } from "./types";
import { fileNameFromPath, isYoutubeUrl } from "./utils";

interface UseDownloadManagerOptions {
  isOnline: boolean;
  notify: (type: ToastType, message: string) => void;
}

export function useDownloadManager({ isOnline, notify }: UseDownloadManagerOptions) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    downloadReducer,
    undefined,
    () => ({
      items: loadStoredDownloads(),
      activeId: null,
      selectedId: null,
      isCancelling: false,
    }),
  );
  const [savePath, setSavePath] = useState("");
  const [ytdlpReady, setYtdlpReady] = useState(true);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    saveDownloads(state.items);
  }, [state.items]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    subscribeToDownloadProgress((payload) => {
      const id = activeIdRef.current;
      if (id) dispatch({ type: "progress", id, payload });
    })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
          return;
        }
        unlisten = stopListening;
      })
      .catch((error) => {
        if (!disposed) console.error(error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    getDownloadSetup()
      .then(({ defaultPath, ytdlpReady: ready }) => {
        if (disposed) return;
        setSavePath(defaultPath);
        setYtdlpReady(ready);
        if (!ready) notify("warning", i18n.t("ytdlp_not_found"));
      })
      .catch((error) => {
        if (!disposed) notify("error", String(error));
      });

    return () => {
      disposed = true;
    };
  }, [notify]);

  const selectFolder = useCallback(async () => {
    try {
      const selectedFolder = await chooseDownloadFolder(savePath);
      if (selectedFolder) setSavePath(selectedFolder);
    } catch (error) {
      notify("error", `${t("error_selecting_folder")}: ${String(error)}`);
    }
  }, [notify, savePath, t]);

  const revealDownload = useCallback(async (item: DownloadItem) => {
    dispatch({ type: "select", id: item.id });
    if (item.status !== "completed" || !item.filePath) return;

    try {
      await revealInFolder(item.filePath);
    } catch (error) {
      notify("error", `${t("error_opening_folder")}: ${String(error)}`);
    }
  }, [notify, t]);

  const executeDownload = useCallback(async (
    item: DownloadItem,
    baseName: string,
    onSuccess: () => void,
  ) => {
    try {
      const result = await downloadMedia({
        url: item.url,
        outputPath: item.savePath,
        filename: baseName,
        downloadType: item.type,
        quality: item.quality,
      });

      if (result.success) {
        dispatch({
          type: "complete",
          id: item.id,
          filePath: result.file_path,
          name: result.file_path ? fileNameFromPath(result.file_path) : undefined,
        });
        onSuccess();
        notify("success", t("success"));
      } else {
        const cancelled = result.message === "Download cancelled";
        dispatch({
          type: "set_terminal",
          id: item.id,
          status: cancelled ? "cancelled" : "failed",
        });
        notify(
          cancelled ? "info" : "error",
          cancelled ? t("download_cancelled") : result.message,
        );
      }
    } catch (error) {
      dispatch({ type: "set_terminal", id: item.id, status: "failed" });
      notify("error", String(error));
    } finally {
      activeIdRef.current = null;
      dispatch({ type: "finish" });
    }
  }, [notify, t]);

  const startDownload = useCallback((
    request: DownloadRequest,
    onSuccess: () => void,
  ): boolean => {
    if (!isYoutubeUrl(request.url.trim())) {
      notify("error", t("invalid_url"));
      return false;
    }
    if (!request.savePath.trim()) {
      notify("error", t("select_location"));
      return false;
    }
    if (!isOnline) {
      notify("error", t("no_internet"));
      return false;
    }
    if (!ytdlpReady) {
      notify("warning", t("ytdlp_not_found"));
      return false;
    }
    if (activeIdRef.current) {
      notify("info", t("one_download_at_a_time"));
      return false;
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const baseName = request.filename.trim() ||
      `YouTube-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
    const item: DownloadItem = {
      id,
      name: `${baseName}.${request.downloadType === "audio" ? "mp3" : "mp4"}`,
      url: request.url.trim(),
      savePath: request.savePath,
      type: request.downloadType,
      quality: request.downloadType === "audio" ? "default" : request.quality,
      status: "preparing",
      progress: 0,
      size: "—",
      speed: "—",
      eta: "—",
      createdAt: Date.now(),
    };

    activeIdRef.current = id;
    dispatch({ type: "add", item });
    notify("info", t("download_added"));
    void executeDownload(item, baseName, onSuccess);
    return true;
  }, [executeDownload, isOnline, notify, t, ytdlpReady]);

  const cancelDownload = useCallback(async () => {
    if (!activeIdRef.current) return;
    dispatch({ type: "cancelling", value: true });

    try {
      await cancelActiveDownload();
    } catch (error) {
      dispatch({ type: "cancelling", value: false });
      notify("error", String(error));
    }
  }, [notify]);

  const removeDownload = useCallback((id: string) => {
    if (id === activeIdRef.current) return;
    dispatch({ type: "remove", id });
    notify("info", t("removed_from_history"));
  }, [notify, t]);

  return {
    downloads: state.items,
    activeId: state.activeId,
    selectedId: state.selectedId,
    isCancelling: state.isCancelling,
    isDownloading: state.activeId !== null,
    savePath,
    ytdlpReady,
    selectFolder,
    revealDownload,
    startDownload,
    cancelDownload,
    removeDownload,
  };
}
