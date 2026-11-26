import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { useNavigation, type ToolName } from "../../../app/navigation";
import type { Job } from "../types";
import { useJobs } from "../useJobs";
import { JobCard } from "./JobCard";

export function JobList({
  jobs,
  language,
  empty,
  showTool,
}: {
  jobs: Job[];
  language: string;
  showTool?: boolean;
  empty: ReactNode;
}) {
  const { state, cancel, remove, reveal, open, retry, startScheduled } = useJobs();
  const { go } = useNavigation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const openInTool = useCallback(
    (path: string, tool: ToolName) => {
      go({ name: tool, file: path, composing: true });
    },
    [go],
  );

  const cancelling = useMemo(() => new Set(state.cancelling), [state.cancelling]);
  const retrying = useMemo(() => new Set(state.retrying), [state.retrying]);

  if (jobs.length === 0) return <>{empty}</>;

  return (
    <ul className="flex flex-col gap-2 pb-2">
      {jobs.map((job) => (
        <li key={job.rowKey ?? job.id}>
          <JobCard
            job={job}
            language={language}
            cancelling={cancelling.has(job.id)}
            retrying={retrying.has(job.id)}
            showTool={showTool}
            now={now}
            onCancel={(id) => void cancel(id)}
            onRemove={remove}
            onReveal={(path) => void reveal(path)}
            onOpen={(path) => void open(path)}
            onOpenInTool={openInTool}
            onStartNow={(id) => void startScheduled(id)}
            onRetry={(id) => void retry(id)}
          />
        </li>
      ))}
    </ul>
  );
}
