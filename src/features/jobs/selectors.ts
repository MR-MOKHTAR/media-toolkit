import type { JobsState } from "./jobsReducer";
import { isActiveJob, type Job, type JobKind } from "./types";

export type JobFilter = "all" | "active" | "done";

export interface JobCounts {
  all: number;
  active: number;
  done: number;
}

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
  let active = 0;
  for (const job of jobs) if (isActiveJob(job)) active += 1;
  return { all: jobs.length, active, done: jobs.length - active };
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
    if (filter === "active" && !isActiveJob(job)) return false;
    if (filter === "done" && isActiveJob(job)) return false;
    if (!needle) return true;
    return (
      job.title.toLocaleLowerCase(language).includes(needle) ||
      job.source.toLocaleLowerCase(language).includes(needle)
    );
  });
}
