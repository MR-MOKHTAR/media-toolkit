import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../../lib/cn";
import { extensionOf } from "../../../lib/mediaKind";
import type { ToastType } from "../../../types/feedback";
import {
  FileDropZone,
  OutputFolderRow,
  RunButton,
  ToolShell,
} from "../components/ToolShell";
import { RangeSlider } from "../components/RangeSlider";
import { useDragDropState } from "../useDragDropState";
import { defaultOutputName, useMediaJob } from "../useMediaJob";
import { useMediaFile } from "../useMediaFile";

interface Props {
  initialFile?: string;
  notify: (type: ToastType, message: string) => void;
}

export function TrimScreen({ initialFile, notify }: Props) {
  const { t } = useTranslation();
  const file = useMediaFile(initialFile);
  const job = useMediaJob("trim", "start_trim", notify);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [exact, setExact] = useState(false);
  const isDragging = useDragDropState(file.acceptDrop);

  useEffect(() => job.followInput(file.path), [file.path]);
  useEffect(() => {
    if (file.info) setRange({ start: 0, end: file.info.durationSecs });
  }, [file.info]);

  const ready = Boolean(
    file.path &&
    file.info &&
    range.end > range.start &&
    job.outputDir &&
    !job.busy,
  );

  // Mirrors what the backend picks (media/ops.rs): a stream copy keeps the
  // source container, an exact cut has to re-encode and lands as MP4.
  const outputExt = exact ? "mp4" : (extensionOf(file.path ?? "") ?? "mp4");

  return (
    <ToolShell subtitle={t("tool_trim_about")}>
      <FileDropZone
        path={file.path}
        info={file.info}
        loading={file.loading}
        isDragging={isDragging}
        onBrowse={() => void file.browse()}
      />

      {file.info && file.info.durationSecs > 0 && (
        <>
          <RangeSlider
            durationSecs={file.info.durationSecs}
            start={range.start}
            end={range.end}
            onChange={(start, end) => setRange({ start, end })}
          />

          {/* One checkbox, off by default. A stream copy is instant and
              lossless but snaps to the nearest preceding keyframe, so the clip
              can begin a moment early -- said plainly rather than hidden. */}
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={exact}
              onChange={(event) => setExact(event.target.checked)}
              className={cn(
                "mt-0.5 size-4 shrink-0 rounded-sm border-line accent-accent",
              )}
            />
            <span className="flex flex-col">
              <span className="text-sm text-fg">{t("trim_exact")}</span>
              <span className="text-xs text-fg-muted">
                {exact ? t("trim_exact_hint") : t("trim_fast_hint")}
              </span>
            </span>
          </label>
        </>
      )}

      <OutputFolderRow
        folder={job.outputDir}
        onChoose={() => void job.chooseFolder()}
      />

      <RunButton
        label={t("tool_trim")}
        disabled={!ready}
        onClick={() =>
          void job.run(
            {
              input: file.path,
              outputName: `${defaultOutputName(file.path)}-clip`,
              startSecs: range.start,
              endSecs: range.end,
              exact,
            },
            `${defaultOutputName(file.path)}-clip.${outputExt}`,
            exact ? t("trim_exact") : t("trim_fast"),
          )
        }
      />
    </ToolShell>
  );
}
