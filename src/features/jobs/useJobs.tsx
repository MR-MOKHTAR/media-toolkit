/**
 * The jobs store, mounted once.
 *
 * This is a provider rather than a hook each screen calls. A per-screen hook
 * would give every tool its own reducer and its own event listener, so progress
 * for a job started on one screen would land in a copy of the state that the
 * visible screen is not reading from.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import * as ipc from "../../lib/ipc";
import {
  emptyJobsState,
  jobsReducer,
  type JobsAction,
  type JobsState,
} from "./jobsReducer";
import { listJobs as selectJobs } from "./selectors";
import { loadJobs, saveJobs } from "./storage";
import type { DownloadRequest, Job, JobKind } from "./types";

interface JobsContextValue {
  state: JobsState;
  jobs: Job[];
  startDownload: (request: DownloadRequest, meta: JobMeta) => Promise<string>;
  /** For jobs whose command was invoked elsewhere -- the media tools each
   *  call their own command and hand the resulting id back here. */
  addExternalJob: (job: JobMeta & { id: string; kind: JobKind }) => void;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => void;
  select: (id: string | null) => void;
  clearFinished: () => void;
  reveal: (path: string) => Promise<void>;
  open: (path: string) => Promise<void>;
}

/** What the UI needs to show about a job that the backend does not send back. */
export interface JobMeta {
  title: string;
  source: string;
  detail?: string;
}

const JobsContext = createContext<JobsContextValue | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  // Lazy initialiser: reading localStorage on every render would be wasteful,
  // and the migration inside it must run exactly once.
  const [state, dispatch] = useReducer(jobsReducer, emptyJobsState, loadJobs);

  // Persist without making every progress tick write to localStorage.
  const persistRef = useRef(state);
  persistRef.current = state;
  useEffect(() => {
    const timer = setInterval(() => saveJobs(persistRef.current), 2000);
    const flush = () => saveJobs(persistRef.current);
    window.addEventListener("beforeunload", flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  // One subscription for the whole app. Events carry their own job id, so
  // there is no need to track which job is "the active one" -- that assumption
  // is what limited the app to a single download.
  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];

    const attach = (promise: Promise<() => void>) => {
      promise.then((off) => (disposed ? off() : unlisteners.push(off)));
    };

    attach(ipc.onJobProgress((payload) => dispatch({ type: "progress", payload })));
    attach(ipc.onJobStatus((payload) => dispatch({ type: "status", payload })));

    return () => {
      disposed = true;
      for (const off of unlisteners) off();
    };
  }, []);

  const startDownload = useCallback(
    async (request: DownloadRequest, meta: JobMeta) => {
      const id = await ipc.startDownload(request);
      dispatch({
        type: "added",
        job: {
          id,
          kind: "download" as JobKind,
          title: meta.title,
          source: meta.source,
          state: "queued",
          stage: "queued",
          percent: null,
          detail: meta.detail,
          createdAt: Date.now(),
        },
      });
      return id;
    },
    [],
  );

  const addExternalJob = useCallback(
    (job: JobMeta & { id: string; kind: JobKind }) => {
      dispatch({
        type: "added",
        job: {
          id: job.id,
          kind: job.kind,
          title: job.title,
          source: job.source,
          state: "queued",
          stage: "queued",
          percent: null,
          detail: job.detail,
          createdAt: Date.now(),
        },
      });
    },
    [],
  );

  const cancel = useCallback(async (id: string) => {
    dispatch({ type: "cancelRequested", id });
    await ipc.cancelJob(id);
  }, []);

  const value = useMemo<JobsContextValue>(
    () => ({
      state,
      jobs: selectJobs(state),
      startDownload,
      addExternalJob,
      cancel,
      remove: (id) => dispatch({ type: "remove", id }),
      select: (id) => dispatch({ type: "select", id }),
      clearFinished: () => dispatch({ type: "clearFinished" }),
      reveal: ipc.revealInFolder,
      open: ipc.openPath,
    }),
    [state, startDownload, addExternalJob, cancel],
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs() {
  const context = useContext(JobsContext);
  if (!context) {
    throw new Error("useJobs must be used inside <JobsProvider>");
  }
  return context;
}

export type { JobsAction };
