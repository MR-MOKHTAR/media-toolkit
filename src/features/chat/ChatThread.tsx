import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronUp, FileVideo, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TOOL_ICON } from "../../app/tools";
import { Button } from "../../components/ui/Button";
import {
  daysFromToday,
  displayTitleOf,
  fileNameOf,
  formatClock,
  formatDate,
} from "../../lib/format";
import { FOCUS_JOB_EVENT } from "../../components/layout/RecentJobs";
import { JobCard } from "../jobs/components/JobCard";
import type { Job } from "../jobs/types";
import { useJobs } from "../jobs/useJobs";

/** Older messages wait behind a button: every progress tick re-renders the
 *  thread, and a year of history is not worth that on every tick. */
const PAGE = 120;

/**
 * One tool's history as a conversation: oldest first, each job a pair of
 * messages -- what the user sent (a link, a file) and the app's answer (the
 * job card: its progress, its result, its error and what can be done next).
 * Days are separated the way a messenger separates them.
 */
export function ChatThread({
  jobs,
  language,
}: {
  /** Newest first, the order the store keeps. Reversed here. */
  jobs: Job[];
  language: string;
}) {
  const { t } = useTranslation();
  const { state, cancel, remove, reveal, open, retry, startScheduled } = useJobs();
  const [limit, setLimit] = useState(PAGE);

  // "5 minutes ago" on the cards would freeze otherwise; see JobList.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const cancelling = useMemo(() => new Set(state.cancelling), [state.cancelling]);
  const retrying = useMemo(() => new Set(state.retrying), [state.retrying]);

  // Stable, so a card whose own job did not change skips its render (JobCard
  // is memoised) while another card's progress ticks.
  const onCancel = useCallback((id: string) => void cancel(id), [cancel]);
  const onReveal = useCallback((path: string) => void reveal(path), [reveal]);
  const onOpen = useCallback((path: string) => void open(path), [open]);
  const onStartNow = useCallback((id: string) => void startScheduled(id), [startScheduled]);
  const onRetry = useCallback((id: string) => void retry(id), [retry]);

  // A job picked in the sidebar's Recent list: brought into view and lit
  // for a moment, the way a chat app jumps to a quoted message.
  useEffect(() => {
    const onFocus = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      const index = jobs.findIndex((job) => (job.rowKey ?? job.id) === key);
      if (index >= limit) setLimit(index + 1);
      requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(`[data-job="${CSS.escape(key)}"]`);
        if (!element) return;
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        element.classList.add("bg-accent-soft");
        window.setTimeout(() => element.classList.remove("bg-accent-soft"), 1200);
      });
    };
    window.addEventListener(FOCUS_JOB_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_JOB_EVENT, onFocus);
  }, [jobs, limit]);

  const shown = useMemo(() => jobs.slice(0, limit).reverse(), [jobs, limit]);
  const hidden = jobs.length - shown.length;

  let lastDay: number | null = null;

  return (
    <ol className="flex flex-col gap-5" aria-label={t("chat_thread")}>
      {hidden > 0 && (
        <li className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            icon={<ChevronUp size={15} />}
            onClick={() => setLimit((value) => value + PAGE)}
          >
            {t("chat_show_earlier", { count: hidden })}
          </Button>
        </li>
      )}
      {shown.map((job) => {
        const day = daysFromToday(job.createdAt, now);
        const separator = day !== lastDay;
        lastDay = day;
        return (
          <Fragment key={job.rowKey ?? job.id}>
            {separator && (
              <li aria-hidden className="flex items-center gap-3 text-xs text-fg-muted">
                <span className="h-px flex-1 bg-glass-line" />
                <span className="glass-inset rounded-full border px-3 py-1">
                  {day === 0
                    ? t("chat_today")
                    : day === -1
                      ? t("chat_yesterday")
                      : formatDate(job.createdAt, language)}
                </span>
                <span className="h-px flex-1 bg-glass-line" />
              </li>
            )}
            <motion.li
              data-job={job.rowKey ?? job.id}
              className="flex scroll-my-6 flex-col gap-2 rounded-3xl transition-[background-color] duration-700"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <UserBubble job={job} />
              <AppMessage kind={job.kind}>
                <JobCard
                  job={job}
                  language={language}
                  cancelling={cancelling.has(job.id)}
                  retrying={retrying.has(job.id)}
                  now={now}
                  bubble
                  onCancel={onCancel}
                  onRemove={remove}
                  onReveal={onReveal}
                  onOpen={onOpen}
                  onStartNow={onStartNow}
                  onRetry={onRetry}
                />
              </AppMessage>
            </motion.li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/**
 * What the user sent: the link, or the file. On the trailing side, in the
 * screen's own gradient, the way every messenger draws the sender's bubble.
 */
export const UserBubble = memo(function UserBubble({
  job,
  source,
  kind,
  at,
}: {
  job?: Job;
  /** For a draft, which has no job yet. */
  source?: string;
  kind?: Job["kind"];
  at?: number;
}) {
  const text = job?.source ?? source ?? "";
  const toolKind = job?.kind ?? kind;
  const time = job?.createdAt ?? at;
  const isLink = toolKind === "download";
  const lines = isLink ? text.split("\n").filter(Boolean) : [text];

  return (
    <div className="flex max-w-[min(85%,36rem)] flex-col items-end gap-1 self-end">
      <div className="user-bubble flex min-w-0 max-w-full flex-col gap-1 rounded-2xl rounded-se-md px-4 py-2.5 text-sm">
        {lines.slice(0, 4).map((line, index) => (
          <span key={index} className="flex min-w-0 items-center gap-2">
            {isLink ? (
              <Link2 size={14} className="shrink-0 opacity-80" />
            ) : (
              <FileVideo size={14} className="shrink-0 opacity-80" />
            )}
            <span
              className="truncate"
              dir={isLink ? "ltr" : "auto"}
              title={line}
            >
              {isLink ? displayTitleOf(line) : fileNameOf(line)}
            </span>
          </span>
        ))}
        {lines.length > 4 && (
          <span dir="ltr" className="text-xs opacity-80">
            +{lines.length - 4}
          </span>
        )}
      </div>
      {time !== undefined && (
        <span dir="ltr" className="px-1 text-[11px] text-fg-muted tnum">
          {formatClock(time)}
        </span>
      )}
    </div>
  );
});

/** The app's side of the conversation: the tool's mark as the avatar, the
 *  message beside it. */
export function AppMessage({
  kind,
  children,
}: {
  kind: Job["kind"];
  children: React.ReactNode;
}) {
  const Icon = TOOL_ICON[kind];
  return (
    <div className="flex items-end gap-2.5 self-stretch">
      <span
        aria-hidden
        className="tool-tile flex size-8 shrink-0 items-center justify-center rounded-full"
        data-tool={kind}
      >
        {Icon && <Icon size={15} strokeWidth={2} />}
      </span>
      <div className="min-w-0 max-w-[44rem] flex-1">{children}</div>
    </div>
  );
}
