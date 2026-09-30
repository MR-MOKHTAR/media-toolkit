import type { JobsState } from "./jobsReducer";
import { isOpenJob, type Job, type JobKind } from "./types";

/** The Tasks rail's subsets. "Done" used to hold failures and cancellations
 *  as well as finished files, so the one list worth looking through after
 *  something went wrong was mixed in with everything that went right. */
export type JobFilter = "all" | "active" | "completed" | "failed";

export interface JobCounts {
  all: number;
  active: number;
  completed: number;
  failed: number;
}

/** Ended without a file: failed, cancelled, or cut off by the app closing. */
export const isUnsuccessful = (job: Job) =>
  job.state === "failed" || job.state === "cancelled";

/** Newest first, matching `order`. */
export function listJobs(state: JobsState): Job[] {
  return state.order.map((id) => state.byId[id]).filter(Boolean);
}

/** The jobs one tool has run, for the history panel on its own screen. Already
 *  newest-first, so a job started a moment ago lands at the top. The limit is
 *  optional because the panel scrolls: capping it there would hide history for
 *  no reason. */
export function jobsOfKind(jobs: Job[], kind: JobKind, limit = Infinity): Job[] {
  const result: Job[] = [];
  for (const job of jobs) {
    if (job.kind !== kind) continue;
    result.push(job);
    if (result.length === limit) break;
  }
  return result;
}

export function countJobs(jobs: Job[]): JobCounts {
  const counts: JobCounts = { all: jobs.length, active: 0, completed: 0, failed: 0 };
  for (const job of jobs) {
    if (isOpenJob(job)) counts.active += 1;
    else if (job.state === "completed") counts.completed += 1;
    else if (isUnsuccessful(job)) counts.failed += 1;
  }
  return counts;
}

export function filterJobs(
  jobs: Job[],
  filter: JobFilter,
  search: string,
  language: string,
): Job[] {
  // Locale-aware lowercasing, because the Turkish dotless i and similar cases
  // fold differently per language and this app is used in three of them.
  const needle = search.trim().toLocaleLowerCase(language);

  return jobs.filter((job) => {
    if (filter === "active" && !isOpenJob(job)) return false;
    if (filter === "completed" && job.state !== "completed") return false;
    if (filter === "failed" && !isUnsuccessful(job)) return false;
    if (!needle) return true;
    return (
      job.title.toLocaleLowerCase(language).includes(needle) ||
      job.source.toLocaleLowerCase(language).includes(needle)
    );
  });
}
