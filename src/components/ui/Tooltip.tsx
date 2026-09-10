import type { ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";

import { cn } from "../../lib/cn";

/** Distance between the trigger and the bubble, in px. */
const GAP = 8;

export type TooltipSide = "top" | "right" | "bottom" | "left";

/**
 * A styled tooltip, for controls that are an icon and nothing else.
 *
 * Every IconButton carries one -- see Button.tsx -- so this is wrapped by hand
 * only around the icon-only controls that are not one, the collapsed sidebar
 * rows. The native `title` attribute is left to truncated text, where it shows
 * the rest of a name. On a control it was the wrong thing: it waits about a
 * second, cannot be themed, and is drawn by the OS -- so it looks like a
 * different program in a window with no chrome, and it was what every button
 * in the title bar showed.
 *
 * This replaces a hand-written version whose comments were mostly a list of
 * things it had to solve twice. Radix answers all of them and one it never did:
 *
 *   - It portals, so a bubble hanging past the 56px collapsed rail cannot add to
 *     that rail's scrollable overflow. That was a real bug -- `overflow-y: auto`
 *     forces `overflow-x` to `auto` as well, so seven absolutely positioned
 *     bubbles put a permanent horizontal scrollbar under the sidebar icons, and
 *     the same container then clipped them to the rail width, making the
 *     tooltips unreadable exactly where they were the only label the user had.
 *   - It closes on scroll, on window blur, on Escape and on pointer-down, which
 *     were four separate listeners and a timer.
 *   - `side` is resolved against the `DirectionProvider` in App, so "right" on
 *     the rail opens toward the middle of the window in both writing directions
 *     rather than off its edge.
 *   - New: it collides. The measured-once, fixed-position version pointed at
 *     nothing as soon as it ran out of window, so the bottom icon on the rail
 *     was the one whose label you could least rely on.
 *
 * The trigger inside must carry its own `aria-label`; the bubble is aria-hidden
 * so a screen reader is not told the same thing twice. It must not also set
 * `title`, or the OS tooltip appears on top of this one.
 *
 * Timing and hover behavior are set once on the provider in App, so every bubble
 * in the window agrees.
 */
export function Tooltip({
  label,
  side = "right",
  children,
}: {
  label: string;
  /** Beside the trigger by default, for the rail. The title bar wants below. */
  side?: TooltipSide;
  children: ReactNode;
}) {
  return (
    <RadixTooltip.Root>
      {/* asChild: the trigger is the caller's own button, and wrapping it in
          another element is what put the old version inside the scroll
          container's layout in the first place. */}
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>

      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={GAP}
          // The rail is against the window edge, so a bubble that has run out
          // of room should slide along the icon rather than flip to the far
          // side of it and cover the next one down.
          avoidCollisions
          collisionPadding={GAP}
          aria-hidden
          className={cn(
            "pointer-events-none z-50 whitespace-nowrap select-none",
            // Solid, not glass. The glass surface and its soft hairline are
            // made to sit close to what is behind them, which is exactly wrong
            // for a label that has to be found at a glance -- see the tooltip
            // tokens in theme.css.
            "rounded-sm border border-tooltip-line bg-tooltip px-2 py-1",
            "text-xs font-medium text-tooltip-fg",
            "shadow-(--shadow-raise)",
            "animate-[fade-in_var(--duration-fast)_var(--ease-out-quart)]",
          )}
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
