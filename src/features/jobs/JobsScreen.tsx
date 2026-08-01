import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ListChecks, Loader, Trash2, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { EmptyState } from "../../components/ui/Card";
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
    <div className="flex h-full min-h-0">
      {/* No direction logic anywhere in here. The rail is first in a flex row
          with no dir of its own, so it lands on the leading edge -- left in
          English, right in Persian and Arabic -- and border-e, text-start and
          border-s-2 follow it across. */}
      <nav
        aria-label={t("nav_jobs")}
        className="flex w-40 shrink-0 flex-col border-e border-line bg-surface-soft p-2"
      >
        <div role="radiogroup" aria-label={t("nav_jobs")} className="flex flex-col gap-1">
          {FILTERS.map(({ value, labelKey, icon }) => (
            <FilterItem
              key={value}
              icon={icon}
              label={t(labelKey)}
              count={counts[value]}
              language={language}
              selected={filter === value}
              onSelect={() => setFilter(value)}
            />
          ))}
        </div>

        {/* Bottom of the rail, where VS Code keeps its gear. Safe as an icon:
            this drops finished rows from the list, it does not touch a file. */}
        {counts.done > 0 && (
          <div className="mt-auto pt-2">
            <Tooltip label={t("clear_finished")}>
              <button
                type="button"
                onClick={clearFinished}
                aria-label={t("clear_finished")}
                className={cn(
                  "flex size-8 items-center justify-center rounded-sm text-fg-muted",
                  "transition-colors duration-[--duration-fast]",
                  "hover:bg-danger/10 hover:text-danger",
                )}
              >
                <Trash2 size={16} />
              </button>
            </Tooltip>
          </div>
        )}
      </nav>

      {/* The only thing that scrolls. The rail stays put. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* No heading. The breadcrumb already says Tasks, and the rail names
            the filter -- a centred title between them repeated both. */}
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

function FilterItem({
  icon: Icon,
  label,
  count,
  language,
  selected,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  language: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border-s-2 px-2.5 py-2 text-start text-base",
        "transition-colors duration-[--duration-fast]",
        // Transparent rather than absent when unselected, so picking one moves
        // nothing sideways.
        selected
          ? "border-accent bg-accent-soft font-medium text-accent"
          : "border-transparent text-fg-soft hover:bg-surface-hover hover:text-fg",
      )}
    >
      <Icon size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs text-fg-muted tnum">
        {formatCount(count, language)}
      </span>
    </button>
  );
}
