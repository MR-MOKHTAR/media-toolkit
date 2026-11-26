import { useRef, type KeyboardEvent, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Download,
  FolderOpen,
  Globe,
  Settings,
  SlidersHorizontal,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { SettingsSection } from "../../app/navigation";
import { IconButton } from "../../components/ui/Button";
import { navRow } from "../../components/ui/navRow";
import { cn } from "../../lib/cn";
import type { AppLanguage, EffectsLevel } from "../../hooks/useAppPreferences";
import type { ToastType } from "../../types/feedback";
import { DownloadsPanel } from "./DownloadsPanel";
import { GeneralPanel } from "./GeneralPanel";
import { NetworkPanel } from "./NetworkPanel";
import { StoragePanel } from "./StoragePanel";
import { ToolsPanel } from "./ToolsPanel";
import { SETTINGS_SECTIONS, useSettingsSection } from "./useSettingsSection";

interface Props {
  open: boolean;
  onClose: () => void;
  darkMode: boolean;
  onToggleTheme: () => void;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  effects: EffectsLevel;
  onEffectsChange: (effects: EffectsLevel) => void;
  notify: (type: ToastType, message: string) => void;
  initialSection?: SettingsSection;
}

interface SectionDefinition {
  labelKey: string;
  noteKey: string;
  icon: LucideIcon;
}

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
  network: {
    labelKey: "settings_network",
    noteKey: "settings_network_note",
    icon: Globe,
  },
  tools: {
    labelKey: "bundled_tools",
    noteKey: "tools_bundled_note",
    icon: Wrench,
  },
};

const RAIL = SETTINGS_SECTIONS.map((key) => ({ key, ...SECTIONS[key] }));

/**
 * Standalone, self-contained Settings card.
 *
 * Opens as an independent floating dialog card rather than a split-pane screen
 * docked to the main sidebar, keeping whatever tool or task list was open
 * untouched behind it.
 */
export function SettingsScreen({
  open,
  onClose,
  darkMode,
  onToggleTheme,
  language,
  onLanguageChange,
  effects,
  onEffectsChange,
  notify,
  initialSection,
}: Props) {
  const { t } = useTranslation();
  const { section: active, select } = useSettingsSection(initialSection);
  const definition = SECTIONS[active];
  const tabs = useRef(new Map<SettingsSection, HTMLButtonElement>());

  const step = (delta: number) => {
    const count = SETTINGS_SECTIONS.length;
    const index = SETTINGS_SECTIONS.indexOf(active);
    const next = SETTINGS_SECTIONS[(index + delta + count) % count];
    select(next);
    tabs.current.get(next)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = SETTINGS_SECTIONS.indexOf(active);
    if (event.key === "ArrowDown") step(1);
    else if (event.key === "ArrowUp") step(-1);
    else if (event.key === "Home") step(-index);
    else if (event.key === "End") step(SETTINGS_SECTIONS.length - 1 - index);
    else return;

    event.preventDefault();
  };

  const body: Record<SettingsSection, ReactNode> = {
    general: (
      <GeneralPanel
        darkMode={darkMode}
        onToggleTheme={onToggleTheme}
        language={language}
        onLanguageChange={onLanguageChange}
        effects={effects}
        onEffectsChange={onEffectsChange}
      />
    ),
    storage: <StoragePanel notify={notify} />,
    downloads: <DownloadsPanel />,
    network: <NetworkPanel notify={notify} />,
    tools: (
      <>
        <ToolsPanel notify={notify} />
        <p className="text-xs text-fg-muted">{t("ytdlp_update_note")}</p>
      </>
    ),
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-scrim",
            "data-[state=open]:animate-[fade-in_var(--duration-fast)_var(--ease-out-quart)]",
          )}
        />

        <Dialog.Content
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          aria-describedby=""
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex flex-col",
            "w-[min(calc(100vw-2rem),var(--container-fluid))] sm:w-[min(calc(100vw-3rem),var(--container-fluid))]",
            "h-[min(calc(100vh-3.5rem),clamp(34rem,78vh,48rem))]",
            "-translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-panel)",
            "data-[state=open]:animate-[scale-in_var(--duration-base)_var(--ease-out-quart)]",
            "focus:outline-none",
          )}
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-3.5">
            <Settings size={17} className="shrink-0 text-fg-muted" />
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
              {t("settings")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={t("close")}>
                <X size={16} />
              </IconButton>
            </Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <div
              role="tablist"
              aria-label={t("settings_sections")}
              aria-orientation="vertical"
              onKeyDown={onKeyDown}
              className="flex shrink-0 flex-wrap gap-1 border-b border-line bg-surface-soft p-3 sm:w-52 sm:flex-col sm:flex-nowrap sm:overflow-y-auto sm:border-b-0 sm:border-e lg:w-60"
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
                    tabIndex={selected ? 0 : -1}
                    onClick={() => select(key)}
                    className={navRow(
                      selected ? "active" : "idle",
                      "w-auto shrink-0 sm:w-full",
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className="truncate">{t(labelKey)}</span>
                  </button>
                );
              })}
            </div>

            <div
              key={active}
              role="tabpanel"
              id={`settings-panel-${active}`}
              aria-labelledby={`settings-tab-${active}`}
              className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6 lg:px-8"
            >
              <div className="flex flex-col gap-1 border-b border-line pb-3">
                <h2 className="text-base font-semibold text-fg">{t(definition.labelKey)}</h2>
                <p className="text-xs text-fg-muted">{t(definition.noteKey)}</p>
              </div>
              {body[active]}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
