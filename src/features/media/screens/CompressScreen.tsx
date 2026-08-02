import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { useDragDropState } from "../useDragDropState";
import { defaultOutputName, useMediaJob } from "../useMediaJob";
import { useMediaFile } from "../useMediaFile";

type Preset = "small" | "balanced" | "high";

interface Props {
  initialFile?: string;
  language: string;
  notify: (type: ToastType, message: string) => void;
}

/**
 * Three controls: the file, the preset, the output folder.
 *
 * No CRF field, no encoder preset dropdown, no codec picker. Someone who wants
 * a smaller video wants "smaller", not a rate factor.
 */
export function CompressScreen({ initialFile, language, notify }: Props) {
  const { t } = useTranslation();
  const file = useMediaFile(initialFile);
  const job = useMediaJob("compress", "start_compress", notify);
  const [preset, setPreset] = useState<Preset>("balanced");
  const [estimates, setEstimates] = useState<Partial<Record<Preset, number>>>({});
  const isDragging = useDragDropState(file.acceptDrop);

  useEffect(() => job.followInput(file.path), [file.path]);

  // The whole reason the estimate exists: choosing between Small and Balanced
  // without having to run both.
  useEffect(() => {
    if (!file.path || !file.info) return;
    let cancelled = false;
    const path = file.path;

    void Promise.all(
      (["small", "balanced", "high"] as Preset[]).map((value) =>
        invoke<number>("estimate_compressed_size", {
          path,
          preset: value,
          maxHeight: value === "small" ? 720 : null,
        })
          .then((bytes) => [value, bytes] as const)
          .catch(() => [value, 0] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setEstimates(Object.fromEntries(pairs.filter(([, bytes]) => bytes > 0)));
    });

    return () => {
      cancelled = true;
    };
  }, [file.path, file.info]);

  // Audio-only input is fine here. The file picker has always offered audio
  // extensions, so requiring a video stream meant the app handed the user an
  // MP3 it then refused to work on.
  const isAudioOnly = Boolean(file.info && !file.info.video && file.info.audio);
  const isMedia = Boolean(file.info?.video || file.info?.audio);
  const ready = Boolean(file.path && isMedia && job.outputDir && !job.busy);

  return (
    <ToolShell title={t("tool_compress")} subtitle={t("tool_compress_about")}>
      <FileDropZone
        path={file.path}
        info={file.info}
        loading={file.loading}
        isDragging={isDragging}
        onBrowse={() => void file.browse()}
      />

      {file.path && !file.loading && !isMedia && (
        <p className="text-sm text-danger">{t("needs_media")}</p>
      )}

      {isMedia && file.info && (
        <>
          <Segmented
            label={t("compress_quality")}
            value={preset}
            onChange={setPreset}
            options={(["small", "balanced", "high"] as Preset[]).map((value) => ({
              value,
              label: t(`compress_${value}`),
              hint: estimates[value]
                ? `≈ ${formatBytes(estimates[value], language)}`
                : undefined,
            }))}
          />
          <p className="-mt-2 text-xs text-fg-muted">
            {t("compress_was", { size: formatBytes(file.info.sizeBytes, language) })}
          </p>
          {isAudioOnly && (
            <p className="-mt-1 text-xs text-fg-muted">{t("compress_audio_note")}</p>
          )}
        </>
      )}

      <OutputFolderRow folder={job.outputDir} onChoose={() => void job.chooseFolder()} />

      <RunButton
        label={t("tool_compress")}
        disabled={!ready}
        onClick={() =>
          void job.run(
            {
              input: file.path,
              outputName: `${defaultOutputName(file.path)}-compressed`,
              preset,
              // A height cap is meaningless without a video stream.
              maxHeight: !isAudioOnly && preset === "small" ? 720 : null,
            },
            `${defaultOutputName(file.path)}-compressed.${isAudioOnly ? "m4a" : "mp4"}`,
            t(`compress_${preset}`),
          )
        }
      />
    </ToolShell>
  );
}
