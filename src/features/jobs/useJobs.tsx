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
  JobFileKind,
  JobKind,
  JobMetaEvent,
  JobProgress,
  JobStatusEvent,
} from "./types";

/** Long enough to recognise the job, short enough that the toast stays one or
 *  two lines. Video titles routinely run past a hundred characters. */
const TITLE_LIMIT = 40;

const shorten = (title: string) =>
  title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}…` : title;

/** Events that arrived for a job before its id did. See `earlyRef`. */
interface EarlyEvents {
  progress?: JobProgress;
  /** Every one, in order: each can say something the others did not -- the
   *  engine's verdict, then the page's real title -- and the reducer takes
   *  what each one adds. */
  metas?: JobMetaEvent[];
  status?: JobStatusEvent;
}

/** How many not-yet-known jobs to hold events for. Only ever a handful in
 *  practice -- a playlist queues a hundred at most, and each is claimed within
 *  a round trip -- so this is a bound on a leak, not a working limit. */
const EARLY_LIMIT = 200;

const isTerminal = (status: JobStatusEvent) =>
  status.state === "completed" ||
  status.state === "failed" ||
  status.state === "cancelled";

interface JobsContextValue {
  state: JobsState;
  jobs: Job[];
  /** Puts a row on the list for work that has been asked for but has no id
   *  yet, and hands back the id it is holding the place with.
   *
   *  For the gap between closing a form and the backend answering: a probe, a
   *  folder lookup and a process spawn, which is a second or two of a list with
   *  nothing on it. Pass the id back into `startDownload`, or into `discardJob`
   *  if the request never gets that far. */
  beginJob: (job: JobMeta & { kind: JobKind }) => string;
  /** Takes a pending row back off the list. Only for ids from `beginJob`:
   *  everything else ends through a status event. */
  discardJob: (id: string) => void;
  startDownload: (
    request: DownloadRequest,
    meta: JobMeta,
    /** The pending row this download is already being drawn as, from
     *  `beginJob`. One is made here when it is omitted, so a caller with
     *  nothing to do before the request does not have to think about it. */
    placeholderId?: string,
  ) => Promise<string>;
  /** For jobs whose command was invoked elsewhere -- the media tools each
   *  call their own command and hand the resulting id back here.
   *
   *  `done` is for work that is already over by the time it is reported: no
   *  status event is ever coming for it, and a row added as "queued" would sit
   *  there for good. */
  addExternalJob: (
    job: JobMeta & {
      id: string;
      kind: JobKind;
      /** The pending row this job was drawn as while its command was running,
       *  from `beginJob`. Replaced in place rather than added on top. */
      placeholderId?: string;
    } & (
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
  /** What the file is, if that was known before the job started. Leave it
   *  `unknown` rather than guessing: the backend says once it has looked. */
  fileKind?: JobFileKind;
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

  /**
   * Events for jobs this store has not been handed yet.
   *
   * A job's id comes back as the answer to the command that started it, and
   * its events arrive on a different channel -- and the backend starts sending
   * them the instant the job exists, before that answer has been written.
   * "Queued", "running" and the first progress tick routinely got here first,
   * found no row with their id, and were dropped. Mostly that was invisible;
   * a job that failed at once -- a bad link, an unwritable folder -- lost its
   * only status event and sat on "queued" for good, with no toast to say why.
   *
   * So they are kept here, by id, and replayed the moment the id is known.
   */
  const earlyRef = useRef(new Map<string, EarlyEvents>());
  /** Ids handed to the reducer, so an event landing in the gap before the
   *  next render -- when `stateRef` has not caught up -- is not held back. */
  const claimedRef = useRef(new Set<string>());

  const isKnown = (id: string) =>
    Boolean(stateRef.current.byId[id]) || claimedRef.current.has(id);

  /** Holds an event for a job not known yet. Keeps the newest of each kind --
   *  except that a finished status is never replaced by an earlier-sounding
   *  one arriving late. */
  const holdEarly = (id: string, event: EarlyEvents) => {
    const early = earlyRef.current;
    const held = early.get(id) ?? {};
    early.delete(id);
    early.set(id, {
      progress: event.progress ?? held.progress,
      metas: [...(held.metas ?? []), ...(event.metas ?? [])].slice(-4),
      status:
        held.status && isTerminal(held.status) ? held.status : (event.status ?? held.status),
    });
    // Oldest first, so the ones dropped are the ones least likely to be claimed.
    while (early.size > EARLY_LIMIT) {
      const oldest = early.keys().next().value;
      if (oldest === undefined) break;
      early.delete(oldest);
    }
  };

  // One subscription for the whole app. Events carry their own job id, so
  // there is no need to track which job is "the active one" -- that assumption
  // is what limited the app to a single download.
  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];

    const attach = (promise: Promise<() => void>) => {
      promise.then((off) => (disposed ? off() : unlisteners.push(off)));
    };

    // Each listener dispatches either way -- the reducer ignores an id it has
    // never seen -- and holds a copy for a job not known yet.
    attach(
      ipc.onJobProgress((payload) => {
        if (!isKnown(payload.id)) holdEarly(payload.id, { progress: payload });
        dispatch({ type: "progress", payload });
      }),
    );
    attach(
      ipc.onJobMeta((payload) => {
        if (!isKnown(payload.id)) holdEarly(payload.id, { metas: [payload] });
        dispatch({ type: "meta", payload });
      }),
    );
    attach(
      ipc.onJobStatus((payload) => {
        if (!isKnown(payload.id)) holdEarly(payload.id, { status: payload });
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

  /**
   * Hands a real job to the reducer, then replays whatever arrived for it
   * before its id did -- see `earlyRef`. The announcement is replayed too: a
   * job that finished in that gap reached the listener while it had no row,
   * so nothing was said about it.
   */
  const claim = useCallback((placeholderId: string, job: Job) => {
    claimedRef.current.add(job.id);
    dispatch({ type: "started", placeholderId, job });

    const early = earlyRef.current.get(job.id);
    if (!early) return;
    earlyRef.current.delete(job.id);
    // Progress before status, so a replayed "completed" is not undone by the
    // progress tick that came before it.
    if (early.progress) dispatch({ type: "progress", payload: early.progress });
    for (const meta of early.metas ?? []) dispatch({ type: "meta", payload: meta });
    if (early.status) {
      dispatch({ type: "status", payload: early.status });
      // The reducer has not re-rendered yet, so `stateRef` does not have this
      // row -- which the announcement needs for the title.
      stateRef.current = {
        ...stateRef.current,
        byId: { ...stateRef.current.byId, [job.id]: job },
      };
      announceRef.current(early.status);
    }
  }, []);

  const beginJob = useCallback((job: JobMeta & { kind: JobKind }) => {
    // Prefixed so it can never be mistaken for -- or collide with -- a backend
    // job id, which is what every other id in this store is.
    const id = `pending:${crypto.randomUUID()}`;
    dispatch({
      type: "added",
      job: {
        id,
        kind: job.kind,
        title: job.title,
        source: job.source,
        detail: job.detail,
        fileKind: job.fileKind,
        state: "queued",
        // Not "queued": nothing is in a queue yet. What is happening is the
        // work before the queue, which is the stage that word exists for.
        stage: "preparing",
        percent: null,
        createdAt: Date.now(),
        pending: true,
      },
    });
    return id;
  }, []);

  const discardJob = useCallback((id: string) => {
    dispatch({ type: "discard", id });
  }, []);

  const startDownload = useCallback(
    async (request: DownloadRequest, meta: JobMeta, placeholderId?: string) => {
      const pendingId =
        placeholderId ?? beginJob({ kind: "download" as JobKind, ...meta });
      let id: string;
      try {
        id = await ipc.startDownload(request);
      } catch (error) {
        // The row was a promise that this download was starting. It is not, so
        // it goes -- the caller reports why.
        dispatch({ type: "discard", id: pendingId });
        throw error;
      }
      claim(pendingId, {
        id,
        kind: "download" as JobKind,
        title: meta.title,
        source: meta.source,
        state: "queued",
        stage: "queued",
        percent: null,
        detail: meta.detail,
        fileKind: meta.fileKind,
        createdAt: Date.now(),
        // Kept so the row can offer a button instead of asking the user to
        // find the link again. It survives a restart with the rest of the
        // history, which is exactly when it is most needed: everything that
        // was in flight when the app closed comes back as failed.
        request,
      });
      return id;
    },
    [beginJob, claim],
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
          // What the last attempt learned about the file still holds: it is
          // the same link, and the backend confirms it again either way.
          fileKind: job.fileKind,
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
        placeholderId?: string;
        done?: boolean;
        outputPath?: string;
      },
    ) => {
      const done = job.done === true;
      const now = Date.now();
      // No placeholder means no row to replace, which `started` handles by
      // adding one at the top -- the same thing "added" did here before.
      claim(job.placeholderId ?? "", {
        id: job.id,
        kind: job.kind,
        title: job.title,
        source: job.source,
        state: done ? "completed" : "queued",
        stage: done ? "finalizing" : "queued",
        percent: done ? 100 : null,
        outputPath: job.outputPath,
        detail: job.detail,
        fileKind: job.fileKind,
        createdAt: now,
        endedAt: done ? now : undefined,
      });
    },
    [claim],
  );

  /**
   * Stops a job. The row goes quiet at once; the backend's "cancelled" event
   * is what settles it.
   *
   * Unless the backend has no such job. Then no event is ever coming -- the
   * job ended and its last event went missing, or it belonged to a run of the
   * app that is gone -- and the row used to sit on "cancelling" for good, with
   * its button disabled. It is settled here instead, as the cancel the user
   * asked for.
   */
  const cancel = useCallback(
    async (id: string) => {
      dispatch({ type: "cancelRequested", id });
      try {
        await ipc.cancelJob(id);
      } catch (error) {
        const appError = ipc.toAppError(error);
        const job = stateRef.current.byId[id];
        if (appError.kind === "unknownJob" && job) {
          dispatch({
            type: "status",
            payload: { id, kind: job.kind, state: "cancelled" },
          });
          return;
        }
        notify("error", describeAppError(appError, t));
      }
    },
    [notify, t],
  );

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
      beginJob,
      discardJob,
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
    [
      state,
      beginJob,
      discardJob,
      startDownload,
      addExternalJob,
      cancel,
      retry,
      reveal,
      open,
    ],
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
