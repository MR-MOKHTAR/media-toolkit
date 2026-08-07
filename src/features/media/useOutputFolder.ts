import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import * as ipc from "../../lib/ipc";
import type { ToastType } from "../../types/feedback";
import { SLOT_FOR_KIND, type JobKind } from "../jobs/types";

/**
 * Where a tool's result gets written.
 *
 * Defaults to this tool's shelf in the app's library --
 * `~/Downloads/Media Toolkit/Compressed` and so on. It used to default to the
 * folder the input came from, which scattered results across wherever the user
 * happened to keep their videos; that behaviour is still available as a
 * setting, and when it is on it wins here too.
 *
 * Its own hook rather than part of `useMediaJob`, so a screen that needs only
 * this half -- somewhere to write, honouring "save next to the source file" --
 * can have it without an ffmpeg command to invoke or a job to register.
 */
export function useOutputFolder(
  kind: Exclude<JobKind, "download">,
  notify: (type: ToastType, message: string) => void,
) {
  const { t } = useTranslation();
  const [outputDir, setOutputDir] = useState("");
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

  return { outputDir, followInput, chooseFolder };
}

/** The folder a file sits in, or null when the path has none to speak of.
 *  Handles both separators: a Windows path never reaches a Unix `dirname`. */
function parentOf(path: string | null) {
  if (!path) return null;
  const parent = path.replace(/[/\\][^/\\]+$/, "");
  return parent && parent !== path ? parent : null;
}
