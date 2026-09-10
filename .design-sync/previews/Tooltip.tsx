import { Tooltip } from "downloader";
import { ListChecks } from "lucide-react";

/**
 * The bubble is portalled to `document.body` and opens on hover *or* focus, so
 * a static screenshot needs the trigger focused -- autoFocus is what makes the
 * open state renderable at all. Focus is also the one way in that does not
 * expire: a hover bubble takes itself away after a couple of seconds, a focused
 * one stays until focus moves. It opens toward the inline-end of the trigger,
 * which is why the cell leaves room to its right.
 *
 * A plain button, not an IconButton: IconButton carries its own tooltip, and
 * wrapping one in this would put two bubbles on one control. This is the
 * collapsed-rail case, the one place the component is used by hand.
 */
export function Open() {
  return (
    <div className="flex w-72 items-center gap-2 px-2 py-6">
      <Tooltip label="Tasks">
        <button
          type="button"
          aria-label="Tasks"
          autoFocus
          className="inline-flex size-9 items-center justify-center rounded-md text-fg-soft hover:bg-surface-hover hover:text-fg"
        >
          <ListChecks size={17} />
        </button>
      </Tooltip>
    </div>
  );
}
