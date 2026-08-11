import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ListChecks, Loader, Trash2, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { EmptyState } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import { countJobs, filterJobs, type JobFilter } from "./selectors";
import { JobCard } from "./components/JobCard";
import { useJobs } from "./useJobs";

const FILTERS: { value: JobFilter; labelKey: string; icon: LucideIcon }[] = [
  { value: "all", labelKey: "filter_all", icon: ListChecks },
  // The static Loader, not the Loader2 that JobCard spins: a filter is not
  // itself in progress, it just names the ones that are.
  { value: "active", labelKey: "filter_active", icon: Loader },
  { value: "done", labelKey: "filter_done", icon: CheckCircle2 },
];

export function JobsScreen({ language }: { language: string }) {
  const { t } = useTranslation();
  const { jobs, state, cancel, remove, reveal, retry, clearFinished } = useJobs();
  const { go } = useNavigation();
  const [filter, setFilter] = useState<JobFilter>("all");

  const counts = useMemo(() => countJobs(jobs), [jobs]);
  const visible = useMemo(
    // Search is gone. Five-way filtering and a search box over a list that is
    // almost always under twenty items was chrome for its own sake.
    () => filterJobs(jobs, filter, "", language),
    [jobs, filter, language],
  );
  const cancelling = useMemo(() => new Set(state.cancelling), [state.cancelling]);

  return (
    // The rail is last in the row and carries no `dir`, so it takes the trailing
    // edge in both writing directions -- the edge opposite the app sidebar, and
    // the same one the tools' history panel docks to.
    <div className="flex h-full min-h-0">
      {/* The only thing that scrolls. The filters stay put. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {/* No heading. The sidebar already says Tasks and the rail names the
            subset -- a centred title between them repeated both. */}
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-6 lg:max-w-4xl xl:max-w-5xl">
          {visible.length === 0 ? (
            <EmptyState
              icon={<ListChecks size={22} />}
              title={t("no_jobs_title")}
              description={t("no_jobs_description")}
            />
          ) : (
            <ul className="flex flex-col gap-2 pb-2">
              <AnimatePresence initial={false}>
                {visible.map((job) => (
                  <motion.div
                    key={job.id}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.16 }}
                  >
                    <JobCard
                      job={job}
                      language={language}
                      cancelling={cancelling.has(job.id)}
                      onCancel={(id) => void cancel(id)}
                      onRemove={remove}
                      onReveal={(path) => void reveal(path)}
                      onRetry={(id) => void retry(id)}
                      onViewTranscript={(id) => go({ name: "transcript", jobId: id })}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </div>

      {/* A column, not the row that used to run across the top. Three filters
          across the full width of the window read as a header rather than a
          control, and each count sat far from the list it counted. Down the
          side they are a short list beside the list they filter, and the row
          the top bar was spending goes back to the jobs. */}
      <aside
        aria-label={t("nav_jobs")}
        className="flex w-52 shrink-0 flex-col gap-1 border-s border-line bg-surface-soft p-2"
      >
        <div role="radiogroup" aria-label={t("nav_jobs")} className="flex flex-col gap-1">
          {FILTERS.map(({ value, labelKey, icon: Icon }) => {
            const selected = value === filter;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setFilter(value)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md border-e-2 px-2.5 py-2",
                  "text-start text-base transition-colors duration-[--duration-fast]",
                  // The accent bar sits on the rail's own outer edge, mirroring
                  // the app sidebar's. Transparent rather than absent when
                  // inactive, so choosing a filter moves nothing sideways.
                  selected
                    ? "border-accent bg-accent-soft font-medium text-accent"
                    : "border-transparent text-fg-soft hover:bg-surface-hover hover:text-fg",
                )}
              >
                <Icon size={17} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
                <span
                  className={cn(
                    "shrink-0 text-xs tnum",
                    selected ? "text-accent" : "text-fg-muted",
                  )}
                >
                  {formatCount(counts[value], language)}
                </span>
              </button>
            );
          })}
        </div>

        {/* It touches no file, but it does empty a list the user cannot get
            back -- and it sits one row under the filters, which are harmless
            and look identical. So it asks first. `mt-auto` pins it to the
            bottom, apart from them: it acts on the list rather than choosing
            what is in it. */}
        {counts.done > 0 && (
          <div className="mt-auto border-t border-line pt-2">
            <ConfirmDialog
              title={t("clear_finished")}
              description={t("clear_finished_confirm")}
              confirmLabel={t("clear_finished")}
              onConfirm={clearFinished}
              trigger={
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2",
                    "text-start text-base text-fg-muted transition-colors duration-[--duration-fast]",
                    "hover:bg-danger/10 hover:text-danger",
                  )}
                >
                  <Trash2 size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {t("clear_finished")}
                  </span>
                </button>
              }
            />
          </div>
        )}
      </aside>
    </div>
  );
}
