import type { ReactNode } from "react";
import { FileVideo2, Folder, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../../components/ui/Button";
import { cn } from "../../../lib/cn";
import { fileNameOf, formatBytes, formatDuration } from "../../../lib/format";
import { JobHistory } from "../../jobs/components/JobHistory";
import type { JobKind } from "../../jobs/types";
import type { MediaInfo } from "../useMediaFile";

/**
 * The one layout every tool screen uses:
 *
 *   file  ->  preview  ->  two or three controls  ->  output folder  ->  run
 *
 * If a tool needs more than three controls between the preview and the output
 * row, it is too complicated for this app. Keeping the template identical is
 * what makes five tools feel like one product instead of five dialogs.
 */
export function ToolShell({
  title,
  subtitle,
  historyKind,
  children,
}: {
  title: string;
  subtitle: string;
  /** Shows this tool's own recent jobs under the form. Omitted renders nothing. */
  historyKind?: JobKind;
  children: ReactNode;
}) {
  return (
    // Deliberately not widened past 2xl on large screens. A form gets worse
    // past about 700px, not better: the label drifts away from the control it
    // labels. Only the card grids on Home and Jobs earn extra width.
    //
    // min-h-full + justify-center centres a short form vertically and falls
    // back to top-aligned once the content outgrows the viewport, because a
    // min-height leaves no free space to distribute at that point.
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-5 px-6 py-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        <p className="text-sm text-fg-muted">{subtitle}</p>
      </div>
      {children}
      {historyKind && <JobHistory kind={historyKind} />}
    </div>
  );
}

export function FileDropZone({
  path,
  info,
  loading,
  isDragging,
  onBrowse,
}: {
  path: string | null;
  info: MediaInfo | null;
  loading: boolean;
  isDragging: boolean;
  onBrowse: () => void;
}) {
  const { t } = useTranslation();

  if (!path) {
    return (
      <button
        type="button"
        onClick={onBrowse}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10",
          "transition-colors duration-[--duration-fast]",
          isDragging
            ? "border-accent bg-accent-soft"
            : "border-line bg-surface-soft hover:border-line-strong hover:bg-surface-hover",
        )}
      >
        <Upload size={22} className="text-fg-muted" />
        <span className="text-base font-medium text-fg">{t("drop_file")}</span>
        <span className="text-sm text-fg-muted">{t("or_browse")}</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-surface p-3",
        isDragging ? "border-accent bg-accent-soft" : "border-line",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-soft text-fg-soft">
        <FileVideo2 size={19} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base text-fg" title={path}>
          {fileNameOf(path)}
        </p>
        <p className="text-xs text-fg-muted tnum" dir="ltr">
          {loading
            ? t("reading_file")
            : info
              ? [
                  info.video ? `${info.video.width}×${info.video.height}` : null,
                  formatDuration(info.durationSecs),
                  formatBytes(info.sizeBytes, "en"),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "—"}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onBrowse}>
        {t("change")}
      </Button>
    </div>
  );
}

export function OutputFolderRow({
  folder,
  onChoose,
}: {
  folder: string;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
      <Folder size={16} className="shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 truncate text-sm text-fg-soft" dir="ltr" title={folder}>
        {folder || t("select_location")}
      </span>
      <Button variant="ghost" size="sm" onClick={onChoose}>
        {t("change")}
      </Button>
    </div>
  );
}

export function RunButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="primary" size="lg" disabled={disabled} onClick={onClick} className="w-full">
      {label}
    </Button>
  );
}

/** Green badge for the cases where a job is a stream copy: instant, lossless,
 *  and worth telling the user before they wait for nothing. */
export function InstantBadge({ text }: { text: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-sm bg-success/10 px-2 py-1 text-xs font-medium text-success">
      {text}
    </span>
  );
}
