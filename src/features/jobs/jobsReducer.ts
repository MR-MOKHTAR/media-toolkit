import { fileNameOf } from "../../lib/format";
import type { Job, JobProgress, JobStatusEvent } from "./types";

/**
 * Jobs are keyed rather than kept in an array.
 *
 * The old reducer mapped over the whole list on every progress tick. With four
 * concurrent jobs emitting at 10 Hz against a hundred items of history that is
 * four thousand array walks a second, all of them allocating a new array, to
 * update one field on one item.
 */
export interface JobsState {
  byId: Record<string, Job>;
  /** Newest first. Holds ordering so `byId` does not have to be sorted. */
  order: string[];
  selectedId: string | null;
  /** Ids whose cancellation has been requested but not yet confirmed, so the
   *  button can go quiet immediately without lying about the outcome. */
  cancelling: string[];
}

export type JobsAction =
  | { type: "added"; job: Job }
  | { type: "progress"; payload: JobProgress }
  | { type: "status"; payload: JobStatusEvent }
  | { type: "cancelRequested"; id: string }
  | { type: "select"; id: string | null }
  | { type: "remove"; id: string }
  | { type: "clearFinished" }
  | { type: "hydrate"; state: JobsState };

export const emptyJobsState: JobsState = {
  byId: {},
  order: [],
  selectedId: null,
  cancelling: [],
};

/** Replaces one job without touching the others' identities, so memoized rows
 *  that did not change do not re-render. */
function patch(state: JobsState, id: string, next: Partial<Job>): JobsState {
  const current = state.byId[id];
  if (!current) return state;
  return { ...state, byId: { ...state.byId, [id]: { ...current, ...next } } };
}

/** Keeps the job's own title unless it is a bare URL, which is never what
 *  anyone recognises a finished file by. */
function titleFor(job: Job, outputPath: string): string {
  return /^https?:\/\//i.test(job.title) ? fileNameOf(outputPath) : job.title;
}

export function jobsReducer(state: JobsState, action: JobsAction): JobsState {
  switch (action.type) {
    case "hydrate":
      return action.state;

    case "added":
      return {
        ...state,
        byId: { ...state.byId, [action.job.id]: action.job },
        order: [action.job.id, ...state.order.filter((id) => id !== action.job.id)],
        selectedId: action.job.id,
      };

    case "progress": {
      const { id, percent, stage, speed, etaSecs, bytes, totalBytes } =
        action.payload;
      const current = state.byId[id];
      if (!current) return state;
      // A late progress event must not resurrect a job that already ended.
      if (current.state !== "running" && current.state !== "queued") return state;

      return patch(state, id, {
        state: "running",
        stage,
        percent,
        speed: speed ?? undefined,
        etaSecs: etaSecs ?? undefined,
        // Sticky, unlike speed and ETA. A byte count is a fact about the file;
        // an event that omits it is saying "no news", not "zero". yt-dlp's
        // merge and extract-audio phases each emit one of those, and clearing
        // on them left the card with no size to show at the end.
        bytes: bytes ?? current.bytes,
        totalBytes: totalBytes ?? current.totalBytes,
      });
    }

    case "status": {
      const { id, state: next } = action.payload;
      if (!state.byId[id]) return state;
      const cancelling = state.cancelling.filter((other) => other !== id);

      switch (next) {
        case "queued":
          return { ...patch(state, id, { state: "queued", stage: "queued" }), cancelling };
        case "running":
          return { ...patch(state, id, { state: "running" }), cancelling };
        case "completed": {
          const { outputPath } = action.payload;
          return {
            ...patch(state, id, {
              state: "completed",
              stage: "finalizing",
              percent: 100,
              outputPath,
              // A direct download whose probe had not landed -- or failed -- is
              // titled with its own URL, because that is all the form knew. The
              // file now exists and has a name, which is both shorter and what
              // the user will look for in the folder. This also repairs rows
              // saved by older versions, which titled every file download that
              // way.
              title: titleFor(state.byId[id], outputPath),
              speed: undefined,
              etaSecs: undefined,
              endedAt: Date.now(),
            }),
            cancelling,
          };
        }
        case "failed":
          return {
            ...patch(state, id, {
              state: "failed",
              error: action.payload.error,
              speed: undefined,
              etaSecs: undefined,
              endedAt: Date.now(),
            }),
            cancelling,
          };
        case "cancelled":
          return {
            ...patch(state, id, {
              state: "cancelled",
              speed: undefined,
              etaSecs: undefined,
              endedAt: Date.now(),
            }),
            cancelling,
          };
      }
    }

    case "cancelRequested":
      return state.cancelling.includes(action.id)
        ? state
        : { ...state, cancelling: [...state.cancelling, action.id] };

    case "select":
      return { ...state, selectedId: action.id };

    case "remove": {
      const job = state.byId[action.id];
      // Removing a running job would orphan its process and leave a partial
      // file behind. Cancel it first; the row disappears when that lands.
      if (!job || job.state === "running" || job.state === "queued") return state;

      const byId = { ...state.byId };
      delete byId[action.id];
      return {
        ...state,
        byId,
        order: state.order.filter((id) => id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    }

    case "clearFinished": {
      const byId: Record<string, Job> = {};
      const order: string[] = [];
      for (const id of state.order) {
        const job = state.byId[id];
        if (job.state === "running" || job.state === "queued") {
          byId[id] = job;
          order.push(id);
        }
      }
      return {
        ...state,
        byId,
        order,
        selectedId: state.selectedId && byId[state.selectedId] ? state.selectedId : null,
      };
    }
  }
}
