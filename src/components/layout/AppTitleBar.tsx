import { Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../ui/Button";
import { AppIdentity } from "./AppIdentity";

interface AppTitleBarProps {
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  /** False while the sidebar is expanded, because the name is up there instead.
   *  The drag region stays either way -- it is what moves the window. */
  showTitle: boolean;
}

/**
 * Identity, drag area, window controls. Nothing else.
 *
 * The title is the app name and never changes: which screen you are on is the
 * sidebar's job, and it answers that by highlighting the row you are on.
 *
 * It appears here only while the sidebar is collapsed. Expanded, the sidebar's
 * top row -- 240px wide and level with this bar -- carries the name and the
 * window icon, so printing it here as well would be the same word twice on one
 * line of the window.
 *
 * Everything else that has passed through here has left: a back button that
 * said nothing about where you were, a gradient "New Download" call to action,
 * a theme toggle, a raw <select> for the language, the settings gear --
 * Settings is a destination like any other and now sits with Tasks at the foot
 * of the sidebar -- and last of all the history toggle, which opened a panel
 * that no longer exists. Each tool's jobs are its screen now, so there is
 * nothing left for a screen to contribute to this row.
 */
export function AppTitleBar({
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
  showTitle,
}: AppTitleBarProps) {
  const { t } = useTranslation();

  return (
    // This used to pin dir="ltr" to keep minimise/maximise/close on the right
    // whatever the language, because window controls belong in a corner of the
    // window. Now that the sidebar runs the full height, the bar no longer
    // starts at the window's edge: in Persian and Arabic the sidebar holds the
    // right side, so a pinned ltr would park the buttons against it in the
    // middle of the window. Inheriting the direction puts them back in the
    // outer corner -- top-right in English, top-left in Persian and Arabic,
    // which is where the sidebar is not.
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
      {/* The drag region has to be its own element. Marking the header would
          swallow clicks on the buttons inside it. */}
      <div
        data-tauri-drag-region
        className="drag-region flex h-full min-w-0 flex-1 items-center px-2"
      >
        {/* The same component the sidebar's top row draws, so the name and icon
            are identical either side of a collapse -- see AppIdentity. */}
        {showTitle && <AppIdentity />}
      </div>

      <div className="no-drag ms-1 flex items-center">
        {/* No gap: minimise, maximise and close read as one control, the way
            they do in every window they appear in. */}
        <div className="flex items-center">
          <IconButton label={t("minimize")} onClick={onMinimize}>
            <Minus size={16} />
          </IconButton>
          <IconButton
            label={isMaximized ? t("restore") : t("maximize")}
            onClick={onToggleMaximize}
          >
            <Square size={13} />
          </IconButton>
          <IconButton
            label={t("close")}
            onClick={onClose}
            className="hover:bg-danger hover:text-on-accent"
          >
            <X size={17} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
