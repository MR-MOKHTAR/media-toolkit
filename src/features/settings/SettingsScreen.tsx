import { useState, type ReactNode } from "react";
import {
  Captions,
  FolderOpen,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { FormCard } from "../../components/ui/Card";
import { cn } from "../../lib/cn";
import type { AppLanguage } from "../../hooks/useAppPreferences";
import type { ToastType } from "../../types/feedback";
import { ApiKeyPanel } from "./ApiKeyPanel";
import { GeneralPanel } from "./GeneralPanel";
import { StoragePanel } from "./StoragePanel";
import { ToolsPanel } from "./ToolsPanel";

interface Props {
  darkMode: boolean;
  onToggleTheme: () => void;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  notify: (type: ToastType, message: string) => void;
}

interface SectionDefinition {
  key: string;
  /** An existing string wherever there was already a word for the section, so
   *  the rail and the heading inside the card cannot drift apart. */
  labelKey: string;
  icon: LucideIcon;
}

/**
 * The sections, in the order the rail lists them.
 *
 * General first because theme and language are what people come here to change;
 * bundled tools last because it is a status report, not a setting.
 */
const SECTIONS: SectionDefinition[] = [
  { key: "general", labelKey: "settings_general", icon: SlidersHorizontal },
  { key: "storage", labelKey: "storage", icon: FolderOpen },
  { key: "transcription", labelKey: "transcription", icon: Captions },
  { key: "tools", labelKey: "bundled_tools", icon: Wrench },
];

/**
 * Settings, as a second sidebar and a panel.
 *
 * It was one card holding all four groups end to end, which meant the answer to
 * "where do my files go" was somewhere down a page that also carried a theme
 * switch, an API key and three version checks. Splitting it the way VS Code,
 * macOS System Settings and every modern preferences window do gives each group
 * the whole panel and turns finding one into a single click.
 *
 * The list of sections is *attached to the window*, not to the card. It used to
 * float in the middle of the canvas beside a vertically centred card -- two
 * loose boxes with nothing anchoring either -- which read as a layout accident
 * rather than as navigation. Now it is a column flush against the app sidebar,
 * full height, with its own rule and tint: the same thing the sidebar next to it
 * is, so the two read as one continuous rail into the panel.
 *
 * Below `sm` that column becomes a thin tab bar pinned to the top of the screen
 * instead: at the 600px minimum window width there is not room for both a column
 * of labels and a form, and the panel is the half that has to keep its width.
 * Either way the list sits against an edge, never in open canvas.
 */
export function SettingsScreen({
  darkMode,
  onToggleTheme,
  language,
  onLanguageChange,
  notify,
}: Props) {
  const { t } = useTranslation();
  const [active, setActive] = useState(SECTIONS[0].key);
  const section = SECTIONS.find((item) => item.key === active) ?? SECTIONS[0];

  // Each section is its panel plus the sentence that explains it. The notes stay
  // here rather than inside the panels because a panel is also used on its own --
  // ApiKeyPanel appears on the transcribe screen, where the note is not wanted.
  const body: Record<string, ReactNode> = {
    general: (
      <GeneralPanel
        darkMode={darkMode}
        onToggleTheme={onToggleTheme}
        language={language}
        onLanguageChange={onLanguageChange}
      />
    ),
    storage: (
      <>
        <StoragePanel notify={notify} />
        <p className="text-xs text-fg-muted">{t("library_note")}</p>
      </>
    ),
    transcription: (
      <>
        <ApiKeyPanel notify={notify} />
        <p className="text-xs text-fg-muted">{t("api_key_note")}</p>
      </>
    ),
    tools: (
      <>
        <ToolsPanel notify={notify} />
        <p className="text-xs text-fg-muted">{t("tools_bundled_note")}</p>
        <p className="text-xs text-fg-muted">{t("ytdlp_update_note")}</p>
      </>
    ),
  };

  return (
    // `h-full`, not `min-h-full`: the rail has to reach the bottom of the window
    // whether the panel is a single switch or a list of tool versions, and it
    // can only do that if this row has the window's height rather than the
    // content's. The panel then carries the scrolling, which also means changing
    // section never scrolls the rail out of reach.
    <div className="flex h-full min-h-0 flex-col sm:flex-row">
      <nav
        aria-label={t("settings_sections")}
        className={cn(
          "flex shrink-0 gap-1 border-line bg-surface-soft",
          // Narrow: a tab bar across the top. It wraps rather than scrolls --
          // four labels do not fit 600px of window in any of the three
          // languages, and a tab that has to be scrolled into view is a tab
          // nobody finds.
          "flex-wrap border-b p-2",
          // Wide: a column against the app sidebar, sharing its tint and rule.
          "sm:w-48 sm:flex-col sm:flex-nowrap sm:overflow-y-auto sm:border-b-0 sm:border-e sm:p-2 lg:w-56",
        )}
      >
        {SECTIONS.map(({ key, labelKey, icon: Icon }) => {
          const selected = key === section.key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm text-start",
                "transition-colors duration-[--duration-fast]",
                // The marker the app sidebar uses for the screen you are on,
                // borrowed only in the column form -- on a row of tabs a bar
                // down the leading edge points at nothing.
                "sm:w-full sm:border-s-2 sm:ps-2.5",
                selected
                  ? "bg-accent-soft font-medium text-accent sm:border-accent"
                  : "text-fg-soft hover:bg-surface-hover hover:text-fg sm:border-transparent",
              )}
            >
              <Icon size={16} className="shrink-0" />
              <span className="truncate">{t(labelKey)}</span>
            </button>
          );
        })}
      </nav>

      {/* The panel scrolls, not the window: the rail beside it is fixed
          furniture. `min-w-0` so a long path inside can truncate rather than
          widening the row past the window. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6">
        <FormCard className="mx-auto w-full max-w-2xl">
          <h2 className="text-base font-medium text-fg">{t(section.labelKey)}</h2>
          {body[section.key]}
        </FormCard>
      </div>
    </div>
  );
}
