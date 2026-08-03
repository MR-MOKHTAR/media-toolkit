import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../lib/cn";

/** Distance between the trigger and the bubble, in px. */
const GAP = 8;

/**
 * A styled tooltip, for controls that are an icon and nothing else.
 *
 * The native `title` attribute is what the rest of the app uses, and it is fine
 * as a fallback, but it waits about a second, cannot be themed, and is drawn by
 * the OS -- so it looks like a different program in a window with no chrome.
 *
 * The bubble is `position: fixed` in a portal on `document.body`, and it exists
 * only while the trigger is hovered or focused. Both halves of that matter, and
 * the version this replaces -- an always-rendered `absolute` span at `start-full
 * ms-2` -- got both wrong in the same place: the collapsed sidebar. Sitting
 * inside a scroll container, an absolutely positioned box counts toward
 * scrollable overflow, and `overflow-y: auto` forces `overflow-x` to `auto` too,
 * so seven bubbles hanging past a 56px rail put a permanent horizontal scrollbar
 * under the icons -- and the same container then clipped the bubbles to the rail
 * width, so the tooltips were unreadable exactly where they were the only label
 * the user had. Out of flow and out of the container, neither can happen.
 *
 * It opens on the inline-end side of the trigger -- right of a left-hand rail in
 * English, left of a right-hand rail in Persian -- so it grows toward the middle
 * of the window rather than off its edge.
 *
 * The trigger inside must carry its own `aria-label`; the bubble is aria-hidden
 * so a screen reader is not told the same thing twice. It must not also set
 * `title`, or the OS tooltip appears on top of this one.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  // Null means closed. Nothing is rendered and nothing is measured until a
  // pointer or the keyboard arrives.
  const [style, setStyle] = useState<Record<string, number> | null>(null);

  const show = useCallback(() => {
    const element = anchor.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    // The window's direction, read off the element rather than the language, so
    // this stays correct wherever a subtree overrides `dir`.
    const rtl = getComputedStyle(element).direction === "rtl";

    setStyle({
      top: rect.top + rect.height / 2,
      // Anchored to the far edge in RTL: `right` counts inward from the
      // viewport's right, which is where the bubble's own edge has to land for
      // it to sit before the trigger.
      ...(rtl
        ? { right: window.innerWidth - rect.left + GAP }
        : { left: rect.right + GAP }),
    });
  }, []);

  const hide = useCallback(() => setStyle(null), []);

  return (
    <>
      <span
        ref={anchor}
        className="inline-flex"
        onPointerEnter={show}
        onPointerLeave={hide}
        // Capture, because the focus lands on the button inside rather than on
        // this span, and neither focus nor blur bubbles.
        onFocusCapture={show}
        onBlurCapture={hide}
      >
        {children}
      </span>

      {style &&
        createPortal(
          <span
            aria-hidden
            style={{ position: "fixed", ...style }}
            className={cn(
              "pointer-events-none z-50 -translate-y-1/2 whitespace-nowrap",
              "rounded-sm border border-line bg-surface px-2 py-1 text-xs text-fg",
              "shadow-(--shadow-panel)",
            )}
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}
