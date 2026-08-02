/**
 * Everything the download screen needs that is not the job queue itself:
 * the save folder, whether the tools are present, and the pre-flight checks.
 *
 * What used to live here and no longer does: the YouTube URL check (yt-dlp
 * supports around a thousand sites and the backend now accepts any http URL),
 * and the "one download at a time" guard, which existed only because the
 * backend had a single process slot.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import * as ipc from "../../lib/ipc";
import type { ToastType } from "../../types/feedback";
import { describeAppError } from "../jobs/errorText";
import { useJobs } from "../jobs/useJobs";
import type { DownloadRequest } from "../jobs/types";

interface Options {
  isOnline: boolean;
  notify: (type: ToastType, message: string) => void;
}

export interface DownloadFormValues {
  url: string;
  filename: string;
  mediaType: "video" | "audio";
  quality: string;
}

export function useDownloadForm({ isOnline, notify }: Options) {
  const { t } = useTranslation();
  const { startDownload } = useJobs();
  const [savePath, setSavePath] = useState("");
  const [toolsReady, setToolsReady] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [path, tools] = await Promise.all([
          ipc.getDefaultDownloadPath(),
          ipc.getToolStatus(),
        ]);
        if (cancelled) return;
        setSavePath(path);
        setToolsReady(tools.ytdlp);
        if (!tools.ytdlp) notify("warning", t("ytdlp_not_found"));
      } catch (error) {
        if (!cancelled) notify("error", describeAppError(ipc.toAppError(error), t));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify, t]);

  const selectFolder = useCallback(async () => {
    try {
      const selected = await ipc.chooseFolder(savePath);
      if (selected) setSavePath(selected);
    } catch {
      notify("error", t("error_selecting_folder"));
    }
  }, [notify, savePath, t]);

  const start = useCallback(
    (values: DownloadFormValues, onSuccess: () => void): boolean => {
      const url = values.url.trim();
      if (!url) {
        notify("error", t("invalid_url"));
        return false;
      }
      if (!savePath.trim()) {
        notify("error", t("select_location"));
        return false;
      }
      if (!isOnline) {
        notify("error", t("no_internet"));
        return false;
      }
      if (!toolsReady) {
        notify("warning", t("ytdlp_not_found"));
        return false;
      }

      const request: DownloadRequest = {
        url,
        outputDir: savePath,
        outputName: values.filename.trim() || undefined,
        mediaType: values.mediaType,
        quality: values.mediaType === "audio" ? undefined : values.quality,
      };

      void startDownload(request, {
        title: values.filename.trim() || url,
        source: url,
        detail: values.mediaType === "audio" ? "MP3" : values.quality,
      }).catch((error) => notify("error", describeAppError(ipc.toAppError(error), t)));

      notify("info", t("job_started"));
      onSuccess();
      return true;
    },
    [isOnline, notify, savePath, startDownload, t, toolsReady],
  );

  return { savePath, toolsReady, selectFolder, start };
}

