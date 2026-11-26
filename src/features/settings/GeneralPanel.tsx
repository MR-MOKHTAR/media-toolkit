import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLabel } from "../../components/ui/Card";
import { CheckRow } from "../../components/ui/CheckRow";
import { Segmented } from "../../components/ui/Segmented";
import {
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

      <section className="flex flex-col gap-2">
        <SectionLabel>{t("language")}</SectionLabel>
        <Segmented
          label={t("language")}
          value={language}
          onChange={(value) => onLanguageChange(value as AppLanguage)}
          options={LANGUAGES.map(({ value, label }) => ({ value, label }))}
        />
      </section>

      <CheckRow
        control="switch"
        label={t("effects")}
        hint={t("effects_lite_hint")}
        checked={effects !== "off"}
        onChange={(enabled) => onEffectsChange(enabled ? "lite" : "off")}
      />

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
