import { Copy, Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../ui/Button";
import { AppIdentity } from "./AppIdentity";

interface AppTitleBarProps {
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  showTitle: boolean;
}

export function AppTitleBar({
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
  showTitle,
}: AppTitleBarProps) {
  const { t } = useTranslation();

  return (
    <header className="glass-chrome flex h-11 shrink-0 items-center gap-1 border-b px-2">
      <div
        data-tauri-drag-region
        className="drag-region flex h-full min-w-0 flex-1 items-center px-2"
      >
        {showTitle && <AppIdentity />}
      </div>

      <div className="no-drag ms-1 flex items-center">
        <div className="flex items-center">
          <IconButton label={t("minimize")} onClick={onMinimize}>
            <Minus size={16} />
          </IconButton>
          <IconButton
            label={isMaximized ? t("restore") : t("maximize")}
            onClick={onToggleMaximize}
          >
            {isMaximized ? <Copy size={13} className="-scale-x-100" /> : <Square size={13} />}
          </IconButton>
          <IconButton
            label={t("close")}
            onClick={onClose}
            className="hover:bg-danger hover:text-white"
          >
            <X size={17} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
