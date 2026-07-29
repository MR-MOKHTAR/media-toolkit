import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { jobsOfKind } from "../selectors";
import type { JobKind } from "../types";
import { useJobs } from "../useJobs";
import { JobCard } from "./JobCard";

/**
 * What this tool has done lately, on the tool's own screen.
 *
 * The Jobs screen still exists and still shows everything at once; this is the
 * answer to "what did I compress yesterday" without having to go there and
 * pick the compressions out of a mixed list.
 *
 * Reusing JobCard rather than writing a compact row is deliberate: it already
 * opens the containing folder when a finished job is clicked, already renders
 * the progress bar for a running one, and already handles cancel and remove.
 */
export function JobHistory({ kind, limit = 5 }: { kind: JobKind; limit?: number }) {
  // Read the language off i18n rather than taking a prop: useAppPreferences
  // drives changeLanguage, so this is the same value the screens pass down,
  // and it saves threading it through four tool screens that have no other
  // use for it.
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { jobs, state, cancel, remove, reveal } = useJobs();

  const recent = useMemo(() => jobsOfKind(jobs, kind, limit), [jobs, kind, limit]);
  const cancelling = useMemo(() => new Set(state.cancelling), [state.cancelling]);

  // Nothing at all when there is no history. An empty "no history yet" panel on
  // a freshly opened tool is the kind of clutter this app is trying to avoid.
  if (recent.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-fg-soft">{t("recent")}</h2>
      <ul className="flex flex-col gap-2">
        {recent.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            language={language}
            cancelling={cancelling.has(job.id)}
            onCancel={(id) => void cancel(id)}
            onRemove={remove}
            onReveal={(path) => void reveal(path)}
          />
        ))}
      </ul>
    </section>
  );
}
