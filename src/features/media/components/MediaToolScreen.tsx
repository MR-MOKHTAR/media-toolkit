import {
  useEffect,
  useState,
  type ComponentType,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { ToastType } from "../../../types/feedback";
import type { JobKind } from "../../jobs/types";
import { useDragDropState } from "../useDragDropState";
import { useMediaFile, type MediaInfo } from "../useMediaFile";
import { useMediaJob } from "../useMediaJob";
import { FileDropZone, OutputFolderRow, RunButton, ToolShell } from "./ToolShell";

/** The tools that are a file in, a file out. Download has no input file and
 *  transcribe has a whole second screen for its result, so neither of the two
 *  is one of these. */
export type MediaToolKind = Exclude<JobKind, "download" | "transcribe">;

/** What the input has to be before the tool can do anything with it. */
type Requirement = "media" | "video";

/** Everything a tool's own parts are given. The file and the output folder are
 *  the screen's; `state` is the tool's, and is the only thing that differs
 *  between one tab and the next. */
export interface MediaToolContext<S> {
  path: string | null;
  info: MediaInfo | null;
  state: S;
  setState: Dispatch<SetStateAction<S>>;
  language: string;
}

/** One tool, as data. */
export interface MediaToolConfig<S> {
  kind: MediaToolKind;
  /** The Tauri command that starts it. */
  command: string;
  requires: Requirement;
  initialState: S;
  /**
   * The controls between the file and the output folder -- the whole of what
   * makes this tool itself.
   *
   * A component rather than a render function, so a tool that needs an effect
   * of its own (the compress estimate, the convert stream-copy check, a range
   * that follows the file's duration) can hold it legally instead of pushing
   * it up into a screen it would then have to have.
   */
  Controls: ComponentType<MediaToolContext<S>>;
  /** Anything beyond a usable input and an output folder. Called only when
   *  those already hold. */
  isReady?: (context: MediaToolContext<S>) => boolean;
  /** The arguments for `command`, the name to show in the job list, and the
   *  one-word detail beside it. `outputDir` is added by `useMediaJob`. */
  toRequest: (
    context: MediaToolContext<S> & { t: TFunction },
  ) => { args: Record<string, unknown>; title: string; detail?: string };
}

/**
 * A config with its state type erased.
 *
 * The registry holds five different state shapes, and this screen only ever
 * carries one of them from `Controls` to `toRequest` -- it never looks inside.
 * A union of the five would not work: `S` appears in both argument and return
 * position, so the union of those signatures accepts nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMediaToolConfig = MediaToolConfig<any>;

interface Props {
  config: AnyMediaToolConfig;
  initialFile?: string;
  language: string;
  notify: (type: ToastType, message: string) => void;
}

/**
 * The tool screen. Singular.
 *
 * Every one of these tools is the same form -- file, preview, two or three
 * controls, output folder, run -- and each used to be written out again in its
 * own file: the same drop zone, the same "follow the input folder" effect, the
 * same ready check assembled from the same four conditions, the same output
 * row, the same button. Five copies of a layout drift, and they had: one screen
 * spaced its hint with `-mt-2`, another with `-mt-1`, a third not at all.
 *
 * Now the sidebar switches `config` and nothing else. What a tool contributes
 * is its controls, its readiness, and the request it builds; the box around
 * them is this file, once.
 *
 * Keyed by tool in App, so switching tabs starts with a clean form rather than
 * carrying the previous tool's state into a control that means something else.
 */
export function MediaToolScreen({ config, initialFile, language, notify }: Props) {
  const { t } = useTranslation();
  const file = useMediaFile(initialFile);
  const job = useMediaJob(config.kind, config.command, notify);
  const [state, setState] = useState(config.initialState);
  const isDragging = useDragDropState(file.acceptDrop);

  useEffect(() => job.followInput(file.path), [file.path]);

  const context: MediaToolContext<unknown> = {
    path: file.path,
    info: file.info,
    state,
    setState,
    language,
  };

  // ffprobe answered and the answer was usable. Audio-only input is fine for
  // everything but the two tools that have to have pixels to work on.
  const meetsRequirement = Boolean(
    config.requires === "video"
      ? file.info?.video
      : file.info?.video || file.info?.audio,
  );

  const ready = Boolean(
    file.path &&
      meetsRequirement &&
      job.outputDir &&
      !job.busy &&
      (config.isReady?.(context) ?? true),
  );

  return (
    <ToolShell subtitle={t(`tool_${config.kind}_about`)}>
      <FileDropZone
        path={file.path}
        info={file.info}
        loading={file.loading}
        isDragging={isDragging}
        onBrowse={() => void file.browse()}
      />

      {/* Only once probing has finished: during the read there is nothing to
          refuse yet, and saying so early made every file selection flash a
          red line before the metadata arrived. */}
      {file.path && !file.loading && !meetsRequirement && (
        <p className="text-sm text-danger">
          {t(config.requires === "video" ? "needs_video" : "needs_media")}
        </p>
      )}

      {meetsRequirement && <config.Controls {...context} />}

      <OutputFolderRow
        folder={job.outputDir}
        onChoose={() => void job.chooseFolder()}
      />

      <RunButton
        label={t(`tool_${config.kind}`)}
        disabled={!ready}
        onClick={() => {
          const { args, title, detail } = config.toRequest({ ...context, t });
          void job.run(args, title, detail);
        }}
      />
    </ToolShell>
  );
}
