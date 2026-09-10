import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Download,
  FolderOpen,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { SettingsSection } from "../../app/navigation";
import { FormCard } from "../../components/ui/Card";
import { navRow } from "../../components/ui/navRow";
import { cn } from "../../lib/cn";
import type { AppLanguage } from "../../hooks/useAppPreferences";
import type { ToastType } from "../../types/feedback";
import { DownloadsPanel } from "./DownloadsPanel";
import { GeneralPanel } from "./GeneralPanel";
import { StoragePanel } from "./StoragePanel";
import { ToolsPanel } from "./ToolsPanel";
import { SETTINGS_SECTIONS, useSettingsSection } from "./useSettingsSection";

interface Props {
  darkMode: boolean;
  onToggleTheme: () => void;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  notify: (type: ToastType, message: string) => void;
  /** Which panel to open on. Set when a tool form sent the user here to change
   *  one particular thing; undefined from the sidebar, which means "wherever
   *  you were last". */
  initialSection?: SettingsSection;
}

interface SectionDefinition {
  /** An existing string wherever there was already a word for the section, so
   *  the rail and the heading inside the card cannot drift apart. */
  labelKey: string;
  /** The line under the heading: what this panel is for, in the words someone
   *  would use when looking for it. It is what makes the rail's one-word labels
   *  answerable without clicking all five. */
  noteKey: string;
  icon: LucideIcon;
}

/**
 * What each section is called, explained and drawn with. A record rather than a
 * list, so the order lives in exactly one place -- `SETTINGS_SECTIONS` -- and a
 * panel added to the route type without a label here fails to compile instead of
 * appearing as a blank tab.
 *
 * That order is priority order rather than the order the panels were written in.
 *
 * General first: theme and language are what people come here for, and they are
 * the only settings that are about the app rather than about a job it runs.
 * Storage second, because it is the one answer every tool depends on -- a
 * download, a compression and a trim all land in that folder -- and "where did
 * my file go" is the question Settings is opened to answer most. Downloads
 * follows: the one tool with standing preferences of its own. Bundled tools
 * last, because it is a status report and a repair button, not a setting --
 * nobody comes to it except when something has broken.
 */
const SECTIONS: Record<SettingsSection, SectionDefinition> = {
  general: {
    labelKey: "settings_general",
    noteKey: "settings_general_note",
    icon: SlidersHorizontal,
  },
  storage: {
    labelKey: "storage",
    noteKey: "library_note",
    icon: FolderOpen,
  },
  downloads: {
    labelKey: "settings_downloads",
    noteKey: "settings_downloads_note",
    icon: Download,
  },
  tools: {
    labelKey: "bundled_tools",
    noteKey: "tools_bundled_note",
    icon: Wrench,
  },
};

/** The rail, as it is listed and stepped through. */
const RAIL = SETTINGS_SECTIONS.map((key) => ({ key, ...SECTIONS[key] }));

/** Whether the rail is a column beside the panel or a bar above it. Read here
 *  rather than left to CSS because the two forms take different arrow keys and
 *  announce a different orientation. Matches the `sm:` breakpoint below. */
