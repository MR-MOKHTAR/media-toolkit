import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Moon, RefreshCw, Sun, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Segmented";
import { cn } from "../../lib/cn";
import * as ipc from "../../lib/ipc";
import type { AppLanguage } from "../../hooks/useAppPreferences";
import type { ToastType } from "../../types/feedback";
import { describe } from "../media/useMediaJob";
import type { ToolStatus } from "../jobs/types";
import { ApiKeyPanel } from "./ApiKeyPanel";

interface Props {
  darkMode: boolean;
  onToggleTheme: () => void;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  notify: (type: ToastType, message: string) => void;
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
  notify,
}: Props) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    void ipc.getToolStatus().then(setTools).catch(() => undefined);
  }, []);

  // yt-dlp breaks against YouTube every few weeks. New installs get a current
  // build, but someone who installed months ago is stuck with what shipped, so
  // this is the only thing standing between them and a downloader that has
  // quietly stopped working.
  const updateYtdlp = async () => {
    setUpdating(true);
    try {
      const result = await ipc.updateYtdlp();
      notify(
        "success",
        result.changed
          ? t("ytdlp_updated", { version: result.current })
          : t("ytdlp_already_current", { version: result.current }),
      );
      setTools(await ipc.getToolStatus());
    } catch (error) {
      notify("error", describe(ipc.toAppError(error), t));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6 px-6 py-6">
      <h1 className="text-center text-xl font-semibold text-fg">{t("settings")}</h1>

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
        <h2 className="text-sm font-medium text-fg-soft">{t("transcription")}</h2>
        <ApiKeyPanel notify={notify} />
        <p className="text-xs text-fg-muted">{t("api_key_note")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-fg-soft">{t("bundled_tools")}</h2>
        <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
          {(["ytdlp", "ffmpeg", "ffprobe"] as const).map((tool) => {
            // Three states, not two. Defaulting the unknown one to false meant
            // every tool flashed a red "not installed" before the answer
            // arrived -- a claim the app had not checked yet.
            const ok = tools ? tools[tool] : null;
            return (
              <div key={tool} className="flex items-center gap-2 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-base text-fg" dir="ltr">
                  {tool === "ytdlp" ? "yt-dlp" : tool}
                  {tool === "ytdlp" && tools?.ytdlpVersion && (
                    <span className="ms-2 text-xs text-fg-muted tnum">
                      {tools.ytdlpVersion}
                    </span>
                  )}
                </span>
                {tool === "ytdlp" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={updating}
                    onClick={() => void updateYtdlp()}
                  >
                    {updating ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {t("check_for_updates")}
                  </Button>
                )}
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 text-sm",
                    ok === null
                      ? "text-fg-muted"
                      : ok
                        ? "text-success"
                        : "text-danger",
                  )}
                >
                  {ok === null ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      {t("tool_checking")}
                    </>
                  ) : ok ? (
                    <>
                      <CheckCircle2 size={15} />
                      {t("tool_ready")}
                    </>
                  ) : (
                    <>
                      <XCircle size={15} />
                      {t("tool_missing")}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-fg-muted">{t("tools_bundled_note")}</p>
        <p className="text-xs text-fg-muted">{t("ytdlp_update_note")}</p>
      </section>
    </div>
  );
}
