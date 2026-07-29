import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import { cn } from "../../../lib/cn";
import type { ToastType } from "../../../types/feedback";
import {
  FileDropZone,
  InstantBadge,
  OutputFolderRow,
  RunButton,
  ToolShell,
} from "../components/ToolShell";
import { useDragDropState } from "../useDragDropState";
import { defaultOutputName, useMediaJob } from "../useMediaJob";
import { useMediaFile } from "../useMediaFile";

const VIDEO_FORMATS = ["mp4", "mkv", "mov", "webm"] as const;
const AUDIO_FORMATS = ["mp3", "m4a", "wav"] as const;

interface Props {
  initialFile?: string;
  notify: (type: ToastType, message: string) => void;
}

/**
 * Two controls: the file and the target format.
 *
 * Picking an audio format IS "extract audio". There is no separate mode, no
 * checkbox and no second tool -- collapsing those two ideas into one grid is
 * the single biggest simplification in this app.
 */
export function ConvertScreen({ initialFile, notify }: Props) {
  const { t } = useTranslation();
  const file = useMediaFile(initialFile);
  const job = useMediaJob("convert", "start_convert", notify);
  const [format, setFormat] = useState<string>("mp4");
  const [instant, setInstant] = useState(false);
  const isDragging = useDragDropState(file.acceptDrop);

  useEffect(() => job.followInput(file.path), [file.path]);

  // Whether this particular conversion is a plain container swap, so the
  // promise of "instant, no quality loss" is only made when it is true.
  useEffect(() => {
    if (!file.path || !file.info) {
      setInstant(false);
      return;
    }
    let cancelled = false;
    void invoke<boolean>("can_copy_streams", { path: file.path, format })
      .then((value) => !cancelled && setInstant(value))
      .catch(() => !cancelled && setInstant(false));
    return () => {
      cancelled = true;
    };
  }, [file.path, file.info, format]);

  const ready = Boolean(file.path && file.info && job.outputDir && !job.busy);

  return (
    <ToolShell title={t("tool_convert")} subtitle={t("tool_convert_hint")}>
      <FileDropZone
        path={file.path}
        info={file.info}
        loading={file.loading}
        isDragging={isDragging}
        onBrowse={() => void file.browse()}
      />

      {file.info && (
        <div className="flex flex-col gap-4">
          <FormatGroup
            title={t("format_video")}
            formats={[...VIDEO_FORMATS]}
            value={format}
            onChange={setFormat}
            disabled={!file.info.video}
            disabledHint={t("no_video_track")}
          />
          <FormatGroup
            title={t("format_audio")}
            formats={[...AUDIO_FORMATS]}
            value={format}
            onChange={setFormat}
          />
          {instant && <InstantBadge text={t("instant_copy")} />}
        </div>
      )}

      <OutputFolderRow folder={job.outputDir} onChoose={() => void job.chooseFolder()} />

      <RunButton
        label={t("tool_convert")}
        disabled={!ready}
        onClick={() =>
          void job.run(
            {
              input: file.path,
              outputName: defaultOutputName(file.path),
              format,
            },
            `${defaultOutputName(file.path)}.${format}`,
            format.toUpperCase(),
          )
        }
      />
    </ToolShell>
  );
}

function FormatGroup({
  title,
  formats,
  value,
  onChange,
  disabled,
  disabledHint,
}: {
  title: string;
  formats: string[];
  value: string;
  onChange: (format: string) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-fg-soft">
        {title}
        {disabled && disabledHint && (
          <span className="ms-2 text-xs font-normal text-fg-muted">{disabledHint}</span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {formats.map((format) => (
          <button
            key={format}
            type="button"
            disabled={disabled}
            onClick={() => onChange(format)}
            className={cn(
              "rounded-sm border px-3 py-1.5 text-sm uppercase transition-colors duration-[--duration-fast]",
              "disabled:cursor-not-allowed disabled:opacity-40",
              value === format
                ? "border-accent-line bg-accent-soft font-medium text-accent"
                : "border-line bg-surface text-fg-soft hover:enabled:bg-surface-hover",
            )}
          >
            {format}
          </button>
        ))}
      </div>
    </div>
  );
}
