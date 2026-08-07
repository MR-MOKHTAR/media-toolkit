import { useCallback, useEffect, useState } from "react";
import i18n from "../i18n";
import * as ipc from "../lib/ipc";

/** Also read by the bootstrap script in index.html, which has to answer this
 *  before the bundle exists. Renaming it means renaming it there too. */
const THEME_STORAGE_KEY = "downloader-theme";
const LANGUAGE_STORAGE_KEY = "downloader-language";

/** `--color-canvas` in both themes, as literals.
 *
 *  They are needed outside CSS: the native window and the webview's base layer
 *  are painted through Tauri, and a resize repaints from those before a single
 *  rule applies. Kept beside the same two values in index.html's bootstrap. */
const CANVAS = { dark: "#0c111a", light: "#f3f5f9" } as const;

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
    const root = document.documentElement;
    const canvas = darkMode ? CANVAS.dark : CANVAS.light;

    root.classList.toggle("dark", darkMode);
    // The two layers under the document, kept level with it. index.html sets
    // both for the first paint; this is what carries a *toggle* through to
    // them, so the next resize does not flash the colour of the theme the user
    // just left.
    root.style.background = canvas;
    root.style.colorScheme = darkMode ? "dark" : "light";
    void ipc.setWindowBackground(canvas);

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
