import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import { isActiveJob } from "../jobs/types";
import { useJobs } from "../jobs/useJobs";
import { TOOLS } from "./tools";

export function HomeScreen({ language }: { language: string }) {
  const { t } = useTranslation();
  const { go } = useNavigation();
  const { jobs } = useJobs();
  const running = jobs.filter(isActiveJob).length;

  return (
    // min-h-full + justify-center, not h-full: with a min-height the box grows
    // to fit its content, so once the content is taller than the viewport the
    // free space is zero and justify-center has nothing to distribute. It
    // degrades to top-aligned instead of clipping the first row out of reach.
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6 px-6 py-8 lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold text-fg">{t("home_title")}</h1>
        <p className="text-sm text-fg-muted">{t("home_subtitle")}</p>
      </div>

      {/* Explicit columns rather than auto-fit. There are six tools, so the
          natural shape is 3x2; auto-fit gives four columns on a wide monitor
          and leaves two orphans on the second row. The unprefixed case has to
          be the single column, because the window's 600px minimum is below
          Tailwind's `sm` breakpoint. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map(({ route, key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => go(route)}
            className={cn(
              // justify-center matters: the grid stretches every card in a row
              // to the tallest one, so without it a tool with a shorter hint
              // hangs its content off the top edge.
              "group flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface p-5 text-center",
              "transition-colors duration-[--duration-fast]",
              "hover:border-accent-line hover:bg-accent-soft",
            )}
          >
            <span
              className={cn(
                "flex size-12 items-center justify-center rounded-md bg-surface-soft text-fg-soft",
                "transition-colors duration-[--duration-fast]",
                "group-hover:bg-accent group-hover:text-on-accent",
              )}
            >
              <Icon size={24} />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-lg font-medium text-fg">{t(`tool_${key}`)}</span>
              <span className="text-sm text-fg-muted">{t(`tool_${key}_hint`)}</span>
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => go({ name: "jobs" })}
        className={cn(
          "flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-start",
          "transition-colors duration-[--duration-fast] hover:bg-surface-hover",
        )}
      >
        <ListChecks size={18} className="shrink-0 text-fg-muted" />
        <span className="flex-1 text-base text-fg">{t("nav_jobs")}</span>
        <span className="text-sm text-fg-muted tnum">
          {running > 0
            ? t("jobs_running", { count: running, formatted: formatCount(running, language) })
            : formatCount(jobs.length, language)}
        </span>
      </button>
    </div>
  );
}
