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
import { NAV_ROW_MARKER, navRow } from "../../components/ui/navRow";
import { useRovingRadio } from "../../hooks/useRovingRadio";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import { countJobs, filterJobs, isUnsuccessful, type JobFilter } from "./selectors";
import { JobList } from "./components/JobList";
import { useJobs } from "./useJobs";

const FILTERS: { value: JobFilter; labelKey: string; icon: LucideIcon }[] = [
  { value: "all", labelKey: "filter_all", icon: ListChecks },
  // The static Loader, not the Loader2 that JobCard spins: a filter is not
  // itself in progress, it just names the ones that are.
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
    // Search is gone. Five-way filtering and a search box over a list that is
    // almost always under twenty items was chrome for its own sake.
    () => filterJobs(jobs, filter, "", language),
    [jobs, filter, language],
  );
  const retryable = useMemo(
    () => jobs.some((job) => job.kind === "download" && job.request && isUnsuccessful(job)),
    [jobs],
  );
  const finished = counts.completed + counts.failed;

  return (
    // A container, so the rail can decide by the room this screen actually
    // has. The window's width said nothing useful: at 600px with the sidebar
    // open, the fixed 192px rail left the job cards about 120px -- less than
    // an icon and its buttons -- while Settings, on the same screen, had
    // already given up its column. Below 672px of its own width the rail
    // becomes a bar across the top.
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
        {/* The only thing that scrolls. The filters stay put. */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {/* No heading. The sidebar already says Tasks and the rail names the
              subset -- a centred title between them repeated both. */}
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-6 lg:max-w-4xl xl:max-w-5xl">
            <JobList
              jobs={visible}
              language={language}
              showTool
              empty={
                // A filter with nothing in it is not an empty app. Saying
                // "nothing here yet, anything you download shows up here"
                // under "Failed" read as the history having been lost.
                filter === "all" || jobs.length === 0 ? (
                  <EmptyState
                    icon={<ListChecks size={22} />}
                    title={t("no_jobs_title")}
                    description={t("no_jobs_description")}
                  />
                ) : (
                  <EmptyState
                    icon={<ListChecks size={22} />}
                    title={t("no_jobs_in_filter")}
                    description={t("no_jobs_in_filter_hint")}
                  />
                )
              }
            />
          </div>
        </div>

        {/* A column, not the row that used to run across the top. Three filters
            across the full width of the window read as a header rather than a
            control, and each count sat far from the list it counted. Down the
            side they are a short list beside the list they filter -- when there
            is room for a side. The rail is last in the row and carries no
            `dir`, so it takes the trailing edge in both writing directions; as
            a bar it is moved to the top. */}
        <aside
          aria-label={t("nav_jobs")}
          className={cn(
            "order-first flex shrink-0 flex-wrap gap-1 border-b border-line bg-surface-soft p-2",
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
                    // The accent bar sits on the rail's own outer edge,
                    // mirroring the app sidebar's -- this rail is docked on the
                    // trailing side, so the bar is on `e` where the sidebar's is
                    // on `s`. As a bar across the top it points at nothing.
                    cn(
                      "w-auto shrink-0 @2xl:w-full @2xl:border-e-2",
                      NAV_ROW_MARKER[selected ? "active" : "idle"],
                    ),
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

          {/* What acts on the list rather than choosing what is in it, apart
              from the filters -- pinned to the bottom of the column, or at the
              end of the bar. Each appears only when it has something to act
              on. */}
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

              {/* Stops everything at once, which is not undone by pressing
                  anything -- so it asks. What downloads fetched stays on disk,
                  and the prompt says so: "Download again" continues each. */}
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

              {/* It touches no file, but it does empty a list the user cannot
                  get back -- and it sits next to the filters, which are
                  harmless and look identical. So it asks first. */}
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
                        // The one row here that is not a filter, so it is the
                        // one row that does not carry the accent marker -- and
                        // it turns red on hover rather than neutral, because it
                        // destroys.
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
