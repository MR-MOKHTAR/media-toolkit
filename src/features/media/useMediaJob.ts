import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import * as ipc from "../../lib/ipc";
import { fileNameOf } from "../../lib/format";
import type { ToastType } from "../../types/feedback";
import { describeAppError } from "../jobs/errorText";
import type { JobKind } from "../jobs/types";
import { useHistoryPanel } from "../jobs/useHistoryPanel";
import { useJobs } from "../jobs/useJobs";
import { useOutputFolder } from "./useOutputFolder";

/**
 * Starting a media job, shared by every tool that runs one.
 *
 * The output folder is `useOutputFolder`'s -- the half of this that stands on
 * its own -- and it is returned from here unchanged so the screens that read
 * `job.outputDir` and call `job.followInput` see no difference.
 */
export function useMediaJob(
  kind: Exclude<JobKind, "download">,
  command: string,
  notify: (type: ToastType, message: string) => void,
  /**
   * Whether starting the job opens this tool's history panel.
   *
   * True for every tool that produces a file: the form has nothing more to show,
   * and the panel is where the progress bar for what was just started appears.
   * The screen itself stays put -- it used to navigate to Tasks instead, which
   * threw away the loaded file and the chosen settings to show a list of every
   * tool's work. Transcribe passes false: its result is text, and it shows that
   * text in place.
   */
  { openHistoryOnStart = true }: { openHistoryOnStart?: boolean } = {},
) {
  const { t } = useTranslation();
  const { addExternalJob } = useJobs();
  const { openPanel } = useHistoryPanel();
  const folder = useOutputFolder(kind, notify);
  const [busy, setBusy] = useState(false);
  const { outputDir } = folder;

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
        if (openHistoryOnStart) openPanel();
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
    [
      addExternalJob,
      command,
      kind,
      notify,
      openHistoryOnStart,
      openPanel,
      outputDir,
      t,
    ],
  );

  return { ...folder, run, busy };
}

/** Kept as the name every screen already imports; the wording itself lives in
 *  one place now, shared with the job card. */
export const describe = describeAppError;

export const defaultOutputName = (path: string | null) =>
  path ? fileNameOf(path).replace(/\.[^.]+$/, "") : "";
