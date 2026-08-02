import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Segmented } from "../../../components/ui/Segmented";
import { formatBytes } from "../../../lib/format";
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

/** The backend enforces this too; here it also bounds the slider so the limit
 *  is visible rather than a surprise at run time. */
const MAX_SECONDS = 15;

interface Props {
  initialFile?: string;
  language: string;
  notify: (type: ToastType, message: string) => void;
}

export function GifScreen({ initialFile, language, notify }: Props) {
  const { t } = useTranslation();
  const file = useMediaFile(initialFile);
  const job = useMediaJob("gif", "start_gif", notify);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [smooth, setSmooth] = useState(false);
  const isDragging = useDragDropState(file.acceptDrop);

  useEffect(() => job.followInput(file.path), [file.path]);
  useEffect(() => {
    if (file.info) {
      setRange({ start: 0, end: Math.min(MAX_SECONDS, file.info.durationSecs) });
    }
  }, [file.info]);

  const seconds = Math.max(0, range.end - range.start);
  // Rough, but enough to keep someone from producing a 200 MB GIF by accident.
  const width = smooth ? 480 : 360;
  const fps = smooth ? 15 : 10;
  const estimate = seconds * fps * width * (width * 0.5625) * 0.09;

  const ready = Boolean(
    file.path && file.info?.video && seconds > 0 && job.outputDir && !job.busy,
  );

  return (
    <ToolShell title={t("tool_gif")} subtitle={t("tool_gif_about")}>
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

      {file.info?.video && file.info.durationSecs > 0 && (
        <>
          <RangeSlider
            durationSecs={file.info.durationSecs}
            start={range.start}
            end={range.end}
            onChange={(start, end) => setRange({ start, end })}
            maxSpanSecs={MAX_SECONDS}
          />
          <Segmented
            label={t("tool_gif")}
            value={smooth ? "smooth" : "small"}
            onChange={(value) => setSmooth(value === "smooth")}
            options={[
              { value: "small", label: t("gif_small"), hint: "360p · 10fps" },
              { value: "smooth", label: t("gif_smooth"), hint: "480p · 15fps" },
            ]}
          />
          <p className="-mt-2 text-xs text-fg-muted tnum">
            ≈ {formatBytes(estimate, language)}
          </p>
        </>
      )}

      <OutputFolderRow folder={job.outputDir} onChoose={() => void job.chooseFolder()} />

      <RunButton
        label={t("tool_gif")}
        disabled={!ready}
        onClick={() =>
          void job.run(
            {
              input: file.path,
              outputName: defaultOutputName(file.path),
              startSecs: range.start,
              endSecs: range.end,
              smooth,
            },
            `${defaultOutputName(file.path)}.gif`,
            smooth ? t("gif_smooth") : t("gif_small"),
          )
        }
      />
    </ToolShell>
  );
}
