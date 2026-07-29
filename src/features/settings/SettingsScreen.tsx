import { useEffect, useState } from "react";
import { CheckCircle2, Moon, Sun, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Segmented } from "../../components/ui/Segmented";
import { cn } from "../../lib/cn";
import * as ipc from "../../lib/ipc";
import type { AppLanguage } from "../../hooks/useAppPreferences";
import type { ToolStatus } from "../jobs/types";

interface Props {
  darkMode: boolean;
  onToggleTheme: () => void;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
}

/**
 * Theme and language live here, not in the titlebar.
 *
 * They are set once per install; a permanent gradient button and a raw
 * <select> in 40px of window chrome was paying for them on every screen.
 */
export function SettingsScreen({
  darkMode,
  onToggleTheme,
  language,
  onLanguageChange,
}: Props) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolStatus | null>(null);

  useEffect(() => {
    void ipc.getToolStatus().then(setTools).catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-6">
      <h1 className="text-xl font-semibold text-fg">{t("settings")}</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-fg-soft">{t("appearance")}</h2>
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
        <h2 className="text-sm font-medium text-fg-soft">{t("language")}</h2>
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

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-fg-soft">{t("bundled_tools")}</h2>
        <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
          {(["ytdlp", "ffmpeg", "ffprobe"] as const).map((tool) => {
            const ok = tools?.[tool] ?? false;
            return (
              <div key={tool} className="flex items-center gap-2 px-3 py-2.5">
                <span className="flex-1 text-base text-fg" dir="ltr">
                  {tool === "ytdlp" ? "yt-dlp" : tool}
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-sm",
                    ok ? "text-success" : "text-danger",
                  )}
                >
                  {ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  {ok ? t("tool_ready") : t("tool_missing")}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-fg-muted">{t("tools_bundled_note")}</p>
      </section>
    </div>
  );
}
