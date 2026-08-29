import { Fragment, memo, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  Loader2,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card } from "../../../components/ui/Card";
import { IconButton } from "../../../components/ui/Button";
import { ProgressBar } from "../../../components/ui/ProgressBar";
import { cn } from "../../../lib/cn";
import {
  displayTitleOf,
  formatBytes,
  formatEta,
  formatPercent,
  formatRate,
  formatRelativeTime,
  formatSpeed,
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
  const isLink = /^https?:\/\//i.test(job.title);
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

  /* Whatever is known about the file, as the middle group of the metadata line
     between the status and the date. Built as a list so the `·` separators
     fall between whatever actually turned up, rather than every token having
     to know which of the others exist. */
  const meta = [
    // Latin either way -- a container name is not a word in any of the three
    // languages, and mirroring it would only reverse it.
    format && (
      <span key="format" dir="ltr" className="shrink-0">
        {format}
      </span>
    ),
    // The one item here that can be a translated phrase ("exact", a target
    // size), so it is the one that truncates rather than clipping the row.
    job.detail && (
      <span key="detail" className="truncate">
        {job.detail}
      </span>
    ),
    job.state === "completed" && job.bytes !== undefined && (
      <span key="bytes" dir="ltr" className="shrink-0 tnum">
        {formatBytes(job.bytes, language)}
      </span>
    ),
  ].filter(Boolean);

  return (
    // A `Card`, not a hand-written copy of its class string -- and a div, not
    // an <li>. The list item belongs to whoever is building the list: the Tasks
    // screen animates each row, and its motion wrapper sat between the <ul> and
    // this <li>, so the item was not a child of its own list.
    //
    // The full title hangs off the card, not off the <p> that shows it. That
    // <p> is inside a `pointer-events-none` wrapper -- so the stretched reveal
    // button behind it can be hovered and clicked through the text -- which
    // also meant it never received a hover and its `title` never opened. On the
    // card it works, and the action buttons set their own `title`, so hovering
    // one of those still names the button rather than the job.
    <Card
      padding="sm"
      interactive
      title={job.title}
      className="relative flex items-start gap-3"
    >
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
        {/* A link is pinned ltr and reads from its own start. A file name is
            not: it is a title in whatever language it was named in, so it keeps
            the card's direction and truncates at its own end. */}
        <p
          className="truncate text-base text-fg"
          dir={isLink ? "ltr" : undefined}
        >
          {displayTitleOf(job.title)}
        </p>

        {/* One line. Never two.
            A finished card is a title and this, and that is the whole row --
            because the row's real job is to be scrolled past. It was three
            lines: the status pill, the format and the quality on one, the
            timestamp wrapped alone onto another. Every line here is a line
            multiplied by the length of the history.

            `overflow-hidden` and no `flex-wrap` are what hold the promise:
            when there is genuinely more metadata than width -- a long
            translated detail on a narrow panel -- the tail is clipped rather
            than sent to a second row. Status and time are `shrink-0` and
            survive that: what a row is and when it happened are what the eye
            is scanning for, and the format is the one that can afford to go. */}
        <div className="flex items-center gap-x-2 overflow-hidden text-xs text-fg-muted">
          <StatusNote job={job} cancelling={cancelling} />

          {meta.length > 0 && (
            <span className="flex min-w-0 flex-1 items-center gap-x-1.5 overflow-hidden">
              {meta.map((node, index) => (
                <Fragment key={index}>
                  {index > 0 && (
                    <span aria-hidden className="opacity-50">
                      ·
                    </span>
                  )}
                  {node}
                </Fragment>
              ))}
            </span>
          )}

          {/* ms-auto rather than relying on the group above to fill: a job with
              no format and no detail has an empty middle, and the date still
              belongs on the trailing edge rather than tucked against the
              status. */}
          <span className="ms-auto shrink-0 tnum">
            {formatRelativeTime(job.endedAt ?? job.createdAt, language)}
          </span>
        </div>

        {/* The bar and its percentage, then the numbers underneath.
            The percentage stays on the bar's own row because it *is* the bar,
            written out -- the two never disagree and reading them together is
            one glance. The size, the speed and the time left moved to a line of
            their own: they answer a different question ("how big is this and
            how long will it take"), and crowded onto the bar's row at a narrow
            window there was no width left for them, which is how the size came
            to be shown only after the download had already finished.

            The width on the percentage is fixed so the bar does not resize
            itself every time the number goes from 9% to 10%. */}
        {active && (
          <>
            <div className="flex items-center gap-2">
              <ProgressBar percent={job.percent} label={job.title} className="min-w-16 flex-1" />
              {/* Nothing at all when the percentage is unknown, rather than a
                  reassuring 0%. A null percent means the source never reported
                  a total to divide by; the indeterminate bar is the honest
                  answer and a number would contradict it. */}
              {job.percent !== null && (
                <span
                  dir="ltr"
                  className="w-10 shrink-0 text-end text-xs text-fg-muted tnum"
                >
                  {formatPercent(job.percent, language)}
                </span>
              )}
            </div>
            <TransferStats job={job} language={language} />
          </>
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
          // Inline, not behind a `...` menu.
          //
          // It was in a menu on the argument that a bin icon beside the folder
          // icon puts the irreversible action next to the common one. That
          // argument assumed the wrong thing about this button: it removes the
          // row from the history list -- see the `remove` case in jobsReducer
          // -- and touches no file at all. Nothing here is irreversible enough
          // to be worth a menu that costs a click on every row, holds exactly
          // one item, and is drawn as three dots that say nothing about what is
          // inside it.
          //
          // The separation the menu was providing is kept, cheaply: `ms-1` and
          // the muted-until-hover `dangerGhost` treatment, which is the same
          // pairing the cancel X uses in this exact slot while a job runs. The
          // two never appear together, so the trailing control of this card is
          // always the one that ends the job, at one position, in one colour.
          <IconButton
            variant="dangerGhost"
            label={t("remove")}
            className="ms-1"
            onClick={() => onRemove(job.id)}
          >
            <Trash2 size={16} />
          </IconButton>
        )}
      </div>
    </Card>
  );
}

