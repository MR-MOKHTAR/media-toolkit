import { ArrowLeft, ArrowRight, Minus, Settings, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { cn } from "../../lib/cn";
import { IconButton } from "../ui/Button";

interface AppTitleBarProps {
  title: string;
  isMaximized: boolean;
  isRtl: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

/**
 * Back, title, drag area, settings, window controls. Nothing else.
 *
 * What used to be here: a gradient "New Download" call to action, a theme
 * toggle and a raw <select> for the language, all crammed into 40px next to
 * the window buttons. Theme and language are set once per install and belong
 * in Settings, and the primary action is now a card on the home screen.
 */
export function AppTitleBar({
  title,
  isMaximized,
  isRtl,
  onMinimize,
  onToggleMaximize,
  onClose,
}: AppTitleBarProps) {
  const { t } = useTranslation();
  const { go, back, canGoBack, route } = useNavigation();
  // lucide does not mirror directional icons, so the arrow has to be chosen.
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
      <IconButton
        label={t("back")}
        onClick={back}
        disabled={!canGoBack}
        className={cn("no-drag", !canGoBack && "invisible")}
      >
        <BackIcon size={17} />
      </IconButton>

      {/* The drag region has to be its own element. Marking the header would
          swallow clicks on the buttons inside it. */}
      <div
        data-tauri-drag-region
        className="drag-region flex h-full flex-1 items-center px-1 text-sm font-medium text-fg-soft"
      >
        <span data-tauri-drag-region className="truncate">
          {title}
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
