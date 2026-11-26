import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fa from "./locales/fa.json";
import ar from "./locales/ar.json";

function detectInitialLanguage(): "en" | "fa" | "ar" {
  try {
    const stored = localStorage.getItem("downloader-language");
    if (stored === "en" || stored === "fa" || stored === "ar") return stored;
  } catch {
    // Ignore storage access errors.
  }

  const nav = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "";
  if (nav.startsWith("fa")) return "fa";
  if (nav.startsWith("ar")) return "ar";
  return "en";
}

i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fa: { translation: fa },
    ar: { translation: ar },
  },
  lng: detectInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18next;
