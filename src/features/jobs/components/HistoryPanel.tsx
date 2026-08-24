import { useEffect, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { History, Inbox, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../../app/navigation";
import { IconButton } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/Card";
import { cn } from "../../../lib/cn";
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
 * Docked at `xl` and wider; below that the window has no room for it beside the
 * form, so the same element becomes an overlay. That is one `xl:static` rather
 * than two component trees. The breakpoint is `xl` and not `lg` because the row
 * now starts with a 240px sidebar: at 1024px the form would be left with 384px,
 * less than it gets in the smallest window the app allows.
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
  const { jobs, state, cancel, remove, reveal, retry } = useJobs();
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
            className="absolute inset-0 z-30 bg-scrim xl:hidden"
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
              "absolute inset-y-0 inset-e-0 z-40 flex w-full max-w-105 flex-col",
              "border-s border-line-soft bg-surface-glass shadow-(--shadow-panel) backdrop-blur-glass",
              // static puts it back in the flex row, so the form keeps the rest
              // of the width instead of being covered by it.
              "xl:static xl:z-auto xl:w-100 xl:max-w-none xl:bg-surface xl:shadow-none xl:backdrop-blur-none",
            )}
          >
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
              <h2 className="flex-1 text-lg font-medium text-fg">
                {t("history")}
              </h2>
              <IconButton label={t("close")} onClick={onClose}>
                <X size={16} />
              </IconButton>
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
                    <li key={job.id}>
                      <JobCard
                        job={job}
                        language={language}
                        cancelling={cancelling.has(job.id)}
                        onCancel={(id) => void cancel(id)}
                        onRemove={remove}
                        onReveal={(path) => void reveal(path)}
                        onRetry={(id) => void retry(id)}
                        onViewTranscript={(id) =>
                          go({ name: "transcript", jobId: id })
                        }
                      />
                    </li>
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

/**
 * The button that opens it, in the title bar beside the window controls.
 *
 * It was a full-height rail on the edge opposite the sidebar, which cost every
 * tool 44px of form width to show one button. In the title bar it costs
 * nothing: that row is a drag region with empty space in it either way, and the
 * control still lives in a fixed spot rather than floating over the form.
 *
 * `title` rather than the styled `Tooltip`: the bubble opens inward from the
 * trigger's inline-end side, which here is on top of the window buttons.
 */
export function HistoryToggle({
  kind,
  open,
  onToggle,
}: {
  kind: JobKind;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { jobs } = useJobs();
  // Only ever compared against zero: the count is not printed here. A number in
  // the title bar was a second tally of what the panel's own header already
  // says, on a row that is otherwise the window's rather than the app's.
  const count = useMemo(() => jobsOfKind(jobs, kind).length, [jobs, kind]);

  return (
    // An IconButton, not a hand-built copy of one. This renders into the title
    // bar's action slot directly beside three real IconButtons, and it was
    // size-7 next to their size-8 -- the mismatch was visible in the one place
    // the two could be compared.
    <IconButton
      label={t("history")}
      onClick={onToggle}
      disabled={count === 0}
      aria-expanded={open}
      aria-controls={PANEL_ID}
      className={cn(
        open &&
          "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
      )}
    >
      <History size={16} />
    </IconButton>
  );
}
