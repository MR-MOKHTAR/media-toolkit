import { Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../ui/Button";

interface AppTitleBarProps {
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

/**
 * Identity, drag area, window controls. Nothing else.
 *
 * The title is the app name and never changes: which screen you are on is the
 * sidebar's job, and it answers that by highlighting the row you are on.
 *
 * Everything else that has passed through here has left: a back button that
 * said nothing about where you were, a gradient "New Download" call to action,
 * a theme toggle, a raw <select> for the language, and most recently the
 * settings gear -- Settings is a destination like any other and now sits with
 * Tasks at the foot of the sidebar, so there is one way to reach it rather
 * than two.
 */
export function AppTitleBar({
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: AppTitleBarProps) {
  const { t } = useTranslation();

  return (
    // dir is pinned rather than inherited. Everything else in the app follows
    // the language, but minimise/maximise/close are window chrome, not content:
    // every desktop and every website puts them on the same side regardless of
    // the text direction, and having them jump to the left in Persian and
    // Arabic broke that expectation. The sidebar below deliberately does still
    // flip -- that one is content.
    <header
      dir="ltr"
      className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-surface px-2"
    >
      {/* The drag region has to be its own element. Marking the header would
          swallow clicks on the buttons inside it. */}
      <div
        data-tauri-drag-region
        className="drag-region flex h-full flex-1 items-center px-2 text-sm font-medium text-fg-soft"
      >
        {/* auto, not the header's ltr: the name itself is Persian or Arabic in
            two of the three languages and has to shape in its own direction. */}
        <span data-tauri-drag-region dir="auto" className="truncate">
          {t("app_name")}
        </span>
      </div>

      <div className="no-drag ms-1 flex items-center">
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
          className="hover:bg-danger hover:text-white"
        >
          <X size={17} />
        </IconButton>
      </div>
    </header>
  );
}
