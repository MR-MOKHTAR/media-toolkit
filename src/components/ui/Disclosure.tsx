import { useId, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

import { cn } from "../../lib/cn";

interface Props {
  label: string;
  /** One line under the label while closed: what is set in there now, so a
   *  closed section never hides a choice that is changing the result. */
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

/**
 * A section of a form that stays shut until it is wanted.
 *
 * The tools hold to three controls between the file and the run button; every
 * choice past that lives in one of these. Open or closed is the caller's to
 * remember -- the download form keeps it with its other preferences, so someone
 * who always wants subtitles is not made to open it every time.
 *
 * Height animates with framer-motion rather than CSS, because the content's
 * height is not known ahead of time and `height: auto` does not transition.
 */
export function Disclosure({ label, summary, open, onOpenChange, children, className }: Props) {
  const id = useId();

  return (
    <div className={cn("glass-inset rounded-lg border", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-start transition-colors hover:bg-surface-hover"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-fg">{label}</span>
          {summary && !open && (
            <span className="truncate text-xs text-fg-muted">{summary}</span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={cn(
            "shrink-0 text-fg-muted transition-transform duration-(--duration-base) ease-out-quart",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-4 border-t border-glass-line px-3.5 pb-3.5 pt-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
