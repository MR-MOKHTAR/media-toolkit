import { AlertCircle, CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation, type Route } from "../../app/navigation";
import { displayTitleOf } from "../../lib/format";
import { isActiveJob, type Job } from "../../features/jobs/types";
import { useJobs } from "../../features/jobs/useJobs";

/** How many: enough to find what was just done, not a second history. */
const COUNT = 6;

/** Asks the conversation that holds a job to bring it into view. */
export const FOCUS_JOB_EVENT = "mtk:focus-job";

/**
 * The latest jobs from every tool, under the tools in the sidebar -- the
 * recent-chats list of a chat app. A click opens the job's conversation at
 * its message.
 */
export function RecentJobs() {
  const { t } = useTranslation();
  const { jobs } = useJobs();
  const { route, go } = useNavigation();
  const recent = jobs.slice(0, COUNT);
  if (recent.length === 0) return null;

  const openJob = (job: Job) => {
    if (route.name !== job.kind) go({ name: job.kind } as Route);
    // After the conversation has rendered.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(FOCUS_JOB_EVENT, { detail: job.rowKey ?? job.id }));
    }, 60);
  };

  return (
    <section aria-label={t("recent")} className="mt-3 flex flex-col gap-0.5">
      <h2 className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-fg-muted uppercase">
        {t("recent")}
      </h2>
      {recent.map((job) => (
        <button
          key={job.rowKey ?? job.id}
          type="button"
          onClick={() => openJob(job)}
          title={job.title}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm text-fg-soft transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-fg"
        >
          <StatusGlyph job={job} />
          <span
            className="min-w-0 flex-1 truncate"
            dir={/^https?:\/\//i.test(job.title) ? "ltr" : undefined}
          >
            {displayTitleOf(job.title)}
          </span>
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full tool-tile"
            data-tool={job.kind}
          />
        </button>
      ))}
    </section>
  );
}

function StatusGlyph({ job }: { job: Job }) {
  const props = { size: 14, className: "shrink-0" };
  if (job.pending || isActiveJob(job)) {
    return <Loader2 {...props} className="shrink-0 animate-spin text-accent" />;
  }
  switch (job.state) {
    case "completed":
      return <CheckCircle2 {...props} className="shrink-0 text-success-text" />;
    case "failed":
      return <AlertCircle {...props} className="shrink-0 text-danger-text" />;
    case "cancelled":
      return <XCircle {...props} className="shrink-0 text-fg-muted" />;
    default:
      return <Clock3 {...props} className="shrink-0 text-fg-muted" />;
  }
}
