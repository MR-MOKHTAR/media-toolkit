import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLabel } from "../../components/ui/Card";
import { Segmented } from "../../components/ui/Segmented";
import type { AppLanguage } from "../../hooks/useAppPreferences";

interface Props {
  darkMode: boolean;
  onToggleTheme: () => void;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
}

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
}: Props) {
  const { t } = useTranslation();

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
          options={[
            { value: "en", label: "English" },
            { value: "fa", label: "فارسی" },
            { value: "ar", label: "العربية" },
          ]}
        />
      </section>
    </>
  );
}
