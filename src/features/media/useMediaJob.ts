import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import * as ipc from "../../lib/ipc";
import { fileNameOf } from "../../lib/format";
import type { ToastType } from "../../types/feedback";
import type { JobKind } from "../jobs/types";
import { useJobs } from "../jobs/useJobs";

/**
 * Starting a media job, shared by all five tools.
 *
 * Also owns the output folder, which defaults to the folder the input came
 * from -- that is where people expect the result, and it means the common case
 * needs no interaction at all.
 */
export function useMediaJob(
  kind: JobKind,
  command: string,
  notify: (type: ToastType, message: string) => void,
) {
  const { t } = useTranslation();
  const { addExternalJob } = useJobs();
  const { go } = useNavigation();
  const [outputDir, setOutputDir] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (outputDir) return;
    void ipc.getDefaultDownloadPath().then(setOutputDir).catch(() => undefined);
  }, [outputDir]);

  /** Defaults the output next to the source once a file is chosen. */
  const followInput = useCallback((path: string | null) => {
    if (!path) return;
    const parent = path.replace(/[/\\][^/\\]+$/, "");
    if (parent && parent !== path) setOutputDir(parent);
  }, []);

  const chooseFolder = useCallback(async () => {
    try {
      const selected = await ipc.chooseFolder(outputDir);
      if (selected) setOutputDir(selected);
    } catch {
      notify("error", t("error_selecting_folder"));
    }
  }, [notify, outputDir, t]);

  const run = useCallback(
    async (request: Record<string, unknown>, title: string, detail?: string) => {
      setBusy(true);
      try {
        const id = await invoke<string>(command, {
          request: { ...request, outputDir },
        });
        addExternalJob({
          id,
          kind,
          title,
          source: String(request.input ?? ""),
          detail,
        });
        notify("info", t("job_started"));
        go({ name: "jobs" });
      } catch (raw) {
        // The typed error carries the real reason -- an unreadable file, a
        // range that makes no sense -- instead of an exit code.
        notify("error", describe(ipc.toAppError(raw), t));
      } finally {
        setBusy(false);
      }
    },
    [addExternalJob, command, go, kind, notify, outputDir, t],
  );

  return { outputDir, setOutputDir, followInput, chooseFolder, run, busy };
}

export function describe(
  error: ReturnType<typeof ipc.toAppError>,
  t: (key: string) => string,
): string {
  switch (error.kind) {
    case "toolMissing":
      return t("ffmpeg_not_found");
    case "invalidInput":
      return error.reason;
    case "tool":
      return error.tail.split("\n").filter(Boolean).pop() ?? t("job_failed");
    case "io":
    case "spawn":
      return error.message;
    case "cancelled":
      return t("status_cancelled");
    default:
      return t("job_failed");
  }
}

export const defaultOutputName = (path: string | null) =>
  path ? fileNameOf(path).replace(/\.[^.]+$/, "") : "";
