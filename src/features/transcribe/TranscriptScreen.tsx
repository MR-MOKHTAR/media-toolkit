import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  FolderOpen,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { Button } from "../../components/ui/Button";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { formatPercent } from "../../lib/format";
import * as ipc from "../../lib/ipc";
import type { AppLanguage } from "../../hooks/useAppPreferences";
import type { ToastType } from "../../types/feedback";
import { describeAppError } from "../jobs/errorText";
import type { TranscriptFormat, TranscriptText } from "../jobs/types";
import { useJobs } from "../jobs/useJobs";
import { TranscriptPanel } from "./TranscriptPanel";

interface Props {
  jobId: string;
  language: AppLanguage;
  notify: (type: ToastType, message: string) => void;
}

/**
 * One transcription: first its progress, then its text.
 *
 * A screen rather than a section of the form. Watching a transcription run
 * underneath the controls that started it meant the model, the language and the
 * output folder all stayed on screen describing settings that no longer applied
 * to anything -- and the transcript arrived below the fold of a form nobody was
 * looking at any more.
 *
 * Reached two ways, which is why it takes a job id and not a path: by starting
 * a transcription, and by reopening a finished one from Tasks or from the
 * history panel. The second is what makes a transcript from last week readable
 * without hunting for the file.
 */
export function TranscriptScreen({ jobId, language, notify }: Props) {
  const { t } = useTranslation();
  const { back } = useNavigation();
  const { state, cancel, reveal } = useJobs();
  const [transcript, setTranscript] = useState<TranscriptText | null>(null);
  const [copied, setCopied] = useState(false);

  const job = state.byId[jobId];
  const cancelling = state.cancelling.includes(jobId);
  const active = job?.state === "queued" || job?.state === "running";

  // The written file is the source of truth. Jobs live in localStorage, capped
  // at a hundred and rewritten every two seconds; an hour of transcript has no
  // business in there.
  useEffect(() => {
    if (job?.state !== "completed" || !job.outputPath) return;
    let cancelled = false;
    void ipc
      .readTranscript(job.outputPath)
      .then((value) => !cancelled && setTranscript(value))
      .catch(() => !cancelled && notify("error", t("transcript_unavailable")));
    return () => {
      cancelled = true;
    };
  }, [job?.state, job?.outputPath]);

  // The label reverts on its own; a toast would be wrong here because nothing
  // happened anywhere else in the app.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!transcript) return;
    try {
      await ipc.copyText(transcript.text);
      setCopied(true);
    } catch {
      notify("error", t("transcript_copy_failed"));
    }
  };

  // Every route that carries an id can be reached with an id that no longer
  // resolves -- the job was removed from the list, or the list was cleared.
  if (!job) {
    return (
      <Frame>
        <p className="text-sm text-fg-muted">{t("transcript_unavailable")}</p>
        <BackButton onClick={back} label={t("transcribe_another")} />
      </Frame>
    );
  }

  const done = job.state === "completed" && job.outputPath;

  return (
    <Frame>
      {/* One row, not two. The file name used to sit on its own line above a
          panel that then said "Transcript" again -- a word the breadcrumb
          already carries -- and the two of them together cost more height than
          the box they were introducing. */}
      <div className="flex shrink-0 items-center gap-2">
        <h1
          className="min-w-0 flex-1 truncate text-lg font-medium text-fg"
          dir="ltr"
          title={job.title}
        >
          {job.title}
        </h1>
        {done && transcript && (
          <>
            <Button variant="ghost" size="sm" onClick={() => void copy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t("transcript_copied") : t("transcript_copy")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void reveal(job.outputPath!)}
              title={job.outputPath}
            >
              <FolderOpen size={14} />
              {t("open_folder")}
            </Button>
          </>
        )}
      </div>

      {active && (
        <div className="flex shrink-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <Loader2 size={15} className="shrink-0 animate-spin text-accent" />
            <span className="flex-1 text-sm text-fg-soft">
              {cancelling ? t("cancelling") : t(`stage_${job.stage}`)}
            </span>
            {/* Nothing at all when the percentage is unknown, rather than a
                reassuring 0%: between chunks there is genuinely no number, and
                inventing one would contradict the bar beside it. */}
            {job.percent !== null && (
              <span className="text-sm text-fg-muted tnum" dir="ltr">
                {formatPercent(job.percent, language)}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={cancelling}
              onClick={() => void cancel(job.id)}
            >
              <X size={14} />
              {t("cancel_button")}
            </Button>
          </div>
          <ProgressBar percent={job.percent} label={job.title} />
          {/* The one thing worth saying while it runs: the wait is somebody
              else's machine, so a stalled-looking bar is not this app hanging. */}
          <p className="text-xs text-fg-muted">{t("transcript_working")}</p>
        </div>
      )}

      {job.state === "failed" && job.error && (
        <div className="flex shrink-0 items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-sm text-danger">
            {describeAppError(job.error, t, language)}
          </p>
        </div>
      )}

      {job.state === "cancelled" && (
        <p className="shrink-0 text-sm text-fg-muted">{t("transcript_cancelled")}</p>
      )}

      {transcript?.truncated && (
        <p className="shrink-0 text-xs text-fg-muted">{t("transcript_truncated")}</p>
      )}

      {done &&
        (transcript ? (
          <TranscriptPanel
            text={transcript.text}
            format={formatOfPath(job.outputPath!)}
          />
        ) : (
          <p className="shrink-0 text-sm text-fg-muted">{t("transcript_loading")}</p>
        ))}

      {!active && <BackButton onClick={back} label={t("transcribe_another")} />}
    </Frame>
  );
}

/**
 * The column everything on this screen sits in.
 *
 * `h-full`, not `min-h-full` as the tool forms use: a definite height is what
 * lets the transcript below be told how much room there is. `main` is the
 * fallback scroller if a window is ever too short for even the floor.
 *
 * Wider than a form, matching the job list's `lg:max-w-4xl xl:max-w-5xl` -- a
 * form reads best narrow, because a label has to stay near its control, and a
 * page of text does not have that constraint. At the default 1100px window this
 * is 896px rather than the 768px it used to be.
 *
 * `justify-center` still applies, and combined with leaving the panel at the
 * flex default it gives the behaviour that is actually wanted: short content is
 * centred like every other screen, long content fills and scrolls. Everything
 * except the transcript is `shrink-0`, so the transcript is the only thing that
 * gives up space.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col justify-center gap-4 px-6 py-6 lg:max-w-4xl xl:max-w-5xl">
      {children}
    </div>
  );
}

/** The breadcrumb has a back arrow, but it is 15px in the corner. On a screen
 *  whose whole point is one finished thing, the way onward deserves saying. */
function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="secondary" size="md" className="w-fit shrink-0" onClick={onClick}>
      <RotateCcw size={15} />
      {label}
    </Button>
  );
}

const formatOfPath = (path: string): TranscriptFormat => {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension === "srt" || extension === "vtt" ? extension : "txt";
};
