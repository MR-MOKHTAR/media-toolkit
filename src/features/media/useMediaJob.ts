import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import * as ipc from "../../lib/ipc";
import { fileNameOf } from "../../lib/format";
import type { ToastType } from "../../types/feedback";
import { describeAppError } from "../jobs/errorText";
import type { JobKind } from "../jobs/types";
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
) {
  const { t } = useTranslation();
  const { beginJob, discardJob, addExternalJob } = useJobs();
  const folder = useOutputFolder(kind, notify);
  const [busy, setBusy] = useState(false);
  const { outputDir } = folder;

  const run = useCallback(
    async (request: Record<string, unknown>, title: string, detail?: string) => {
      setBusy(true);
      const source = String(request.input ?? "");
      // The dialog has already closed -- see `MediaToolForm` -- and every media
      // command probes its input with ffprobe before it hands back an id. The
      // row goes up now and is filled in when it does; the file name is known
      // here, so the only thing the placeholder is missing is the progress it
      // does not have yet.
      const placeholderId = beginJob({ kind, title, source, detail });
      try {
        const id = await invoke<string>(command, {
          request: { ...request, outputDir },
        });
        addExternalJob({ id, kind, title, source, detail, placeholderId });
        notify("info", t("job_started"));
        return id;
      } catch (raw) {
        // The typed error carries the real reason -- an unreadable file, a
        // range that makes no sense, a key that is not there -- instead of an
        // exit code.
        discardJob(placeholderId);
        notify("error", describe(ipc.toAppError(raw), t));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [addExternalJob, beginJob, command, discardJob, kind, notify, outputDir, t],
  );

  return { ...folder, run, busy };
}

/** Kept as the name every screen already imports; the wording itself lives in
 *  one place now, shared with the job card. */
export const describe = describeAppError;

export const defaultOutputName = (path: string | null) =>
  path ? fileNameOf(path).replace(/\.[^.]+$/, "") : "";
