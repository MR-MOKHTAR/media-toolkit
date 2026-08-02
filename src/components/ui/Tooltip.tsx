import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A styled tooltip, for controls that are an icon and nothing else.
 *
 * The native `title` attribute is what the rest of the app uses, and it is fine
 * as a fallback, but it waits about a second, cannot be themed, and is drawn by
 * the OS -- so it looks like a different program in a window with no chrome.
 *
 * CSS-only on purpose: no positioning library, no portal, no state. The one
 * thing that costs is that the bubble is clipped by any ancestor that scrolls,
 * which is why it opens *inward* rather than outward. `start-full ms-2` puts it
 * on the inline-end side of the trigger -- to the right of a left-hand rail in
 * English, to the left of a right-hand rail in Persian -- so it grows toward the
 * middle of the window in both directions and never toward the edge.
 *
 * The trigger inside must carry its own `aria-label`; the bubble is aria-hidden
 * so a screen reader is not told the same thing twice. It must not also set
 * `title`, or the OS tooltip appears on top of this one.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 z-50 -translate-y-1/2 whitespace-nowrap",
          "rounded-sm border border-line bg-surface px-2 py-1 text-xs text-fg",
          "shadow-(--shadow-panel)",
          "opacity-0 transition-opacity duration-[--duration-fast]",
          // focus-within as well as hover: a keyboard user gets the name too.
          "group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          "start-full ms-2",
        )}
      >
        {label}
      </span>
    </span>
  );
}
