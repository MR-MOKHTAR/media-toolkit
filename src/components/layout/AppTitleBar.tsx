import { Minus, Settings, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { cn } from "../../lib/cn";
import { IconButton } from "../ui/Button";

interface AppTitleBarProps {
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

/**
 * Identity, drag area, settings, window controls. Nothing else.
 *
 * The title is the app name and never changes: which screen you are on, and
 * how you get back, is the breadcrumb bar's job. Before that bar existed this
 * header carried the only back button in the app, which told you nothing about
 * where you were or how deep you had gone.
 *
 * Further back it also held a gradient "New Download" call to action, a theme
 * toggle and a raw <select> for the language, all crammed into 40px next to
 * the window buttons. Theme and language are set once per install and belong
 * in Settings.
 */
export function AppTitleBar({
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: AppTitleBarProps) {
  const { t } = useTranslation();
  const { go, route } = useNavigation();

  return (
    // dir is pinned rather than inherited. Everything else in the app follows
    // the language, but minimise/maximise/close are window chrome, not content:
    // every desktop and every website puts them on the same side regardless of
    // the text direction, and having them jump to the left in Persian and
    // Arabic broke that expectation. The breadcrumb bar below deliberately does
    // still flip -- that one is content.
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

      <IconButton
        label={t("settings")}
        onClick={() => go({ name: "settings" })}
        className={cn("no-drag", route.name === "settings" && "text-accent")}
      >
        <Settings size={17} />
      </IconButton>

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
