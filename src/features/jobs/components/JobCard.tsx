import { memo } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "../../../components/ui/Badge";
import { Card } from "../../../components/ui/Card";
import { IconButton } from "../../../components/ui/Button";
import { ProgressBar } from "../../../components/ui/ProgressBar";
import { cn } from "../../../lib/cn";
import {
  formatBytes,
  formatEta,
  formatPercent,
  formatRelativeTime,
} from "../../../lib/format";
import {
  FILE_KIND_ICON,
  FILE_KIND_TINT,
  fileKindOf,
  formatLabelOf,
  type FileKind,
} from "../../../lib/fileKind";
import { describeAppError } from "../errorText";
import type { Job } from "../types";

interface JobCardProps {
  job: Job;
  language: string;
  cancelling: boolean;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onReveal: (path: string) => void;
  /** Runs an unfinished download again, continuing from what it already got.
   *  Only offered when the job carries the request that started it. */
  onRetry: (id: string) => void;
  /** Opens the transcript screen for a finished Whisper job. Optional because
   *  most lists of jobs have nowhere to navigate to. */
  onViewTranscript?: (id: string) => void;
}

/** What a download sets as its detail when the user picked audio. */
const AUDIO_DETAILS = new Set(["MP3", "M4A", "WAV"]);

/** And when they picked a video quality. Both vocabularies are also what the
 *  pre-1.0 history was migrated into -- see `migrateLegacy` -- so a row from
 *  back then still says which of the two it was, long after its file is
 *  gone. */
const VIDEO_DETAILS = new Set(["best", "1080", "720", "480"]);

/**
 * Which icon and hue this job earns, from the best evidence available.
 *
 * A running job has no output path yet, so the answer has to degrade: the
 * finished path is exact, the title is nearly always right because every screen
 * builds it from a file name, and the detail line is the last resort that still
 * separates a video download from an audio one.
 *
 * The floor used to be "video", which was fine while a download could only ever
 * be video or audio. It is not fine now: the same list holds installers,
 * archives and PDFs, and drawing one of those with a film icon is a claim about
 * the file rather than an absence of one. Video is still reached, but only
 * through evidence -- a quality on the detail line, or a request that asked
 * yt-dlp for a video -- never as the answer to "no idea".
 */
function fileKindOfJob(job: Job): FileKind {
  // Whatever container it landed in, the result of this tool is audio -- and it
  // is known before the file exists, which the extension cannot be.
  if (job.kind === "extractAudio") return "audio";
  // Before the output path is consulted, not after: a finished transcript is a
  // .srt, which is a document, but saying so here keeps the icon right from the
  // moment the job starts.
  if (job.kind === "transcribe") return "document";

  if (job.outputPath) return fileKindOf(job.outputPath);
  const fromTitle = fileKindOf(job.title);
  if (fromTitle !== "other") return fromTitle;
  if (job.detail) {
    if (AUDIO_DETAILS.has(job.detail)) return "audio";
    if (VIDEO_DETAILS.has(job.detail)) return "video";
  }
  // The media tools only ever take media in and only ever give media back.
  if (job.kind !== "download") return "video";
  // A download that got this far has told us nothing about the file, but the
  // request itself said which of the two engines it asked for.
  if (job.request) return job.request.mediaType === "audio" ? "audio" : "video";
  return "other";
}

/**
 * The format, as a short uppercase token: `MP4`, `EXE`, `ZIP`.
 *
 * Derived rather than stored. The output path is the ground truth and it only
 * exists once the job has finished, so a stored copy would have to be written
 * twice and migrated through `storage.ts` to say the same thing this says for
 * free -- and it would still be a guess for the whole time the job was running.
 */
