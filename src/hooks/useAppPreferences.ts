import { useCallback, useEffect, useState } from "react";
import i18n from "../i18n";
import * as ipc from "../lib/ipc";

const THEME_STORAGE_KEY = "downloader-theme";
const LANGUAGE_STORAGE_KEY = "downloader-language";
const WELCOME_STORAGE_KEY = "downloader-welcomed";
const EFFECTS_STORAGE_KEY = "downloader-effects";

const CANVAS = { dark: "#282a36", light: "#f4f5f7" } as const;

export type AppLanguage = "en" | "fa" | "ar";

export type EffectsLevel = "lite" | "off";

function getInitialEffects(): EffectsLevel {
  try {
    const stored = localStorage.getItem(EFFECTS_STORAGE_KEY);
    if (stored === "off") return "off";
  } catch {
    // Default below.
  }
  return "lite";
}

export const LANGUAGES: {
  value: AppLanguage;
  label: string;
  code: string;
}[] = [
  { value: "fa", label: "فارسی", code: "FA" },
  { value: "en", label: "English", code: "EN" },
  { value: "ar", label: "العربية", code: "AR" },
];

function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "en" || value === "fa" || value === "ar";
}

function getInitialDarkMode() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) !== "light";
  } catch {
    return true;
  }
}

function getInitialLanguage(): AppLanguage {
  try {
    const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isAppLanguage(storedLanguage)) return storedLanguage;
  } catch {
    // Fall back to configured i18n language.
  }

  return isAppLanguage(i18n.language) ? i18n.language : "en";
}

function hasLocalLanguageChoice(): boolean {
  try {
    if (localStorage.getItem(WELCOME_STORAGE_KEY) === "1") return true;
    const existing = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isAppLanguage(existing)) {
      localStorage.setItem(WELCOME_STORAGE_KEY, "1");
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function persistLanguageLocally(language: AppLanguage) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore when storage is unavailable.
  }
}

function markWelcomedLocally() {
  try {
    localStorage.setItem(WELCOME_STORAGE_KEY, "1");
  } catch {
    // Ignore when storage is unavailable.
  }
}

export function useAppPreferences() {
  const [darkMode, setDarkMode] = useState(getInitialDarkMode);
  const [language, setLanguageState] = useState<AppLanguage>(getInitialLanguage);
  const [languageSaved, setLanguageSaved] = useState(hasLocalLanguageChoice);
  const [needsWelcome, setNeedsWelcome] = useState(false);
  const [effects, setEffects] = useState<EffectsLevel>(getInitialEffects);

  // Sync language preference with persistent backend settings.json so a fresh
  // install asks once and remembers permanently across restarts/updates.
  useEffect(() => {
    let cancelled = false;
    const alreadySavedLocally = hasLocalLanguageChoice();
    void ipc
      .getAppLanguage()
      .then((saved) => {
        if (cancelled) return;
        if (isAppLanguage(saved)) {
          setLanguageState(saved);
          persistLanguageLocally(saved);
          markWelcomedLocally();
          setLanguageSaved(true);
          setNeedsWelcome(false);
        } else if (alreadySavedLocally) {
          // Migrate an existing localStorage choice into settings.json.
          void ipc.setAppLanguage(language).catch(() => undefined);
        } else {
          setNeedsWelcome(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (!alreadySavedLocally) {
          setNeedsWelcome(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // Run once at startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.effects = effects;
    try {
      localStorage.setItem(EFFECTS_STORAGE_KEY, effects);
    } catch {
      // Applies for this session only.
    }
  }, [effects]);

  useEffect(() => {
    const root = document.documentElement;
    const canvas = darkMode ? CANVAS.dark : CANVAS.light;

    root.classList.toggle("dark", darkMode);
    root.style.background = canvas;
    root.style.colorScheme = darkMode ? "dark" : "light";
    void ipc.setWindowBackground(canvas);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, darkMode ? "dark" : "light");
    } catch {
      // Visual preference still applies for this session.
    }
  }, [darkMode]);

  useEffect(() => {
    const rtl = language === "fa" || language === "ar";
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.documentElement.lang = language;

    // Only persist automatically after the first-run language prompt is completed,
    // so mounting before the user confirms never skips the prompt.
    if (languageSaved) {
      persistLanguageLocally(language);
    }

    void i18n.changeLanguage(language).then(() => {
      void ipc.setWindowTitle(i18n.t("app_name"));
      void ipc.setTrayLabels(i18n.t("tray_show"), i18n.t("tray_quit"));
    });
  }, [language, languageSaved]);

  const setLanguage = useCallback(
    (next: AppLanguage) => {
      setLanguageState(next);
      if (languageSaved) {
        persistLanguageLocally(next);
        void ipc.setAppLanguage(next).catch(() => undefined);
      }
    },
    [languageSaved],
  );

  const toggleDarkMode = useCallback(() => {
    setDarkMode((current) => !current);
  }, []);

  const completeWelcome = useCallback(() => {
    setNeedsWelcome(false);
    setLanguageSaved(true);
    persistLanguageLocally(language);
    markWelcomedLocally();
    void ipc.setAppLanguage(language).catch(() => undefined);
  }, [language]);

  return {
    darkMode,
    setDarkMode,
    toggleDarkMode,
    language,
    setLanguage,
    needsWelcome,
    completeWelcome,
    effects,
    setEffects,
  };
}
