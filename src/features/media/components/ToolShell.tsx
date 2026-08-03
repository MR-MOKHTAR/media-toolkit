import type { ReactNode } from "react";
import { Folder, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../../components/ui/Button";
import { FormCard } from "../../../components/ui/Card";
import { cn } from "../../../lib/cn";
import { fileNameOf, formatBytes, formatDuration } from "../../../lib/format";
import {
  MEDIA_KIND_ICON,
  MEDIA_KIND_TINT,
  mediaKindOfPath,
  type MediaKind,
} from "../../../lib/mediaKind";
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
  subtitle,
  children,
}: {
  subtitle: string;
  children: ReactNode;
}) {
  return (
    // One width step, and only above xl. At the 600px window minimum and in the
    // default 1100px window the form stays xl-wide, which is where a form reads
    // best -- past that the label drifts away from the control it labels. The
    // extra 96px on a wide screen exists for one reason: the trim range needs
    // a timecode field on each side of its track without squeezing it.
    //
    // 576px, not the 672 this replaces. Every control in here is full width, so
    // the container's width *is* the control's width, and at 2xl a single-line
    // URL field was a 670px box holding a 40px cursor. A form is easier to read
    // when the eye does not have to travel the window to get from a label to
    // its input.
    //
    // min-h-full + justify-center centres a short form vertically and falls
    // back to top-aligned once the content outgrows the viewport, because a
    // min-height leaves no free space to distribute at that point.
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-3 px-6 py-6 xl:max-w-2xl">
      <p className="px-2 text-center text-sm text-fg-muted">{subtitle}</p>

      <FormCard>{children}</FormCard>
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
          "flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-6 py-7",
          "transition-colors duration-[--duration-fast]",
          isDragging
            ? "border-accent bg-accent-soft"
            : "border-line bg-surface-soft hover:border-line-strong hover:bg-surface-hover",
        )}
      >
        <Upload size={19} className="text-fg-muted" />
        <span className="text-sm font-medium text-fg">{t("drop_file")}</span>
        <span className="text-xs text-fg-muted">{t("or_browse")}</span>
      </button>
    );
  }

  // ffprobe is the authority once it has answered; until then the extension is
  // the only thing known about the file, and it is right often enough that
  // showing a neutral placeholder for a moment would just be a flicker.
  const kind: MediaKind = info
    ? info.video
      ? "video"
      : "audio"
    : mediaKindOfPath(path);
  const Icon = MEDIA_KIND_ICON[kind];

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border bg-surface p-2.5",
        isDragging ? "border-accent bg-accent-soft" : "border-line",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          MEDIA_KIND_TINT[kind],
        )}
      >
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg" title={path}>
          {fileNameOf(path)}
        </p>
        <p className="text-xs text-fg-muted tnum" dir="ltr">
          {loading
            ? t("reading_file")
            : info
              ? [
                  info.video
                    ? `${info.video.width}×${info.video.height}`
                    : null,
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
    // The whole row is pinned to ltr, not just the path inside it. This row is
    // a filesystem location, and a path only reads one way: folder icon, then
    // the path, then the button that changes it -- identical in all three
    // languages. Letting it mirror moved the change button to the left and put
    // the icon on the far side of a path that still ran left to right.
    <div
      dir="ltr"
      className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2"
    >
      <Folder size={16} className="shrink-0 text-fg-muted" />
      <span
        className="min-w-0 flex-1 truncate text-sm text-fg-soft"
        title={folder}
      >
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
    <Button
      variant="primary"
      size="lg"
      disabled={disabled}
      onClick={onClick}
      className="w-full"
    >
      {label}
    </Button>
  );
}

/**
 * A row of short, fixed choices -- container formats, transcript formats.
 *
 * Lives here rather than in ConvertScreen, where it started, because Transcribe
 * needs the identical control and a second copy would drift. Distinct from
 * `Segmented`: that one divides the full width into equal columns for two to
 * four options with hints, this one wraps a row of short uppercase tokens.
 */
export function FormatGroup({
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
          <span className="ms-2 text-xs font-normal text-fg-muted">
            {disabledHint}
          </span>
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

/** Green badge for the cases where a job is a stream copy: instant, lossless,
 *  and worth telling the user before they wait for nothing. */
export function InstantBadge({ text }: { text: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-sm bg-success/10 px-2 py-1 text-xs font-medium text-success">
      {text}
    </span>
  );
}
