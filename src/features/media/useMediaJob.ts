import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import * as ipc from "../../lib/ipc";
import { fileNameOf } from "../../lib/format";
import type { ToastType } from "../../types/feedback";
import { describeAppError } from "../jobs/errorText";
import { SLOT_FOR_KIND, type JobKind } from "../jobs/types";
import { useHistoryPanel } from "../jobs/useHistoryPanel";
import { useJobs } from "../jobs/useJobs";

/**
 * Starting a media job, shared by all five tools.
 *
 * Also owns the output folder, which defaults to this tool's shelf in the app's
 * library -- `~/Downloads/Media Toolkit/Compressed` and so on. It used to
 * default to the folder the input came from, which scattered results across
 * wherever the user happened to keep their videos; that behaviour is still
 * available as a setting, and when it is on it wins here too.
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
  const [outputDir, setOutputDir] = useState("");
  const [busy, setBusy] = useState(false);
  /** Null until the settings answer arrives; `followInput` waits rather than
   *  guessing, because guessing wrong moves the user's file somewhere else. */
  const nextToInput = useRef<boolean | null>(null);
  /** The loaded file, remembered so a screen opened with one already in hand
   *  is not stuck with the library folder when the setting turns out to say
   *  otherwise -- the file arrives before the setting does. */
  const inputPath = useRef<string | null>(null);
  /** The path the user picked by hand this session. Once they have, nothing
   *  else -- not loading a file, not remounting -- moves it back. */
  const chosen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [folder, info] = await Promise.all([
          ipc.getLibraryFolder(SLOT_FOR_KIND[kind]),
          ipc.getLibraryInfo(),
        ]);
        if (cancelled || chosen.current) return;
        nextToInput.current = info.saveNextToInput;
        const beside = info.saveNextToInput ? parentOf(inputPath.current) : null;
        setOutputDir(beside ?? folder);
      } catch {
        // The screen still works: the folder row shows "choose where to save"
        // and the Run button stays disabled until one is picked.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  /** Points the output at the source's folder once a file is chosen -- only
   *  when the user has asked for that, and never over a folder they picked. */
  const followInput = useCallback((path: string | null) => {
    inputPath.current = path;
    if (!nextToInput.current || chosen.current) return;
    const parent = parentOf(path);
    if (parent) setOutputDir(parent);
  }, []);

  const chooseFolder = useCallback(async () => {
    try {
      const selected = await ipc.chooseFolder(outputDir);
      if (selected) {
        chosen.current = true;
        setOutputDir(selected);
      }
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

  return { outputDir, followInput, chooseFolder, run, busy };
}

/** The folder a file sits in, or null when the path has none to speak of.
 *  Handles both separators: a Windows path never reaches a Unix `dirname`. */
function parentOf(path: string | null) {
  if (!path) return null;
  const parent = path.replace(/[/\\][^/\\]+$/, "");
  return parent && parent !== path ? parent : null;
}

/** Kept as the name every screen already imports; the wording itself lives in
 *  one place now, shared with the job card. */
export const describe = describeAppError;

export const defaultOutputName = (path: string | null) =>
  path ? fileNameOf(path).replace(/\.[^.]+$/, "") : "";
