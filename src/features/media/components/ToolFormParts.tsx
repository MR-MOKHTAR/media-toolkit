import type { ReactNode } from "react";
import { Folder, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation, type SettingsSection } from "../../../app/navigation";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { SectionLabel } from "../../../components/ui/Card";
import { cn } from "../../../lib/cn";
import { fileNameOf, formatBytes, formatDuration } from "../../../lib/format";
import {
  MEDIA_KIND_ICON,
  MEDIA_KIND_TINT,
  mediaKindOfPath,
  type MediaKind,
} from "../../../lib/mediaKind";
import type { MediaInfo } from "../useMediaFile";

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
        data-autofocus
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-7",
          "transition-colors duration-(--duration-fast)",
          isDragging
            ? "border-accent bg-accent-soft"
            : "border-line bg-surface-soft hover:border-line-strong hover:bg-surface-hover",
        )}
      >
        <Upload
          size={19}
          className={cn("text-fg-muted", isDragging && "text-accent")}
        />
        <span className="text-sm font-medium text-fg">{t("drop_file")}</span>
        <span className="text-xs text-fg-muted">{t("or_browse")}</span>
      </button>
    );
  }

  const kind: MediaKind = info
    ? info.video
      ? "video"
      : "audio"
    : mediaKindOfPath(path);
  const Icon = MEDIA_KIND_ICON[kind];

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-surface-soft p-3",
        isDragging ? "border-accent bg-accent-soft" : "border-line",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-md",
          MEDIA_KIND_TINT[kind],
        )}
      >
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg" title={path}>
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

const ROW =
  "flex items-center gap-3 rounded-md border border-line bg-surface ps-3.5 pe-1.5 py-1.5";

export function OutputFolderRow({
  folder,
  label,
  onChoose,
}: {
  folder: string;
  label?: string;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div dir="ltr" className={ROW}>
      <Folder size={16} className="shrink-0 text-fg-muted" />
      <span
        dir={label ? "auto" : undefined}
        className="min-w-0 flex-1 truncate text-sm text-fg-soft"
        title={folder}
      >
        {label ?? (folder || t("select_location"))}
      </span>
      <Button variant="ghost" size="sm" onClick={onChoose}>
        {t("change")}
      </Button>
    </div>
  );
}

export function PreferenceRow({
  icon,
  label,
  value,
  section,
  onBeforeLeave,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  section: SettingsSection;
  onBeforeLeave?: () => void;
}) {
  const { t } = useTranslation();
  const { go } = useNavigation();

  return (
    <div className={ROW}>
      <span className="shrink-0 text-fg-muted">{icon}</span>
      <span className="shrink-0 text-sm text-fg-soft">{label}</span>
      <span
        dir="ltr"
        className="min-w-0 truncate text-sm font-medium text-fg"
        title={value}
      >
        {value}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="ms-auto shrink-0"
        onClick={() => {
          onBeforeLeave?.();
          go({ name: "settings", section });
        }}
      >
        {t("settings")}
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
      <SectionLabel>
        {title}
        {disabled && disabledHint && (
          <span className="ms-2 text-xs font-normal text-fg-muted">
            {disabledHint}
          </span>
        )}
      </SectionLabel>
      <div className="flex flex-wrap gap-2">
        {formats.map((format) => (
          <button
            key={format}
            type="button"
            disabled={disabled}
            aria-pressed={value === format}
            onClick={() => onChange(format)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm uppercase transition-colors duration-(--duration-fast)",
              "disabled:cursor-not-allowed disabled:opacity-disabled",
              value === format
                ? "border-accent bg-accent-soft font-medium text-accent"
                : "border-line bg-surface text-fg-soft hover:enabled:border-line-strong hover:enabled:bg-surface-hover",
            )}
          >
            {format}
          </button>
        ))}
      </div>
    </div>
  );
}

export function InstantBadge({ text }: { text: string }) {
  return <Badge tone="success">{text}</Badge>;
}
