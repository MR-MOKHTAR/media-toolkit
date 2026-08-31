import { useMemo, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { Job } from "../types";
import { useJobs } from "../useJobs";
import { JobCard } from "./JobCard";

/**
 * A list of jobs, and everything a row on it can do.
 *
 * Two screens show one: the tool screens, filtered to their own kind, and Tasks,
 * showing every kind at once. They were two hand-written copies of the same
 * `ul` -- the same AnimatePresence, the same six callbacks wired to the same six
 * functions from `useJobs` -- at two widths and inside two different containers.
 *
 * The callbacks are read here rather than passed in, because there is only one
 * answer to each of them: cancelling a job means `cancel`, wherever the row is
 * drawn. What the caller still decides is which jobs to show, and what stands in
 * their place when there are none.
 */
export function JobList({
  jobs,
  language,
  empty,
}: {
  jobs: Job[];
  language: string;
  /** Shown instead of the list when it is empty. The tool screens put their
   *  "start one" button in here; Tasks has nowhere in particular to send you. */
  empty: ReactNode;
}) {
  const { state, cancel, remove, reveal, retry } = useJobs();

  const cancelling = useMemo(() => new Set(state.cancelling), [state.cancelling]);

  if (jobs.length === 0) return <>{empty}</>;

  return (
    <ul className="flex flex-col gap-2 pb-2">
      <AnimatePresence initial={false}>
        {jobs.map((job) => (
          <motion.li
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
            />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
