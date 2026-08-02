import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ListChecks, Loader, Trash2, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { EmptyState } from "../../components/ui/Card";
import { Segmented } from "../../components/ui/Segmented";
import { Tooltip } from "../../components/ui/Tooltip";
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
  const { jobs, state, cancel, remove, reveal, clearFinished } = useJobs();
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
    <div className="flex h-full min-h-0 flex-col">
      {/* A row across the top rather than a rail down the side: the app
          sidebar holds the leading edge now, and a second 160px column beside
          it left a 600px window more rail than list. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-soft px-3 py-2">
        <Segmented
          // Capped: stretched across a wide window, three filters became three
          // billboards. The row still starts at the leading edge, so it reads
          // as a control rather than a header.
          className="max-w-md flex-1"
          label={t("nav_jobs")}
          value={filter}
          onChange={(value) => setFilter(value as JobFilter)}
          options={FILTERS.map(({ value, labelKey, icon: Icon }) => ({
            value,
            label: t(labelKey),
            hint: formatCount(counts[value], language),
            icon: <Icon size={15} />,
          }))}
        />

        {/* Safe as an icon: this drops finished rows from the list, it does
            not touch a file. */}
        {counts.done > 0 && (
          <Tooltip label={t("clear_finished")}>
            <button
              type="button"
              onClick={clearFinished}
              aria-label={t("clear_finished")}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-sm text-fg-muted",
                "transition-colors duration-[--duration-fast]",
                "hover:bg-danger/10 hover:text-danger",
              )}
            >
              <Trash2 size={16} />
            </button>
          </Tooltip>
        )}
      </div>

      {/* The only thing that scrolls. The filter row stays put. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* No heading. The sidebar already says Tasks, and the filter row names
            the subset -- a centred title between them repeated both. */}
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
                      onViewTranscript={(id) => go({ name: "transcript", jobId: id })}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