function useVerticalRail() {
  const [vertical, setVertical] = useState(
    () => window.matchMedia("(min-width: 640px)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const onChange = (event: MediaQueryListEvent) => setVertical(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return vertical;
}

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
 *
 * These are tabs and are built as tabs -- one stop in the tab order for the
 * whole rail, arrows to move between panels -- rather than as five buttons that
 * each have to be tabbed past to reach the form. That is the pattern the
 * preferences windows this borrows its shape from all use, and it is the
 * difference between reaching the storage folder in two keys and in six.
 */
export function SettingsScreen({
  darkMode,
  onToggleTheme,
  language,
  onLanguageChange,
  notify,
  initialSection,
}: Props) {
  const { t } = useTranslation();
  const { section: active, select } = useSettingsSection(initialSection);
  const definition = SECTIONS[active];
  const vertical = useVerticalRail();
  const tabs = useRef(new Map<SettingsSection, HTMLButtonElement>());

  // Moving the selection *is* moving the focus, which is what makes a tablist a
  // tablist: the panel follows the arrow key rather than waiting for a second
  // keystroke to confirm. Wraps at both ends, so holding one arrow cycles.
  const step = (delta: number) => {
    const count = SETTINGS_SECTIONS.length;
    const index = SETTINGS_SECTIONS.indexOf(active);
    const next = SETTINGS_SECTIONS[(index + delta + count) % count];
    select(next);
    tabs.current.get(next)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // In the column form it is up and down; in the tab bar it is left and
    // right, mirrored under Persian and Arabic, where "next" is to the left.
    const rtl = document.documentElement.dir === "rtl";
    const forward = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    const backward = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";

    const index = SETTINGS_SECTIONS.indexOf(active);
    if (event.key === forward) step(1);
    else if (event.key === backward) step(-1);
    else if (event.key === "Home") step(-index);
    else if (event.key === "End") step(SETTINGS_SECTIONS.length - 1 - index);
    else return;

    // The rail owns these keys once focus is inside it: the arrows would
    // otherwise scroll the panel, and Alt+Left is the app's Back.
    event.preventDefault();
  };

  // Each section is its panel and nothing else. The line that explains it is a
  // property of the section, rendered once under the heading below rather than
  // inside each panel, so a panel stays reusable outside this rail.
  const body: Record<SettingsSection, ReactNode> = {
    general: (
      <GeneralPanel
        darkMode={darkMode}
        onToggleTheme={onToggleTheme}
        language={language}
        onLanguageChange={onLanguageChange}
      />
    ),
    storage: <StoragePanel notify={notify} />,
    downloads: <DownloadsPanel />,
    tools: (
      <>
        <ToolsPanel notify={notify} />
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
      <div
        role="tablist"
        aria-label={t("settings_sections")}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        onKeyDown={onKeyDown}
        className={cn(
          "flex shrink-0 gap-1 border-line bg-surface-soft",
          // Narrow: a tab bar across the top. It wraps rather than scrolls --
          // five labels do not fit 600px of window in any of the three
          // languages, and a tab that has to be scrolled into view is a tab
          // nobody finds.
          "flex-wrap border-b p-2",
          // Wide: a column against the app sidebar, sharing its tint and rule.
          "sm:w-48 sm:flex-col sm:flex-nowrap sm:overflow-y-auto sm:border-b-0 sm:border-e sm:p-2 lg:w-56",
        )}
      >
        {RAIL.map(({ key, labelKey, icon: Icon }) => {
          const selected = key === active;
          return (
            <button
              key={key}
              ref={(node) => {
                if (node) tabs.current.set(key, node);
                else tabs.current.delete(key);
              }}
              type="button"
              role="tab"
              id={`settings-tab-${key}`}
              aria-selected={selected}
              aria-controls={`settings-panel-${key}`}
              // Roving: the rail is one Tab stop, and Tab from it lands on the
              // first control of the panel rather than on the next section.
              tabIndex={selected ? 0 : -1}
              onClick={() => select(key)}
              className={navRow(
                selected ? "active" : "idle",
                cn(
                  // Narrow, this is one tab in a wrapping row, so it sizes to
                  // its label instead of filling the rail.
                  "w-auto shrink-0",
                  // The marker the app sidebar uses for the screen you are on,
                  // borrowed only in the column form -- on a row of tabs a bar
                  // down the leading edge points at nothing.
                  "sm:w-full sm:border-s-2",
                  selected ? "sm:border-accent" : "sm:border-transparent",
                ),
              )}
            >
              <Icon size={16} className="shrink-0" />
              <span className="truncate">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>

      {/* The panel scrolls, not the window: the rail beside it is fixed
          furniture. `min-w-0` so a long path inside can truncate rather than
          widening the row past the window. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6">
        <FormCard
          key={active}
          role="tabpanel"
          id={`settings-panel-${active}`}
          aria-labelledby={`settings-tab-${active}`}
          className="mx-auto w-full max-w-xl xl:max-w-2xl"
        >
          {/* Heading and the line under it are one item, not two spaced by the
              form's gap: the sentence belongs to the title it explains. */}
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-medium text-fg">{t(definition.labelKey)}</h2>
            <p className="text-sm text-fg-muted">{t(definition.noteKey)}</p>
          </div>
          {body[active]}
        </FormCard>
      </div>
    </div>
  );
}
