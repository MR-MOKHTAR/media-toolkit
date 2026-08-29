import { emptyJobsState, type JobsState } from "./jobsReducer";
import { SLOT_FOR_KIND, type Job, type JobKind } from "./types";

/**
 * The kinds this version knows how to draw.
 *
 * History outlives the app that wrote it, and a tool can go away -- resize did,
 * once its two options moved inside compress. A stored row for a kind that no
 * longer exists has no icon, no shelf and no name to translate, so it is
 * dropped on load rather than rendered as a broken card.
 */
const KNOWN_KINDS = new Set<string>(["download", ...Object.keys(SLOT_FOR_KIND)]);

const KEY = "media-toolkit-jobs-v3";
/** The download-only history this replaces. Read once, then left alone. */
const LEGACY_KEY = "youtube-downloader-history-v2";

const MAX_ITEMS = 100;
/** A stderr tail can be long, and a hundred of them add up in a store that has
 *  a few megabytes total. Enough to keep the useful first lines. */
const MAX_ERROR_TAIL = 2000;

export function loadJobs(): JobsState {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return reviveState(JSON.parse(stored));

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return migrateLegacy(JSON.parse(legacy));
  } catch {
    // Corrupt or unreadable history must never stop the app from starting.
  }
  return emptyJobsState;
}

export function saveJobs(state: JobsState) {
  try {
    const order = state.order.slice(0, MAX_ITEMS);
    const byId: Record<string, Job> = {};
    for (const id of order) byId[id] = trimForStorage(state.byId[id]);
    localStorage.setItem(KEY, JSON.stringify({ byId, order }));
  } catch {
    // Quota exceeded or storage disabled. History is a convenience.
  }
}

function trimForStorage(job: Job): Job {
  if (job.error?.kind !== "tool" || job.error.tail.length <= MAX_ERROR_TAIL) {
    return job;
  }
  return {
    ...job,
    error: { ...job.error, tail: job.error.tail.slice(0, MAX_ERROR_TAIL) },
  };
}

/**
 * Anything still marked as in flight was interrupted by a crash or a quit,
 * because nothing is running when the app has just started. Downloads are
 * marked failed -- the file is incomplete. Media jobs are marked cancelled:
 * the source file is untouched, so there is nothing to recover from.
 *
 * A download revived this way keeps the request that started it, so the row it
 * comes back as carries a retry button -- and both engines continue from the
 * `.part` file rather than starting the transfer again. Closing the app on a
 * download that was nearly finished now costs seconds instead of the download.
 */
function reviveState(raw: unknown): JobsState {
  const parsed = raw as { byId?: Record<string, Job>; order?: string[] };
  if (!parsed?.byId || !Array.isArray(parsed.order)) return emptyJobsState;

  const byId: Record<string, Job> = {};
  const order: string[] = [];
  for (const id of parsed.order.slice(0, MAX_ITEMS)) {
    const job = parsed.byId[id];
    if (!job || !KNOWN_KINDS.has(job.kind)) continue;
    byId[id] =
      job.state === "running" || job.state === "queued"
        ? {
            ...job,
            state: job.kind === "download" ? "failed" : "cancelled",
            percent: null,
            speed: undefined,
            etaSecs: undefined,
            endedAt: job.endedAt ?? Date.now(),
          }
        : job;
    order.push(id);
  }
  return { ...emptyJobsState, byId, order };
}

interface LegacyItem {
  id: string;
  name: string;
  url: string;
  filePath?: string;
  type: "audio" | "video";
  quality: string;
  status: "preparing" | "downloading" | "completed" | "failed" | "cancelled";
  createdAt: number;
}

/** Carries the old download history forward so upgrading does not look like
 *  the app forgot everything. */
function migrateLegacy(raw: unknown): JobsState {
  if (!Array.isArray(raw)) return emptyJobsState;

  const byId: Record<string, Job> = {};
  const order: string[] = [];
  for (const item of (raw as LegacyItem[]).slice(0, MAX_ITEMS)) {
    if (!item?.id) continue;
    const done = item.status === "completed";
    byId[item.id] = {
      id: item.id,
      kind: "download" as JobKind,
      title: item.name,
      source: item.url,
      outputPath: item.filePath,
      state: done ? "completed" : item.status === "cancelled" ? "cancelled" : "failed",
      stage: "finalizing",
      percent: done ? 100 : null,
      createdAt: item.createdAt,
      endedAt: item.createdAt,
      detail: item.type === "audio" ? "MP3" : item.quality,
    };
    order.push(item.id);
  }
  return { ...emptyJobsState, byId, order };
}