/**
 * How big, how fast, how much longer -- the three questions a running download
 * is asked, on one line under its bar.
 *
 * None of this was on screen. The backend has been sending every field of it
 * since downloads became jobs: the card showed the speed and the ETA squeezed
 * beside the percentage, and the byte counts only ever appeared *after* the job
 * finished. So the one moment the size matters -- while you are deciding whether
 * to wait for it -- was the one moment it was missing.
 *
 * It is its own row rather than more items crowded next to the percentage
 * because these three belong together and the bar's row has no width to give: on
 * a narrow window "118.4 MB / 1.2 GB" alone is most of it.
 *
 * `dir="ltr"` on the whole group: "12.3 MB / 118 MB" and "3.4 MB/s" are
 * quantities with Latin units in every language this app speaks, and the order
 * of the two halves is the same in all of them. The digits inside are still
 * localized -- `formatBytes` and `formatSpeed` go through Intl -- so a Persian
 * reader sees ۱۲٫۳ MB, which is exactly the split the app's formatting rules
 * ask for.
 *
 * Nothing is rendered when there is nothing to say. A live stream reports no
 * total and a stalled connection reports no speed; an empty row is better than
 * a row of em dashes, and the whole line disappears rather than leaving a gap
 * under the bar.
 */
function TransferStats({ job, language }: { job: Job; language: string }) {
  const { t } = useTranslation();

  const size =
    job.bytes !== undefined
      ? job.totalBytes !== undefined
        ? `${formatBytes(job.bytes, language)} / ${formatBytes(job.totalBytes, language)}`
        : // A total the source never reported. What has arrived is still worth
          // saying -- it is the only evidence the transfer is moving at all.
          formatBytes(job.bytes, language)
      : "";

  // A download reports bytes per second; the encoding tools report ffmpeg's
  // realtime multiplier. They are different quantities and only one of them can
  // be present, so whichever it is takes the slot.
  const rate =
    formatSpeed(job.speed, language) || formatRate(job.encodeRate, language);
  const eta =
    job.etaSecs !== undefined
      ? t("eta_remaining", { time: formatEta(job.etaSecs, language) })
      : "";

  const parts = [size, rate, eta].filter(Boolean);
  if (parts.length === 0) return null;

  return (
    <div
      dir="ltr"
      className="flex items-center gap-x-1.5 overflow-hidden text-xs text-fg-muted tnum"
    >
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span aria-hidden className="opacity-50">
              ·
            </span>
          )}
          {/* The size is the one that may not fit, and the one that can afford
              to lose its tail -- the speed and the time left are short and
              fixed-width. */}
          <span className={index === 0 ? "truncate" : "shrink-0"}>{part}</span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * What state this job is in, as part of the metadata line rather than a pill
 * sitting on it.
 *
 * It was a `Badge`: a filled 20px pill with its own background and 8px of
 * horizontal padding, on a line whose other items are 13px text. That pill was
 * the tallest thing in the row, so it -- not the type -- set the height of
 * every card in the list, and its padding was ~24px of the width that pushed
 * the date onto a row of its own.
 *
 * As coloured text with its icon it says exactly the same thing in a third of
 * the space, and the row collapses to the height of one line of text. Colour
 * still carries the state at a glance, which is what the pill was really for;
 * the fill was never doing that job, the hue was.
 *
 * The pill itself is not gone from the app -- `Badge` is still the right thing
 * on the tool forms, where one of them appears at a time on a form that has
 * room. It is wrong here, in a list, on every row.
 */
function StatusNote({ job, cancelling }: { job: Job; cancelling: boolean }) {
  const { t } = useTranslation();

  const [icon, label, tone] = ((): [ReactNode, string, string] => {
    if (cancelling)
      return [<Loader2 size={12} className="animate-spin" />, t("cancelling"), ""];

    switch (job.state) {
      case "queued":
        return [<Clock3 size={12} />, t("status_queued"), ""];
      case "running":
        return [
          <Loader2 size={12} className="animate-spin" />,
          t(`stage_${job.stage}`),
          "text-accent",
        ];
      case "completed":
        return [
          <CheckCircle2 size={12} />,
          t("status_completed"),
          "text-success",
        ];
      case "failed":
        return [<AlertTriangle size={12} />, t("status_failed"), "text-danger"];
      case "cancelled":
        return [<X size={12} />, t("status_cancelled"), ""];
    }
  })();

  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 font-medium",
        // No class for the two neutral states: they inherit the line's own
        // fg-muted, which is the point -- queued and cancelled are the states
        // with nothing to report.
        tone,
      )}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </span>
  );
}

export const JobCard = memo(JobCardComponent);
