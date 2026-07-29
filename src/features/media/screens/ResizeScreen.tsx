import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Segmented } from "../../../components/ui/Segmented";
import type { ToastType } from "../../../types/feedback";
import {
  FileDropZone,
  OutputFolderRow,
  RunButton,
  ToolShell,
} from "../components/ToolShell";
import { useDragDropState } from "../useDragDropState";
import { defaultOutputName, useMediaJob } from "../useMediaJob";
import { useMediaFile } from "../useMediaFile";

const HEIGHTS = [1080, 720, 480] as const;

interface Props {
  initialFile?: string;
  notify: (type: ToastType, message: string) => void;
}

export function ResizeScreen({ initialFile, notify }: Props) {
  const { t } = useTranslation();
  const file = useMediaFile(initialFile);
  const job = useMediaJob("resize", "start_resize", notify);
  const [height, setHeight] = useState(720);
  const isDragging = useDragDropState(file.acceptDrop);

  useEffect(() => job.followInput(file.path), [file.path]);

  const sourceHeight = file.info?.video?.height ?? 0;
  // Upscaling makes a bigger file that looks no better, so those options are
  // disabled with the reason shown rather than silently missing.
  useEffect(() => {
    if (sourceHeight > 0 && height >= sourceHeight) {
      const fits = HEIGHTS.find((value) => value < sourceHeight);
      if (fits) setHeight(fits);
    }
  }, [sourceHeight, height]);

  const ready = Boolean(
    file.path && file.info?.video && height < sourceHeight && job.outputDir && !job.busy,
  );

  return (
    <ToolShell title={t("tool_resize")} subtitle={t("tool_resize_hint")} historyKind="resize">
      <FileDropZone
        path={file.path}
        info={file.info}
        loading={file.loading}
        isDragging={isDragging}
        onBrowse={() => void file.browse()}
      />

      {file.path && !file.loading && !file.info?.video && (
        <p className="text-sm text-danger">{t("needs_video")}</p>
      )}

      {file.info?.video && (
        <Segmented
          label={t("tool_resize")}
          value={String(height)}
          onChange={(value) => setHeight(Number(value))}
          options={HEIGHTS.map((value) => ({
            value: String(value),
            label: `${value}p`,
            disabled: value >= sourceHeight,
            disabledReason: value >= sourceHeight ? t("already_smaller") : undefined,
          }))}
        />
      )}

      <OutputFolderRow folder={job.outputDir} onChoose={() => void job.chooseFolder()} />

      <RunButton
        label={t("tool_resize")}
        disabled={!ready}
        onClick={() =>
          void job.run(
            {
              input: file.path,
              outputName: `${defaultOutputName(file.path)}-${height}p`,
              height,
            },
            `${defaultOutputName(file.path)}-${height}p.mp4`,
            `${height}p`,
          )
        }
      />
    </ToolShell>
  );
}
