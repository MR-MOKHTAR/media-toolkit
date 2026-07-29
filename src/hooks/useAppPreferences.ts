import { useCallback, useEffect, useState } from "react";
import i18n from "../i18n";

const THEME_STORAGE_KEY = "downloader-theme";
const LANGUAGE_STORAGE_KEY = "downloader-language";

export type AppLanguage = "en" | "fa" | "ar";

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
    // Fall back to the configured i18n language when storage is unavailable.
  }

  return isAppLanguage(i18n.language) ? i18n.language : "en";
}

export function useAppPreferences() {
  const [darkMode, setDarkMode] = useState(getInitialDarkMode);
  const [language, setLanguage] = useState<AppLanguage>(getInitialLanguage);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, darkMode ? "dark" : "light");
    } catch {
      // The visual preference still applies when persistent storage is unavailable.
    }
  }, [darkMode]);

  useEffect(() => {
    const rtl = language === "fa" || language === "ar";
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.documentElement.lang = language;

    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Keep the in-memory preference when persistent storage is unavailable.
    }

    void i18n.changeLanguage(language);
  }, [language]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((current) => !current);
  }, []);

  return { darkMode, setDarkMode, toggleDarkMode, language, setLanguage };
}
