import type { ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";

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
 *   - `side="right"` is resolved against the `DirectionProvider` in App, so the
 *     bubble opens toward the middle of the window in both writing directions
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
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RadixTooltip.Root>
      {/* asChild: the trigger is the caller's own button, and wrapping it in
          another element is what put the old version inside the scroll
          container's layout in the first place. */}
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>

      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side="right"
          sideOffset={GAP}
          // The rail is against the window edge, so a bubble that has run out
          // of room should slide along the icon rather than flip to the far
          // side of it and cover the next one down.
          avoidCollisions
          collisionPadding={GAP}
          aria-hidden
          className={cn(
            "pointer-events-none z-50 whitespace-nowrap",
            "rounded-sm border border-line bg-surface px-2 py-1 text-xs text-fg",
            "shadow-(--shadow-panel)",
          )}
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
