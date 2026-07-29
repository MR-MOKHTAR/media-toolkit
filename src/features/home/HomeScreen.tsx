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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-fg">{t("home_title")}</h1>
        <p className="text-sm text-fg-muted">{t("home_subtitle")}</p>
      </div>

      {/* auto-fit rather than a fixed column count, so the grid reflows to one
          column at the 600px minimum window width without a media query. */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        {TOOLS.map(({ route, key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => go(route)}
            className={cn(
              "group flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-4 text-start",
              "transition-colors duration-[--duration-fast]",
              "hover:border-accent-line hover:bg-accent-soft",
            )}
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-md bg-surface-soft text-fg-soft",
                "transition-colors duration-[--duration-fast]",
                "group-hover:bg-accent group-hover:text-on-accent",
              )}
            >
              <Icon size={20} />
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
