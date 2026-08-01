import { useEffect, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { History, Inbox, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../../app/navigation";
import { EmptyState } from "../../../components/ui/Card";
import { cn } from "../../../lib/cn";
import { formatCount } from "../../../lib/format";
import { jobsOfKind } from "../selectors";
import type { JobKind } from "../types";
import { useJobs } from "../useJobs";
import { JobCard } from "./JobCard";

/** Shared so the toggle's aria-controls points at the panel it opens. */
const PANEL_ID = "tool-history-panel";

/**
 * What this tool has done lately, beside the form instead of under it.
 *
 * Under the form was the wrong place for a reason that is structural, not
 * aesthetic: `ToolShell` centres a short form vertically, so growing the
 * content past the viewport cancels the centring and slides the whole form
 * upward. Expanding history moved the thing the user was looking at. Adding a
 * job did the same. A panel in its own column cannot do that -- the form's
 * height stops depending on how much history exists.
 *
 * Docked at `lg` and wider; below that the window (600px minimum) has no room
 * for two columns, so the same element becomes an overlay. That is one
 * `lg:static` rather than two component trees.
 */
export function HistoryPanel({
  kind,
  open,
  onClose,
  isRtl,
}: {
  kind: JobKind;
  open: boolean;
  onClose: () => void;
  isRtl: boolean;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { jobs, state, cancel, remove, reveal } = useJobs();
  const { go } = useNavigation();
  const reduceMotion = useReducedMotion();

  const recent = useMemo(() => jobsOfKind(jobs, kind), [jobs, kind]);
  const cancelling = useMemo(() => new Set(state.cancelling), [state.cancelling]);

  // Escape closes the panel and must not also navigate back. NavigationProvider
  // also listens on window, so a capture-phase listener here runs first --
  // neither component has to know the other exists.
  //
  // stopImmediatePropagation, not stopPropagation: the two listeners share a
  // target, and stopPropagation only stops an event from reaching *other*
  // nodes. On window it would let navigation's handler run anyway, closing the
  // panel and leaving the screen in the same keystroke.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  // `initial={false}` skips the entrance outright rather than merely shortening
  // it: under reduced motion the panel should be there, not arrive.
  const enter = reduceMotion ? false : { opacity: 0, x: isRtl ? -24 : 24 };
  const fade = reduceMotion ? false : { opacity: 0 };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Only below lg, where the panel actually covers something. */}
          <motion.div
            initial={fade}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            onClick={onClose}
            className="absolute inset-0 z-30 bg-fg/20 lg:hidden"
            aria-hidden
          />

          <motion.aside
            id={PANEL_ID}
            initial={enter}
            animate={{ opacity: 1, x: 0 }}
            exit={enter || { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            aria-label={t("history")}
            className={cn(
              "absolute inset-y-0 end-0 z-40 flex w-full max-w-105 flex-col",
              "border-s border-line bg-surface shadow-(--shadow-panel)",
              // static puts it back in the flex row, so the form keeps the rest
              // of the width instead of being covered by it.
              "lg:static lg:z-auto lg:w-100 lg:max-w-none lg:shadow-none",
            )}
          >
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
              <h2 className="flex-1 text-sm font-medium text-fg">{t("history")}</h2>
              <span className="text-sm text-fg-muted tnum">
                {formatCount(recent.length, language)}
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("close")}
                title={t("close")}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted",
                  "transition-colors duration-[--duration-fast] hover:bg-surface-hover hover:text-fg",
                )}
              >
                <X size={15} />
              </button>
            </header>

            {/* The panel's own scroll. min-h-0 is what lets a flex child shrink
                enough to scroll rather than pushing the header off. */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {recent.length === 0 ? (
                <EmptyState
                  icon={<Inbox size={22} />}
                  title={t("no_jobs_title")}
                  description={t("no_jobs_description")}
                />
              ) : (
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
                      onViewTranscript={(id) => go({ name: "transcript", jobId: id })}
                    />
                  ))}
                </ul>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** The button that opens it, for the breadcrumb bar's trailing slot. */
export function HistoryToggle({
  kind,
  open,
  onToggle,
}: {
  kind: JobKind;
  open: boolean;
  onToggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { jobs } = useJobs();
  const count = useMemo(() => jobsOfKind(jobs, kind).length, [jobs, kind]);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={count === 0}
      aria-expanded={open}
      aria-controls={PANEL_ID}
      title={t("history")}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-sm",
        "transition-colors duration-[--duration-fast]",
        count === 0
          ? "text-fg-muted opacity-50"
          : open
            ? "bg-accent-soft text-accent"
            : "text-fg-muted hover:bg-surface-hover hover:text-fg",
      )}
    >
      <History size={15} />
      <span>{t("history")}</span>
      <span className="tnum">{formatCount(count, i18n.language)}</span>
    </button>
  );
}
