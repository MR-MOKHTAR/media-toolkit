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
import { useTranslation } from "react-i18next";

import type { ToastAction, ToastType } from "../../types/feedback";
import * as ipc from "../../lib/ipc";
import { describeAppError } from "./errorText";
import {
  emptyJobsState,
  jobsReducer,
  type JobsAction,
  type JobsState,
} from "./jobsReducer";
import { listJobs as selectJobs } from "./selectors";
import { loadJobs, saveJobs } from "./storage";
import type {
  DownloadRequest,
  Job,
  JobKind,
  JobStatusEvent,
} from "./types";

/** Long enough to recognise the job, short enough that the toast stays one or
 *  two lines. Video titles routinely run past a hundred characters. */
const TITLE_LIMIT = 40;

const shorten = (title: string) =>
  title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}…` : title;

interface JobsContextValue {
  state: JobsState;
  jobs: Job[];
  startDownload: (request: DownloadRequest, meta: JobMeta) => Promise<string>;
  /** For jobs whose command was invoked elsewhere -- the media tools each
   *  call their own command and hand the resulting id back here.
   *
   *  `done` is for work that is already over by the time it is reported: no
   *  status event is ever coming for it, and a row added as "queued" would sit
   *  there for good. */
  addExternalJob: (
    job: JobMeta & { id: string; kind: JobKind } & (
        | { done?: false; outputPath?: undefined }
        | { done: true; outputPath: string }
      ),
  ) => void;
  cancel: (id: string) => Promise<void>;
  /** Starts a finished-badly download over, continuing from whatever it
   *  already fetched. No-op for a job with no stored request. */
  retry: (id: string) => Promise<void>;
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

export function JobsProvider({
  notify,
  children,
}: {
  /** Job actions fired from a card have no screen to report into, so failures
   *  used to vanish: `void reveal(path)` swallowed the rejection and a dead
   *  button was indistinguishable from a missing one. */
  notify: (
    type: ToastType,
    message: string,
    options?: { action?: ToastAction },
  ) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  // Lazy initialiser: reading localStorage on every render would be wasteful,
  // and the migration inside it must run exactly once.
  const [state, dispatch] = useReducer(jobsReducer, emptyJobsState, loadJobs);

  // The current state, readable from callbacks that were created once: the
  // persistence interval below, and the status listener, which needs a job's
  // title but must not re-subscribe every time a percentage moves.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Persist without making every progress tick write to localStorage.
  useEffect(() => {
    const timer = setInterval(() => saveJobs(stateRef.current), 2000);
    const flush = () => saveJobs(stateRef.current);
    window.addEventListener("beforeunload", flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  // Rebuilt on every render and read through a ref, so the announcement always
  // uses the current language while the listener stays mounted once. Assigned
  // below `reveal`, which it needs; the listener only fires after a render, so
  // it can never see the placeholder.
  const announceRef = useRef<(payload: JobStatusEvent) => void>(() => {});
  /** Ids already reported, so a repeated terminal event cannot toast twice. */
  const announcedRef = useRef(new Set<string>());

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
    attach(
      ipc.onJobStatus((payload) => {
        dispatch({ type: "status", payload });
        // Every job kind ends through this one event, so the whole app gets
        // completion feedback from here -- including for work whose screen the
        // user has long since left.
        announceRef.current(payload);
      }),
    );

    return () => {
      disposed = true;
      for (const off of unlisteners) off();
    };
  }, []);

  // What the backend is still running, asked once the listeners above are
  // attached so nothing that finishes in between is missed.
  //
  // `loadJobs` has just marked everything that was in flight as failed, on the
  // reasoning that nothing is running when the app has just started. That is
  // true of a cold start and false of a webview reload -- which happens on
  // every save in dev, and whenever anyone hits refresh. Without this the rows
  // read "failed" while yt-dlp was still writing the file, and their retry
  // button would have started a second download of the same thing into the same
  // folder.
  useEffect(() => {
    let cancelled = false;
    void ipc
      .listJobs()
      .then((live) => !cancelled && dispatch({ type: "reconcile", live }))
      // Not in Tauri, or the command failed. The revived history is a
      // reasonable answer either way; it is only ever an improvement on it.
      .catch(() => undefined);
    return () => {
      cancelled = true;
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
          // Kept so the row can offer a button instead of asking the user to
          // find the link again. It survives a restart with the rest of the
          // history, which is exactly when it is most needed: everything that
          // was in flight when the app closed comes back as failed.
          request,
        },
      });
      return id;
    },
    [],
  );

  /**
   * Runs a failed, cancelled or interrupted download again.
   *
   * A new job rather than a revived one -- the backend has forgotten the old
   * id, and a row that jumps from "failed" back to "downloading" hides the
   * fact that a second attempt is being made. The old row is removed once the
   * new one exists, so the list does not grow a copy per attempt.
   *
   * Nothing is re-downloaded that does not have to be: both engines continue
   * from the `.part` file the previous attempt left.
   */
  const retry = useCallback(
    async (id: string) => {
      const job = stateRef.current.byId[id];
      if (!job?.request) return;
      try {
        await startDownload(job.request, {
          title: job.title,
          source: job.source,
          detail: job.detail,
        });
        dispatch({ type: "remove", id });
      } catch (error) {
        notify("error", describeAppError(ipc.toAppError(error), t));
      }
    },
    [notify, startDownload, t],
  );

  const addExternalJob = useCallback(
    (
      job: JobMeta & {
        id: string;
        kind: JobKind;
        done?: boolean;
        outputPath?: string;
      },
    ) => {
      const done = job.done === true;
      const now = Date.now();
      dispatch({
        type: "added",
        job: {
          id: job.id,
          kind: job.kind,
          title: job.title,
          source: job.source,
          state: done ? "completed" : "queued",
          stage: done ? "finalizing" : "queued",
          percent: done ? 100 : null,
          outputPath: job.outputPath,
          detail: job.detail,
          createdAt: now,
          endedAt: done ? now : undefined,
        },
      });
    },
    [],
  );

  const cancel = useCallback(async (id: string) => {
    dispatch({ type: "cancelRequested", id });
    await ipc.cancelJob(id);
  }, []);

  // Reporting rather than rethrowing: the caller is a button on a card with
  // nowhere to put an error, and a rejected promise nobody awaits is silence.
  const reveal = useCallback(
    async (path: string) => {
      try {
        await ipc.revealInFolder(path);
      } catch {
        notify("error", t("open_folder_failed"));
      }
    },
    [notify, t],
  );

  const open = useCallback(
    async (path: string) => {
      try {
        await ipc.openPath(path);
      } catch {
        notify("error", t("open_file_failed"));
      }
    },
    [notify, t],
  );

  announceRef.current = (payload) => {
    if (
      payload.state !== "completed" &&
      payload.state !== "failed" &&
      payload.state !== "cancelled"
    ) {
      return;
    }
    if (announcedRef.current.has(payload.id)) return;

    // Read before the dispatch lands, which is fine -- a title never changes.
    // A job that is not here was cleared from history, and reporting on it
    // would name nothing.
    const job = stateRef.current.byId[payload.id];
    if (!job) return;
    announcedRef.current.add(payload.id);

    const title = shorten(job.title);

    if (payload.state === "completed") {
      const { outputPath } = payload;
      notify("success", t("toast_job_done", { title }), {
        // The result is a file somewhere, and the toast is the only moment the
        // user is told where. `reveal` reports its own failure.
        action: {
          label: t("open_folder"),
          onClick: () => void reveal(outputPath),
        },
      });
      return;
    }

    if (payload.state === "failed") {
      notify(
        "error",
        t("toast_job_failed", {
          title,
          reason: describeAppError(payload.error, t),
        }),
      );
      return;
    }

    notify("info", t("toast_job_cancelled", { title }));
  };

  const value = useMemo<JobsContextValue>(
    () => ({
      state,
      jobs: selectJobs(state),
      startDownload,
      addExternalJob,
      cancel,
      retry,
      remove: (id) => dispatch({ type: "remove", id }),
      select: (id) => dispatch({ type: "select", id }),
      clearFinished: () => dispatch({ type: "clearFinished" }),
      reveal,
      open,
    }),
    [state, startDownload, addExternalJob, cancel, retry, reveal, open],
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
