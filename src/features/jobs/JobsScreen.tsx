import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/Card";
import { Segmented } from "../../components/ui/Segmented";
import { countJobs, filterJobs, type JobFilter } from "./selectors";
import { JobCard } from "./components/JobCard";
import { useJobs } from "./useJobs";

export function JobsScreen({ language }: { language: string }) {
  const { t } = useTranslation();
  const { jobs, state, cancel, remove, reveal, clearFinished } = useJobs();
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
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 px-6 py-6 lg:max-w-4xl xl:max-w-5xl">
      <h1 className="text-center text-xl font-semibold text-fg">{t("nav_jobs")}</h1>

      {/* Clear sits with the filters rather than beside the title. A button on
          one side of a heading makes a centred heading read as off-centre. */}
      <div className="flex items-center gap-3">
        <Segmented
          className="flex-1"
          label={t("nav_jobs")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("filter_all"), hint: String(counts.all) },
            { value: "active", label: t("filter_active"), hint: String(counts.active) },
            { value: "done", label: t("filter_done"), hint: String(counts.done) },
          ]}
        />
        {counts.done > 0 && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={clearFinished}>
            {t("clear_finished")}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
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
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}