function formatOfJob(job: Job): string | null {
  const source = job.outputPath ?? job.title;
  const label = formatLabelOf(source);
  if (!label) return null;
  // A finished path is a real file name, so whatever extension it carries is a
  // real one. A title is not: an episode called "Chapter 5.5" would otherwise
  // wear a chip reading "5" until the download ended.
  if (!job.outputPath && fileKindOf(source) === "other") return null;
  // `MP3 · MP3` -- Extract audio already puts the container in `detail`.
  return label === job.detail ? null : label;
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
  onRetry,
  onViewTranscript,
}: JobCardProps) {
  const { t } = useTranslation();
  const active = job.state === "running" || job.state === "queued";
  const kind = fileKindOfJob(job);
  const Icon = FILE_KIND_ICON[kind];
  const format = formatOfJob(job);
  const revealable = job.state === "completed" && job.outputPath;
  // Everything that ended without a file, including the jobs marked failed at
  // startup because the app was closed while they were running. Both engines
  // continue from the part file rather than starting over, so this is usually
  // a few seconds rather than the whole download again.
  const retryable = Boolean(
    job.request && (job.state === "failed" || job.state === "cancelled"),
  );
  // The card's stretched target still reveals the file, for every kind. Making
  // it mean something different for one of them would contradict reveal_hint,
  // which is on every other card in the same list.
  const viewable = revealable && job.kind === "transcribe" && onViewTranscript;

  return (
    // A `Card`, not a hand-written copy of its class string -- and a div, not
    // an <li>. The list item belongs to whoever is building the list: the Tasks
    // screen animates each row, and its motion wrapper sat between the <ul> and
    // this <li>, so the item was not a child of its own list.
    <Card padding="sm" interactive className="relative flex items-start gap-3">
      {revealable && (
        <button
          type="button"
          onClick={() => onReveal(job.outputPath!)}
          className="absolute inset-0 rounded-lg transition-colors duration-(--duration-fast) hover:bg-surface-hover"
          aria-label={t("reveal_hint")}
        />
      )}

      <span
        className={cn(
          "pointer-events-none relative flex size-9 shrink-0 items-center justify-center rounded-md",
          FILE_KIND_TINT[kind],
        )}
      >
        <Icon size={18} />
      </span>

      {/* `flex` was missing here, so `flex-col gap-1` did nothing and the two
          blocks below spaced themselves with hand-tuned top margins instead. */}
      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-base text-fg" title={job.title}>
          {job.title}
        </p>

        <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          <StatusChip job={job} cancelling={cancelling} />
          {/* Latin either way -- a container name is not a word in any of the
              three languages, and mirroring it would only reverse it. */}
          {format && <span dir="ltr">{format}</span>}
          {job.detail && <span>{job.detail}</span>}
          {job.state === "completed" && job.bytes !== undefined && (
            <span className="tnum" dir="ltr">
              {formatBytes(job.bytes, language)}
            </span>
          )}
          <span>{formatRelativeTime(job.endedAt ?? job.createdAt, language)}</span>
        </p>

        {active && (
          <div className="flex flex-col gap-1">
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
            className="line-clamp-2 text-xs text-danger"
            title={describeAppError(job.error, t, language)}
          >
            {describeAppError(job.error, t, language)}
          </p>
        )}
      </div>

      <div className="relative flex shrink-0 items-center gap-1">
        {viewable && (
          <IconButton
            variant="accent"
            label={t("transcript_view")}
            onClick={() => onViewTranscript(job.id)}
          >
            <FileText size={16} />
          </IconButton>
        )}
        {retryable && (
          <IconButton
            variant="accent"
            label={t("retry_download")}
            onClick={() => onRetry(job.id)}
          >
            <RotateCcw size={16} />
          </IconButton>
        )}
        {revealable && (
          <IconButton
            variant="accent"
            label={t("open_folder")}
            onClick={() => onReveal(job.outputPath!)}
          >
            <FolderOpen size={16} />
          </IconButton>
        )}
        {active ? (
          <IconButton
            variant="dangerGhost"
            label={t("cancel_button")}
            disabled={cancelling}
            onClick={() => onCancel(job.id)}
          >
            <X size={16} />
          </IconButton>
        ) : (
          // Remove sits in a menu rather than inline, and it is the only thing
          // in there. Inline it was a bare bin icon immediately beside the
          // folder icon that opens the file -- the most common action on this
          // card touching the one irreversible one, at 32px each. Behind the
          // menu it costs a click, gains a word, and stops being something the
          // hand can find by accident.
          <RemoveMenu label={t("remove")} onRemove={() => onRemove(job.id)} />
        )}
      </div>
    </Card>
  );
}

function RemoveMenu({ label, onRemove }: { label: string; onRemove: () => void }) {
  const { t } = useTranslation();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton
          label={t("more_actions")}
          className="data-[state=open]:bg-surface-hover data-[state=open]:text-fg"
        >
          <MoreHorizontal size={16} />
        </IconButton>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          // end, which is logical: the menu hangs off the trailing edge of the
          // card in both writing directions rather than reaching back across it.
          align="end"
          sideOffset={4}
          className={cn(
            "z-50 min-w-36 rounded-lg border border-line-soft p-1",
            "bg-surface-glass backdrop-blur-glass",
            "shadow-(--shadow-panel)",
          )}
        >
          <DropdownMenu.Item
            onSelect={onRemove}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5",
              "text-sm text-fg-soft outline-none select-none",
              "data-highlighted:bg-danger/10 data-highlighted:text-danger",
            )}
          >
            <Trash2 size={14} className="shrink-0" />
            {label}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function StatusChip({ job, cancelling }: { job: Job; cancelling: boolean }) {
  const { t } = useTranslation();

  if (cancelling) return <Badge icon={<Loader2 size={12} className="animate-spin" />}>{t("cancelling")}</Badge>;

  switch (job.state) {
    case "queued":
      return <Badge icon={<Clock3 size={12} />}>{t("status_queued")}</Badge>;
    case "running":
      return (
        <Badge icon={<Loader2 size={12} className="animate-spin" />} tone="accent">
          {t(`stage_${job.stage}`)}
        </Badge>
      );
    case "completed":
      return <Badge icon={<CheckCircle2 size={12} />} tone="success">{t("status_completed")}</Badge>;
    case "failed":
      return <Badge icon={<AlertTriangle size={12} />} tone="danger">{t("status_failed")}</Badge>;
    case "cancelled":
      return <Badge icon={<X size={12} />}>{t("status_cancelled")}</Badge>;
  }
}

export const JobCard = memo(JobCardComponent);
