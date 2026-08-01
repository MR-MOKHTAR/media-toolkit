import { memo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { ProgressBar } from "../../../components/ui/ProgressBar";
import { cn } from "../../../lib/cn";
import {
  formatBytes,
  formatEta,
  formatPercent,
  formatRelativeTime,
} from "../../../lib/format";
import {
  extensionOf,
  MEDIA_KIND_ICON,
  MEDIA_KIND_TINT,
  mediaKindOfPath,
  type MediaKind,
} from "../../../lib/mediaKind";
import { describeAppError } from "../errorText";
import type { Job } from "../types";

interface JobCardProps {
  job: Job;
  language: string;
  cancelling: boolean;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onReveal: (path: string) => void;
  /** Opens the transcript screen for a finished Whisper job. Optional because
   *  most lists of jobs have nowhere to navigate to. */
  onViewTranscript?: (id: string) => void;
}

/** What a download sets as its detail when the user picked audio. */
const AUDIO_DETAILS = new Set(["MP3", "M4A", "WAV"]);

/**
 * Which icon and hue this job earns, from the best evidence available.
 *
 * A running job has no output path yet, so the answer has to degrade: the
 * finished path is exact, the title is nearly always right because every screen
 * but one builds it with an extension, and the detail line is the last resort
 * that still catches an audio download. Video is the floor, not an "unknown"
 * state -- see mediaKindOfPath.
 */
function mediaKindOfJob(job: Job): MediaKind {
  if (job.kind === "gif") return "gif";
  // Before the output path is consulted, not after: a finished transcript is a
  // .srt, and mediaKindOfPath's floor is "video", so it would be drawn with a
  // film icon.
  if (job.kind === "transcribe") return "text";
  if (job.outputPath) return mediaKindOfPath(job.outputPath);
  if (extensionOf(job.title)) return mediaKindOfPath(job.title);
  if (job.detail && AUDIO_DETAILS.has(job.detail)) return "audio";
  return "video";
}

/**
 * One job, as a card.
 *
 * Replaces a seven-column grid with `min-width: 785px` -- inside a window
 * whose default width is 800px, so it scrolled horizontally at the app's own
 * launch size. Size, speed and ETA were three separate columns showing "—"
 * most of the time; here they live on the metadata line and only appear while
 * they have values.
 *
 * The old row was a <button> containing role="button" spans, which is invalid
 * nesting, announces as one confused control, and needed stopPropagation on
 * every action. Here the container is a plain div, the primary action is a
 * stretched button behind the content, and the actions are real siblings
 * above it.
 */
function JobCardComponent({
  job,
  language,
  cancelling,
  onCancel,
  onRemove,
  onReveal,
  onViewTranscript,
}: JobCardProps) {
  const { t } = useTranslation();
  const active = job.state === "running" || job.state === "queued";
  const kind = mediaKindOfJob(job);
  const Icon = MEDIA_KIND_ICON[kind];
  const revealable = job.state === "completed" && job.outputPath;
  // The card's stretched target still reveals the file, for every kind. Making
  // it mean something different for one of them would contradict reveal_hint,
  // which is on every other card in the same list.
  const viewable = revealable && job.kind === "transcribe" && onViewTranscript;

  return (
    <li className="relative flex items-start gap-3 rounded-lg border border-line bg-surface p-3">
      {revealable && (
        <button
          type="button"
          onClick={() => onReveal(job.outputPath!)}
          className="absolute inset-0 rounded-lg transition-colors duration-[--duration-fast] hover:bg-surface-hover"
          aria-label={t("reveal_hint")}
        />
      )}

      <span
        className={cn(
          "pointer-events-none relative flex size-9 shrink-0 items-center justify-center rounded-md",
          MEDIA_KIND_TINT[kind],
        )}
      >
        <Icon size={18} />
      </span>

      <div className="pointer-events-none relative min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-base text-fg" title={job.title}>
          {job.title}
        </p>

        <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          <StatusChip job={job} cancelling={cancelling} />
          {job.detail && <span>{job.detail}</span>}
          {job.state === "completed" && job.bytes !== undefined && (
            <span className="tnum" dir="ltr">
              {formatBytes(job.bytes, language)}
            </span>
          )}
          <span>{formatRelativeTime(job.endedAt ?? job.createdAt, language)}</span>
        </p>

        {active && (
          <div className="mt-1.5 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <ProgressBar percent={job.percent} label={job.title} className="flex-1" />
              {/* Nothing at all when the percentage is unknown, rather than a
                  reassuring 0%. A null percent means ffmpeg could not read a
                  duration to divide by; the indeterminate bar is the honest
                  answer and a number would contradict it. */}
              {job.percent !== null && (
                <span className="w-10 shrink-0 text-end text-xs text-fg-muted tnum">
                  {formatPercent(job.percent, language)}
                </span>
              )}
            </div>
            {(job.speed || job.etaSecs !== undefined) && (
              // Speed and ETA only exist while something is running, which is
              // exactly why they do not deserve permanent columns.
              <p className="flex gap-2 text-xs text-fg-muted tnum" dir="ltr">
                {job.speed && <span>{job.speed}</span>}
                {job.etaSecs !== undefined && (
                  <span>{formatEta(job.etaSecs, language)}</span>
                )}
              </p>
            )}
          </div>
        )}

        {job.state === "failed" && job.error && (
          <p
            className="mt-1 line-clamp-2 text-xs text-danger"
            title={describeAppError(job.error, t, language)}
          >
            {describeAppError(job.error, t, language)}
          </p>
        )}
      </div>

      <div className="relative flex shrink-0 items-center gap-1">
        {viewable && (
          <button
            type="button"
            onClick={() => onViewTranscript(job.id)}
            aria-label={t("transcript_view")}
            title={t("transcript_view")}
            className="flex size-8 items-center justify-center rounded-sm text-accent transition-colors hover:bg-accent-soft"
          >
            <FileText size={16} />
          </button>
        )}
        {revealable && (
          <button
            type="button"
            onClick={() => onReveal(job.outputPath!)}
            aria-label={t("open_folder")}
            title={t("open_folder")}
            // Tinted rather than muted grey: it sits next to a delete button,
            // and the one that opens your file should not look like the one
            // that throws it away.
            className="flex size-8 items-center justify-center rounded-sm text-accent transition-colors hover:bg-accent-soft"
          >
            <FolderOpen size={16} />
          </button>
        )}
        {active ? (
          <button
            type="button"
            onClick={() => onCancel(job.id)}
            disabled={cancelling}
            aria-label={t("cancel_button")}
            title={t("cancel_button")}
            className="flex size-8 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
          >
            <X size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onRemove(job.id)}
            aria-label={t("remove")}
            title={t("remove")}
            className="flex size-8 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </li>
  );
}

function StatusChip({ job, cancelling }: { job: Job; cancelling: boolean }) {
  const { t } = useTranslation();

  if (cancelling) return <Chip icon={<Loader2 size={12} className="animate-spin" />} text={t("cancelling")} />;

  switch (job.state) {
    case "queued":
      return <Chip icon={<Clock3 size={12} />} text={t("status_queued")} />;
    case "running":
      return (
        <Chip
          icon={<Loader2 size={12} className="animate-spin" />}
          text={t(`stage_${job.stage}`)}
          tone="accent"
        />
      );
    case "completed":
      return <Chip icon={<CheckCircle2 size={12} />} text={t("status_completed")} tone="success" />;
    case "failed":
      return <Chip icon={<AlertTriangle size={12} />} text={t("status_failed")} tone="danger" />;
    case "cancelled":
      return <Chip icon={<X size={12} />} text={t("status_cancelled")} />;
  }
}

function Chip({
  icon,
  text,
  tone = "muted",
}: {
  icon: React.ReactNode;
  text: string;
  tone?: "muted" | "accent" | "success" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        tone === "accent" && "text-accent",
        tone === "success" && "text-success",
        tone === "danger" && "text-danger",
      )}
    >
      {icon}
      {text}
    </span>
  );
}

export const JobCard = memo(JobCardComponent);
