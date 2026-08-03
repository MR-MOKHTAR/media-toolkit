import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../lib/cn";

/** Distance between the trigger and the bubble, in px. */
const GAP = 8;

/**
 * How long a bubble stays up before it takes itself away.
 *
 * A tooltip is read once, in well under a second. Past that it is a label
 * sitting over the interface, and the interface is what the user is looking at
 * -- so it leaves on its own rather than waiting for the pointer to move,
 * which on a control someone has just clicked and is still resting on could be
 * a very long time.
 */
const LIFETIME_MS = 2200;

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
  // pointer or the keyboard arrives. `timed` records which of the two opened
  // it, because they do not expire the same way.
  const [bubble, setBubble] = useState<{
    style: Record<string, number>;
    timed: boolean;
  } | null>(null);
  // Set by a press and cleared when the pointer leaves. A click focuses the
  // button inside, and that focus would re-open the bubble the press just
  // closed -- so while the pointer is still on a control the user has already
  // used, nothing may re-open it.
  const pressed = useRef(false);

  const show = useCallback((timed: boolean) => {
    const element = anchor.current;
    if (!element || pressed.current) return;

    const rect = element.getBoundingClientRect();
    // The window's direction, read off the element rather than the language, so
    // this stays correct wherever a subtree overrides `dir`.
    const rtl = getComputedStyle(element).direction === "rtl";

    setBubble({
      timed,
      style: {
        top: rect.top + rect.height / 2,
        // Anchored to the far edge in RTL: `right` counts inward from the
        // viewport's right, which is where the bubble's own edge has to land
        // for it to sit before the trigger.
        ...(rtl
          ? { right: window.innerWidth - rect.left + GAP }
          : { left: rect.right + GAP }),
      },
    });
  }, []);

  const hide = useCallback(() => setBubble(null), []);

  // Everything that ends a bubble's life, in one place, live only while one is
  // on screen.
  //
  // The timer is the important half, and it is only on the pointer's bubbles.
  // Before it, the sole way out was `pointerleave`: clicking a sidebar row and
  // leaving the pointer where it was -- which is what clicking something
  // normally leaves you doing -- pinned the label over the window until the
  // mouse was moved somewhere else entirely. A bubble opened by keyboard focus
  // is not left behind like that, because moving focus is what takes it away,
  // so that one stays for as long as the control is focused.
  //
  // The rest close it for the same reason a native tooltip would: the bubble is
  // `position: fixed` at coordinates measured once, so anything that moves the
  // trigger out from under it leaves it pointing at nothing.
  useEffect(() => {
    if (!bubble) return;

    const timer = bubble.timed
      ? window.setTimeout(hide, LIFETIME_MS)
      : undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    window.addEventListener("keydown", onKeyDown);
    // Capture: a scroll inside the sidebar does not bubble to the window.
    window.addEventListener("scroll", hide, true);
    // Alt-tabbing away with a bubble up would otherwise bring it back on top of
    // whatever the user returns to.
    window.addEventListener("blur", hide);

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [bubble, hide]);

  return (
    <>
      <span
        ref={anchor}
        className="inline-flex"
        onPointerEnter={() => show(true)}
        onPointerLeave={() => {
          pressed.current = false;
          hide();
        }}
        // A press answers the question the tooltip was answering, so the label
        // goes at once rather than lingering over the result of the click.
        onPointerDown={() => {
          pressed.current = true;
          hide();
        }}
        // Capture, because the focus lands on the button inside rather than on
        // this span, and neither focus nor blur bubbles.
        onFocusCapture={() => show(false)}
        onBlurCapture={hide}
      >
        {children}
      </span>

      {bubble &&
        createPortal(
          <span
            aria-hidden
            style={{ position: "fixed", ...bubble.style }}
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
