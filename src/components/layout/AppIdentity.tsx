import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
// The window icon Tauri already ships, rather than a second mark drawn in the
// frontend that could drift from it. Imported at 128px and drawn at 28 so it
// stays sharp on a HiDPI screen.
import appIcon from "../../../src-tauri/icons/128x128.png";

/**
 * The app's icon and name.
 *
 * One component because it is drawn in two places that are never on screen
 * together: the sidebar's top row while it is expanded, and the title bar while
 * it is collapsed. They are the same 44px-tall strip along the top of the
 * window, so the mark moving from one to the other should look like nothing
 * happened -- and it did not, while each side styled its own copy: the sidebar
 * had the icon and a semibold foreground name, the title bar had a medium,
 * muted one and no icon at all, so collapsing the sidebar visibly restyled the
 * app's own name.
 *
 * Both call sites sit inside a drag region, so the parts carry
 * `data-tauri-drag-region` themselves -- otherwise the name and the icon would
 * be dead spots in the strip that moves the window. The icon takes no pointer
 * events for the same reason.
 */
export function AppIdentity({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <span
      data-tauri-drag-region
      className={cn("flex min-w-0 items-center gap-2", className)}
    >
      <img
        src={appIcon}
        alt=""
        aria-hidden
        className="pointer-events-none size-7 shrink-0"
      />
      {/* auto: the name is Persian or Arabic in two of the three languages
          and has to shape in its own direction whatever its container's is. */}
      <span
        data-tauri-drag-region
        dir="auto"
        className="min-w-0 truncate text-sm font-semibold text-fg"
      >
        {t("app_name")}
      </span>
    </span>
  );
}
