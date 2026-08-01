import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "../../../lib/cn";
import { formatCount } from "../../../lib/format";
import { isActiveJob } from "../types";
import { useJobs } from "../useJobs";

/**
 * The way to Tasks, for the breadcrumb bar's trailing slot.
 *
 * It used to be a full-width row under the home screen's tool grid, which put
 * the one destination worth reaching from anywhere in the one place you can
 * only reach by leaving wherever you are. Here it sits beside the history
 * toggle -- the same kind of control, the same shape -- and is visible while a
 * job is running, which is exactly when someone wants it.
 */
export function TasksButton({ onOpen }: { onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const { jobs } = useJobs();
  const running = jobs.filter(isActiveJob).length;

  return (
    <button
      type="button"
      onClick={onOpen}
      title={t("nav_jobs")}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-sm",
        "transition-colors duration-[--duration-fast]",
        // Tinted while something is in progress. This is the only place the
        // rest of the app reports that work is happening once you have left the
        // screen that started it.
        running > 0
          ? "text-accent hover:bg-accent-soft"
          : "text-fg-muted hover:bg-surface-hover hover:text-fg",
      )}
    >
      <ListChecks size={15} />
      <span>{t("nav_jobs")}</span>
      {/* No "0" on a fresh install: a count of nothing is not information, and
          a zero badge beside a label reads as a broken one. */}
      {jobs.length > 0 && (
        <span className="tnum">
          {formatCount(running > 0 ? running : jobs.length, i18n.language)}
        </span>
      )}
    </button>
  );
}
