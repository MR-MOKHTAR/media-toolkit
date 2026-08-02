import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import * as ipc from "../../lib/ipc";
import { fileNameOf } from "../../lib/format";
import type { ToastType } from "../../types/feedback";
import { describeAppError } from "../jobs/errorText";
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
  /**
   * Whether starting the job hands the user off to Tasks.
   *
   * True for every tool that produces a file to open somewhere else -- there is
   * nothing more to see on the form. Transcribe passes false: its result is
   * text, and it shows that text in place.
   */
  { navigateOnStart = true }: { navigateOnStart?: boolean } = {},
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
        if (navigateOnStart) go({ name: "jobs" });
        return id;
      } catch (raw) {
        // The typed error carries the real reason -- an unreadable file, a
        // range that makes no sense, a key that is not there -- instead of an
        // exit code.
        notify("error", describe(ipc.toAppError(raw), t));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [addExternalJob, command, go, kind, navigateOnStart, notify, outputDir, t],
  );

  return { outputDir, setOutputDir, followInput, chooseFolder, run, busy };
}

/** Kept as the name every screen already imports; the wording itself lives in
 *  one place now, shared with the job card. */
export const describe = describeAppError;

export const defaultOutputName = (path: string | null) =>
  path ? fileNameOf(path).replace(/\.[^.]+$/, "") : "";
