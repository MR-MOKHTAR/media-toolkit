import { IconButton, Tooltip } from "downloader";
import { ListChecks } from "lucide-react";

/**
 * The bubble is CSS-only and opens on hover *or* focus-within, so a static
 * screenshot needs the trigger focused -- autoFocus is what makes the open
 * state renderable at all. It opens toward the inline-end of the trigger, which
 * is why the cell leaves room to its right.
 */
export function Open() {
  return (
    <div className="flex w-72 items-center gap-2 px-2 py-6">
      <Tooltip label="Tasks">
        <IconButton label="Tasks" autoFocus>
          <ListChecks size={17} />
        </IconButton>
      </Tooltip>
    </div>
  );
}
