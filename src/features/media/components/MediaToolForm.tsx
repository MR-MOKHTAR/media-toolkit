import {
  useEffect,
  useState,
  type ComponentType,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { Disclosure } from "../../../components/ui/Disclosure";
import { Modal } from "../../../components/ui/Modal";
import type { ToastType } from "../../../types/feedback";
import { describeAppError } from "../../jobs/errorText";
import type { JobKind } from "../../jobs/types";
import { useDragDropState } from "../useDragDropState";
import { useMediaFile, type MediaInfo } from "../useMediaFile";
import { useMediaJob } from "../useMediaJob";
import { FileDropZone, OutputFolderRow, RunButton } from "./ToolFormParts";

export type MediaToolKind = Exclude<JobKind, "download">;

type Requirement = "media" | "video" | "audio";

const MEETS: Record<Requirement, (info: MediaInfo) => boolean> = {
  media: (info) => Boolean(info.video || info.audio),
  video: (info) => Boolean(info.video),
  audio: (info) => Boolean(info.audio),
};

export interface MediaToolContext<S> {
  path: string | null;
  info: MediaInfo | null;
  state: S;
  setState: Dispatch<SetStateAction<S>>;
  language: string;
  folderRow: ReactNode;
}

export interface MediaToolConfig<S> {
  kind: MediaToolKind;
  command: string;
  requires: Requirement;
  initialState: S;
  Controls: ComponentType<MediaToolContext<S>>;
  /** When true, Controls renders `folderRow` inside its own `More options`. */
  handlesFolderRow?: boolean;
  isReady?: (context: MediaToolContext<S>) => boolean;
  toRequest: (
    context: MediaToolContext<S> & { t: TFunction },
  ) => { args: Record<string, unknown>; title: string; detail?: string };
  wide?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMediaToolConfig = MediaToolConfig<any>;

interface Props {
  config: AnyMediaToolConfig;
  initialFile?: string;
  language: string;
  notify: (type: ToastType, message: string) => void;
  onDone: () => void;
}

export function MediaToolForm({
  config,
  initialFile,
  language,
  notify,
  onDone,
}: Props) {
  const { t } = useTranslation();
  const file = useMediaFile(initialFile);
  const job = useMediaJob(config.kind, config.command, notify);
  const [state, setState] = useState(config.initialState);
  const [moreOpen, setMoreOpen] = useState(false);
  const isDragging = useDragDropState(file.acceptDrop);

  useEffect(() => job.followInput(file.path), [file.path]);

  const folderRow = (
    <OutputFolderRow
      folder={job.outputDir}
      onChoose={() => void job.chooseFolder()}
    />
  );

  const context: MediaToolContext<unknown> = {
    path: file.path,
    info: file.info,
    state,
    setState,
    language,
    folderRow,
  };

  const meetsRequirement = Boolean(
    file.info && MEETS[config.requires](file.info),
  );

  const ready = Boolean(
    file.path &&
      meetsRequirement &&
      job.outputDir &&
      !job.busy &&
      (config.isReady?.(context) ?? true),
  );

  return (
    <Modal
      open
      wide={config.wide}
      keepOnOutsideClick={Boolean(file.path)}
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      title={t(`tool_${config.kind}`)}
      footer={
        <RunButton
          label={t(`tool_${config.kind}`)}
          disabled={!ready}
          onClick={() => {
            const { args, title, detail } = config.toRequest({ ...context, t });
            onDone();
            void job.run(args, title, detail);
          }}
        />
      }
    >
      <FileDropZone
        path={file.path}
        info={file.info}
        loading={file.loading}
        isDragging={isDragging}
        onBrowse={() => void file.browse()}
      />

      {file.path && !file.loading && !meetsRequirement && (
        <p className="text-sm text-danger-text">
          {file.error
            ? t("file_read_failed", { reason: describeAppError(file.error, t) })
            : t(`needs_${config.requires}`)}
        </p>
      )}

      {meetsRequirement && <config.Controls {...context} />}

      {meetsRequirement && !config.handlesFolderRow && (
        <Disclosure
          label={t("more_options")}
          open={moreOpen}
          onOpenChange={setMoreOpen}
        >
          {folderRow}
        </Disclosure>
      )}
    </Modal>
  );
}
