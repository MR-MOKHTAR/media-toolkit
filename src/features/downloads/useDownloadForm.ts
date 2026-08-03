/**
 * Everything the download screen needs that is not the job queue itself:
 * the save folder, whether the tools are present, and the pre-flight checks.
 *
 * What used to live here and no longer does: the YouTube URL check (yt-dlp
 * supports around a thousand sites and the backend now accepts any http URL),
 * and the "one download at a time" guard, which existed only because the
 * backend had a single process slot.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import * as ipc from "../../lib/ipc";
import type { ToastType } from "../../types/feedback";
import { describeAppError } from "../jobs/errorText";
import { useJobs } from "../jobs/useJobs";
import type { DownloadRequest } from "../jobs/types";

interface Options {
  isOnline: boolean;
  notify: (type: ToastType, message: string) => void;
  /** Video and audio land on different shelves of the library, so the save
   *  folder tracks the toggle on the form. */
  mediaType: "video" | "audio";
}

export interface DownloadFormValues {
  url: string;
  filename: string;
  mediaType: "video" | "audio";
  quality: string;
}

export function useDownloadForm({ isOnline, notify, mediaType }: Options) {
  const { t } = useTranslation();
  const { startDownload } = useJobs();
  const [savePath, setSavePath] = useState("");
  const [toolsReady, setToolsReady] = useState(true);
  /** Once the user has picked a folder, switching video/audio must not move it
   *  back under them. */
  const chosen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tools = await ipc.getToolStatus();
        if (cancelled) return;
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

  // Separate from the tool check because it re-runs on the media toggle, and
  // re-probing yt-dlp for that would be two seconds of nothing.
  useEffect(() => {
    if (chosen.current) return;
    let cancelled = false;
    void ipc
      .getLibraryFolder(mediaType === "audio" ? "audio" : "video")
      .then((folder) => {
        if (!cancelled && !chosen.current) setSavePath(folder);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mediaType]);

  const selectFolder = useCallback(async () => {
    try {
      const selected = await ipc.chooseFolder(savePath);
      if (selected) {
        chosen.current = true;
        setSavePath(selected);
      }
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

