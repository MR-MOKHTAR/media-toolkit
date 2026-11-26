import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ListChecks,
  Loader,
  RotateCcw,
  Square,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { navRow } from "../../components/ui/navRow";
import { useRovingRadio } from "../../hooks/useRovingRadio";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import { countJobs, filterJobs, isUnsuccessful, type JobFilter } from "./selectors";
import { JobList } from "./components/JobList";
import { useJobs } from "./useJobs";

const FILTERS: { value: JobFilter; labelKey: string; icon: LucideIcon }[] = [
  { value: "all", labelKey: "filter_all", icon: ListChecks },
  { value: "active", labelKey: "filter_active", icon: Loader },
  { value: "completed", labelKey: "filter_completed", icon: CheckCircle2 },
  { value: "failed", labelKey: "filter_failed", icon: AlertTriangle },
];

const FILTER_VALUES = FILTERS.map(({ value }) => value);

export function JobsScreen({ language }: { language: string }) {
  const { t } = useTranslation();
  const { jobs, clearFinished, cancelAll, retryFailed } = useJobs();
  const [filter, setFilter] = useState<JobFilter>("all");
  const radio = useRovingRadio({ values: FILTER_VALUES, value: filter, onChange: setFilter });

  const counts = useMemo(() => countJobs(jobs), [jobs]);
  const visible = useMemo(
    () => filterJobs(jobs, filter, "", language),
    [jobs, filter, language],
  );
  const retryable = useMemo(
    () => jobs.some((job) => job.kind === "download" && job.request && isUnsuccessful(job)),
    [jobs],
  );
  const finished = counts.completed + counts.failed;

  if (jobs.length === 0) {
    return (
      <div className="flex h-full min-h-full items-center justify-center p-6">
        <EmptyState
          icon={<ListChecks size={22} />}
          title={t("no_jobs_title")}
          description={t("no_jobs_description")}
        />
      </div>
    );
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="flex min-h-full items-center justify-center p-6">
              <EmptyState
                icon={<ListChecks size={22} />}
                title={t("no_jobs_in_filter")}
                description={t("no_jobs_in_filter_hint")}
              />
            </div>
          ) : (
            <div className="mx-auto flex w-[min(calc(100%-2rem),var(--container-fluid))] flex-col gap-4 py-6 sm:w-[min(calc(100%-3rem),var(--container-fluid))]">
              <JobList
                jobs={visible}
                language={language}
                showTool
                empty={null}
              />
            </div>
          )}
        </div>

        <aside
          aria-label={t("nav_jobs")}
          className={cn(
            "glass-chrome order-first flex shrink-0 flex-wrap gap-1 border-b p-2",
            "@2xl:order-last @2xl:w-48 @2xl:flex-col @2xl:flex-nowrap @2xl:border-b-0 @2xl:border-s @3xl:w-56",
          )}
        >
          <div
            role="radiogroup"
            aria-label={t("nav_jobs")}
            onKeyDown={radio.onKeyDown}
            className="flex flex-wrap gap-1 @2xl:flex-col @2xl:flex-nowrap"
          >
            {FILTERS.map(({ value, labelKey, icon: Icon }) => {
              const selected = value === filter;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  {...radio.itemProps(value)}
                  onClick={() => setFilter(value)}
                  className={navRow(
                    selected ? "active" : "idle",
                    "w-auto shrink-0 @2xl:w-full",
                  )}
                >
                  <Icon size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
                  <span
                    className={cn(
                      "shrink-0 text-xs tnum",
                      selected ? "text-accent" : "text-fg-muted",
                    )}
                  >
                    {formatCount(counts[value], language)}
                  </span>
                </button>
              );
            })}
          </div>

          {(counts.active > 0 || retryable || finished > 0) && (
            <div className="flex flex-wrap gap-1 @2xl:mt-auto @2xl:flex-col @2xl:flex-nowrap @2xl:border-t @2xl:border-line @2xl:pt-2">
              {retryable && (
                <button
                  type="button"
                  onClick={() => void retryFailed()}
                  className={navRow("idle", "w-auto shrink-0 @2xl:w-full")}
                >
                  <RotateCcw size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t("retry_failed")}</span>
                </button>
              )}

              {counts.active > 0 && (
                <ConfirmDialog
                  title={t("cancel_all")}
                  description={t("cancel_all_confirm")}
                  confirmLabel={t("cancel_all")}
                  onConfirm={() => void cancelAll()}
                  trigger={
                    <button
                      type="button"
                      className={navRow(
                        "idle",
                        "w-auto shrink-0 text-fg-muted hover:bg-danger/10 hover:text-danger-text @2xl:w-full",
                      )}
                    >
                      <Square size={15} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{t("cancel_all")}</span>
                    </button>
                  }
                />
              )}

              {finished > 0 && (
                <ConfirmDialog
                  title={t("clear_finished")}
                  description={t("clear_finished_confirm")}
                  confirmLabel={t("clear_finished")}
                  onConfirm={clearFinished}
                  trigger={
                    <button
                      type="button"
                      className={navRow(
                        "idle",
                        "w-auto shrink-0 text-fg-muted hover:bg-danger/10 hover:text-danger-text @2xl:w-full",
                      )}
                    >
                      <Trash2 size={16} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {t("clear_finished")}
                      </span>
                    </button>
                  }
                />
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
