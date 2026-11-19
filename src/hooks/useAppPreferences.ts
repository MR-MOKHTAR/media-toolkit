import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_BACKDROP,
  isBackdropId,
  type BackdropId,
} from "../components/background/backdrops";
import i18n from "../i18n";
import * as ipc from "../lib/ipc";

/** Also read by the bootstrap script in index.html, which has to answer this
 *  before the bundle exists. Renaming it means renaming it there too. */
const THEME_STORAGE_KEY = "downloader-theme";
const LANGUAGE_STORAGE_KEY = "downloader-language";
/** Set once the first-run dialog has been answered. Its own key rather than
 *  "is there a language stored": the language is written on the first render
 *  whether anybody chose it or not, so it cannot say whether it was chosen. */
const WELCOME_STORAGE_KEY = "downloader-welcomed";
/** Also read by index.html's bootstrap, so the first paint already has the
 *  right amount of glass. */
const EFFECTS_STORAGE_KEY = "downloader-effects";
const BACKDROP_STORAGE_KEY = "downloader-backdrop";

/** `--color-aurora-base` in both themes, as literals -- the colour the
 *  background is painted on, and so the one a resize should flash, if any.
 *
 *  They are needed outside CSS: the native window and the webview's base layer
 *  are painted through Tauri, and a resize repaints from those before a single
 *  rule applies. Kept beside the same two values in index.html's bootstrap. */
const CANVAS = { dark: "#05051a", light: "#ece8f8" } as const;

export type AppLanguage = "en" | "fa" | "ar";

/**
 * How much the background does.
 *
 * - `full`: the WebGL aurora with floating 3D icons, falling back to `lite` by
 *   itself where WebGL is missing or the GPU cannot keep up.
 * - `lite`: the same aurora drawn with CSS gradients and flat SVG icons.
 * - `off`: a still gradient and opaque surfaces -- no animation, no blur.
 */
export type EffectsLevel = "full" | "lite" | "off";

export const EFFECTS_LEVELS: EffectsLevel[] = ["full", "lite", "off"];

function getInitialBackdrop(): BackdropId {
  try {
    const stored = localStorage.getItem(BACKDROP_STORAGE_KEY);
    if (isBackdropId(stored)) return stored;
  } catch {
    // The default below.
  }
  return DEFAULT_BACKDROP;
}

function isEffectsLevel(value: unknown): value is EffectsLevel {
  return value === "full" || value === "lite" || value === "off";
}

function getInitialEffects(): EffectsLevel {
  try {
    const stored = localStorage.getItem(EFFECTS_STORAGE_KEY);
    if (isEffectsLevel(stored)) return stored;
  } catch {
    // The default below.
  }
  return "full";
}

/**
 * The languages the app speaks, each named in its own script.
 *
 * Endonyms, not translations: a language is named to the person who reads it,
 * and "Persian" is no help to somebody looking for فارسی. It is also what makes
 * the list work on the first-run dialog, where the interface is in a language
 * the user has not chosen yet.
 *
 * One list, shared by Settings and that dialog, so the two can never come to
 * offer different sets.
 */
export const LANGUAGES: {
  value: AppLanguage;
  /** The language's own name for itself. */
  label: string;
  /** The tag, as a second line no script can make ambiguous. */
  code: string;
}[] = [
  { value: "en", label: "English", code: "EN" },
  { value: "fa", label: "فارسی", code: "FA" },
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
    // Fall back to the configured i18n language when storage is unavailable.
  }

  return isAppLanguage(i18n.language) ? i18n.language : "en";
}

/**
 * Whether this is the first time the app has been opened on this machine.
 *
 * Read during the first render rather than in an effect, because the effect
 * below writes the language key on mount -- so by the time effects run, a fresh
 * install is indistinguishable from one that has been asked already.
 *
 * An install from before this dialog existed is not asked: it has a language,
 * chosen or defaulted, and its user has been living with it. Storage that
 * cannot be written is not asked either -- a question whose answer cannot be
 * kept would be asked again at every launch.
 */
function getInitialWelcome(): boolean {
  try {
    if (localStorage.getItem(WELCOME_STORAGE_KEY)) return false;
    if (localStorage.getItem(LANGUAGE_STORAGE_KEY)) {
      localStorage.setItem(WELCOME_STORAGE_KEY, "1");
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function useAppPreferences() {
  const [darkMode, setDarkMode] = useState(getInitialDarkMode);
  const [language, setLanguage] = useState<AppLanguage>(getInitialLanguage);
  const [needsWelcome, setNeedsWelcome] = useState(getInitialWelcome);
  const [effects, setEffects] = useState<EffectsLevel>(getInitialEffects);
  const [backdrop, setBackdrop] = useState<BackdropId>(getInitialBackdrop);

  useEffect(() => {
    try {
      localStorage.setItem(BACKDROP_STORAGE_KEY, backdrop);
    } catch {
      // Applies for this session only.
    }
  }, [backdrop]);

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

    // The window's own title -- the taskbar entry and the window switcher --
    // follows too. It was fixed at "Media Toolkit" in tauri.conf.json, the
    // one English string left in a Persian or Arabic session.
    void i18n.changeLanguage(language).then(() => {
      void ipc.setWindowTitle(i18n.t("app_name"));
      // And the tray menu, which is native and cannot read the webview's strings.
      void ipc.setTrayLabels(i18n.t("tray_show"), i18n.t("tray_quit"));
    });
  }, [language]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((current) => !current);
  }, []);

  /** The first-run dialog is done with -- whichever language it is leaving
   *  behind, including the default nobody touched. */
  const completeWelcome = useCallback(() => {
    setNeedsWelcome(false);
    try {
      localStorage.setItem(WELCOME_STORAGE_KEY, "1");
    } catch {
      // Then it is asked again next launch, which is the best a session with
      // no storage can do -- and `getInitialWelcome` never gets here anyway.
    }
  }, []);

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
    backdrop,
    setBackdrop,
  };
}
