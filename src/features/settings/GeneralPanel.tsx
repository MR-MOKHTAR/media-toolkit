import { useEffect, useState } from "react";
import { Moon, Sparkles, Sun, Wind, ZapOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLabel } from "../../components/ui/Card";
import { CheckRow } from "../../components/ui/CheckRow";
import { Segmented } from "../../components/ui/Segmented";
import {
  EFFECTS_LEVELS,
  LANGUAGES,
  type AppLanguage,
  type EffectsLevel,
} from "../../hooks/useAppPreferences";
import * as ipc from "../../lib/ipc";
import type { TraySettings } from "../jobs/types";

interface Props {
  darkMode: boolean;
  onToggleTheme: () => void;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  effects: EffectsLevel;
  onEffectsChange: (effects: EffectsLevel) => void;
}

const EFFECT_ICONS = {
  full: <Sparkles size={16} />,
  lite: <Wind size={16} />,
  off: <ZapOff size={16} />,
} as const;

/**
 * Theme and language: the two things that change how the whole app looks, and
 * the two that are set once per install.
 *
 * They used to live in the title bar -- a permanent gradient button and a raw
 * `<select>` in 40px of window chrome, paid for on every screen. Their own
 * section here, because "General" is the first place anybody looks for them.
 */
export function GeneralPanel({
  darkMode,
  onToggleTheme,
  language,
  onLanguageChange,
  effects,
  onEffectsChange,
}: Props) {
  const { t } = useTranslation();
  const [tray, setTray] = useState<TraySettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ipc
      .getTraySettings()
      .then((settings) => {
        if (!cancelled) setTray(settings);
      })
      // No native side in `vite dev`: the row stays disabled.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <section className="flex flex-col gap-2">
        <SectionLabel>{t("appearance")}</SectionLabel>
        <Segmented
          label={t("appearance")}
          value={darkMode ? "dark" : "light"}
          onChange={(value) => {
            if ((value === "dark") !== darkMode) onToggleTheme();
          }}
          options={[
            { value: "light", label: t("theme_light"), icon: <Sun size={16} /> },
            { value: "dark", label: t("theme_dark"), icon: <Moon size={16} /> },
          ]}
        />
      </section>

      {/* How much the background does. Its own row rather than folded into
          the theme: it is the one appearance choice that is about the machine
          -- a laptop on battery, an old GPU -- rather than about taste. */}
      <section className="flex flex-col gap-2">
        <SectionLabel>{t("effects")}</SectionLabel>
        <Segmented
          label={t("effects")}
          value={effects}
          onChange={onEffectsChange}
          options={EFFECTS_LEVELS.map((value) => ({
            value,
            label: t(`effects_${value}`),
            icon: EFFECT_ICONS[value],
          }))}
        />
        <p className="text-xs text-fg-muted">{t(`effects_${effects}_hint`)}</p>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>{t("language")}</SectionLabel>
        <Segmented
          label={t("language")}
          value={language}
          onChange={(value) => onLanguageChange(value as AppLanguage)}
          // The same list the first-run dialog offers, from one place -- two
          // hand-written copies of three languages are two chances to add a
          // fourth to only one of them.
          options={LANGUAGES.map(({ value, label }) => ({ value, label }))}
        />
      </section>

      {/* A switch: it takes effect the moment it moves, and the next press of
          the close button is the first thing to obey it. */}
      <CheckRow
        control="switch"
        label={t("close_to_tray")}
        hint={tray && !tray.available ? t("close_to_tray_unavailable") : t("close_to_tray_hint")}
        checked={tray?.closeToTray ?? true}
        disabled={!tray?.available}
        onChange={(enabled) => void ipc.setCloseToTray(enabled).then(setTray).catch(() => undefined)}
      />
    </>
  );
}
