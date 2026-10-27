import { useCallback, useEffect, useRef, useState } from "react";

import * as ipc from "../../lib/ipc";
import type { Job, SpeedTest } from "../jobs/types";

/** How often the figure on screen may change. The backend measures four times a
 *  second; digits that rewrite themselves at that rate cannot be read. */
const REFRESH_MS = 500;

/** How long to wait before asking again while the connection is down. */
const RETRY_MS = 8000;

/** Once per run of the app, however many times the screen is opened. */
let autoTested = false;

/** The last result, kept while the app runs: the status bar is mounted for the
 *  life of the window, but a measurement that took seven seconds should not be
 *  lost to anything that remounts it. */
let lastTest: SpeedTest | null = null;

/**
 * What the status bar knows about the connection, and when it finds out more.
 *
 * Three moments, and no timers beyond them:
 *
 *   - The first time the app is open on the download screen, the line is
 *     measured for a few seconds and then left alone.
 *   - While a download runs, the figure is what the running downloads add up
 *     to. It costs nothing -- they are already counting -- and it stops with
 *     them. A test is never started over a running download: the two would split
 *     the line between them and both numbers would be wrong.
 *   - If the test cannot reach the network, that is said until a later try gets
 *     through -- when the connection returns, or a download proves it is there.
 */
export function useSpeedMonitor({
  jobs,
  isOnline,
  enabled,
}: {
  /** The download tool's jobs. */
  jobs: Job[];
  isOnline: boolean;
  /** Whether the screen that shows this is the one open. */
  enabled: boolean;
}) {
  const live = jobs.reduce(
    (sum, job) => (job.state === "running" ? sum + (job.speed ?? 0) : sum),
    0,
  );
  const downloading = jobs.some((job) => job.state === "running");
  const liveRef = useRef(live);
  liveRef.current = live;

  const [shown, setShown] = useState(0);
  const [peak, setPeak] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = liveRef.current;
      setShown(next);
      // A peak belongs to the downloads that made it; the next ones start over.
      setPeak((current) => (next > 0 ? Math.max(current, next) : current));
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!downloading) setPeak(0);
  }, [downloading]);

  const [result, setResult] = useState<SpeedTest | null>(lastTest);
  const [testing, setTesting] = useState(false);
  /** The rate so far, while a test runs. */
  const [measuring, setMeasuring] = useState(0);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setTesting(true);
    setMeasuring(0);
    const stop = await ipc.onSpeedTestProgress(setMeasuring).catch(() => undefined);
    try {
      const found = await ipc.testInternetSpeed();
      lastTest = found;
      setResult(found);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      stop?.();
      busy.current = false;
      setTesting(false);
      setMeasuring(0);
    }
  }, []);

  // Once, when the screen is first open with a network to test.
  useEffect(() => {
    if (!enabled || !isOnline || downloading || autoTested) return;
    autoTested = true;
    void run();
  }, [enabled, isOnline, downloading, run]);

  // While the last try failed: again when the network comes back, and every
  // few seconds until then.
  useEffect(() => {
    if (!failed || !enabled || downloading) return;
    const again = () => void run();
    const timer = setInterval(() => navigator.onLine && again(), RETRY_MS);
    window.addEventListener("online", again);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", again);
    };
  }, [failed, enabled, downloading, run]);

  // A download moving bytes is proof enough that the connection is there.
  useEffect(() => {
    if (failed && live > 0) setFailed(false);
  }, [failed, live]);

  return { shown, peak, downloading, result, testing, measuring, failed, run };
}
