import { Copy, Minus, Moon, Plus, Square, Sun, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppLanguage } from "../../hooks/useAppPreferences";

interface AppTitleBarProps {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  darkMode: boolean;
  onToggleTheme: () => void;
  isDownloading: boolean;
  isMaximized: boolean;
  onNewDownload: () => void;
  onMinimize: () => void | Promise<void>;
  onToggleMaximize: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
}

export function AppTitleBar({
  language,
  onLanguageChange,
  darkMode,
  onToggleTheme,
  isDownloading,
  isMaximized,
  onNewDownload,
  onMinimize,
  onToggleMaximize,
  onClose,
}: AppTitleBarProps) {
  const { t } = useTranslation();

  return (
    <header className="titlebar" dir="ltr">
      <div className="titlebar-left-actions">
        <button
          className="header-new-download"
          disabled={isDownloading}
          onClick={onNewDownload}
        >
          <Plus size={15} strokeWidth={2.6} />
          <span>{t("new_download")}</span>
        </button>
        <button className="title-button theme-button" onClick={onToggleTheme}>
          {darkMode ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <select
          className="language-select"
          value={language}
          onChange={(event) =>
            onLanguageChange(event.target.value as AppLanguage)
          }
        >
          <option value="en">EN</option>
          <option value="fa">FA</option>
          <option value="ar">AR</option>
        </select>
      </div>
      <div className="titlebar-drag" data-tauri-drag-region />
      <div className="titlebar-window-actions">
        <button
          className="title-button"
          title={t("minimize")}
          onClick={onMinimize}
        >
          <Minus size={16} />
        </button>
        <button
          className="title-button"
          title={isMaximized ? t("restore") : t("maximize")}
          onClick={onToggleMaximize}
        >
          {isMaximized ? (
            <Copy size={13} className="restore-icon" />
          ) : (
            <Square size={13} />
          )}
        </button>
        <button
          className="title-button close-button"
          title={t("close")}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}

export default AppTitleBar;
