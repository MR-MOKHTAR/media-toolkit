/**
 * The languages offered for transcription.
 *
 * Whisper handles around a hundred; this is the subset worth putting in a list
 * someone has to read. Everything else still works -- it is what "Detect
 * automatically" is for, and detection is reliable enough that naming the
 * language is an accuracy nudge rather than a requirement.
 *
 * Labels are endonyms: someone looking for their own language scans for the
 * word they call it, not for the English name of it. The three the app itself
 * speaks come first; the rest are alphabetical by code.
 */
export interface SpokenLanguage {
  /** ISO-639-1, which is what Groq's `language` parameter takes. */
  code: string;
  label: string;
}

export const SPOKEN_LANGUAGES: SpokenLanguage[] = [
  { code: "fa", label: "فارسی" },
  { code: "ar", label: "العربية" },
  { code: "en", label: "English" },
  { code: "az", label: "Azərbaycanca" },
  { code: "bn", label: "বাংলা" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "he", label: "עברית" },
  { code: "hi", label: "हिन्दी" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "ku", label: "Kurdî" },
  { code: "nl", label: "Nederlands" },
  { code: "ps", label: "پښتو" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "sv", label: "Svenska" },
  { code: "tr", label: "Türkçe" },
  { code: "uk", label: "Українська" },
  { code: "ur", label: "اردو" },
  { code: "zh", label: "中文" },
];
