import { useCallback, useEffect, useState } from "react";

import type { SettingsSection } from "../../app/navigation";

const STORAGE_KEY = "downloader-settings-section";

/** The order the rail lists the panels in, which is also the priority order:
 *  what everyone changes first, then what applies to every tool, then the two
 *  tools' own standing preferences, then the status report.
 *
 *  Kept here rather than in the screen because the stored section has to be
 *  checked against it -- a build that renames or drops a panel must not leave
 *  Settings opening on a section that no longer exists. */
export const SETTINGS_SECTIONS = [
  "general",
  "storage",
  "downloads",
  "transcription",
  "tools",
] as const;

function isSection(value: unknown): value is SettingsSection {
  return SETTINGS_SECTIONS.includes(value as SettingsSection);
}

function load(): SettingsSection {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isSection(stored)) return stored;
  } catch {
    // Fall through to the first panel when storage is unavailable.
  }

  return SETTINGS_SECTIONS[0];
}

/**
 * Which panel Settings is showing, remembered between visits.
 *
 * Settings is unmounted the moment another screen is opened, so plain state
 * meant every trip back started on General -- including the trip you make right
 * after leaving, because you got the folder half right the first time. Anyone
 * adjusting one thing repeatedly paid a click each time to get back to where
 * they already were. The theme, the language and the sidebar are all remembered
 * across runs the same way, so the section is stored rather than merely held.
 *
 * `initial` overrides it, and keeps overriding it: a tool form linking to the
 * panel that holds its own preference is a request for that panel specifically,
 * and Settings may already be the screen you are on -- in which case nothing
 * remounts and only this effect can move the selection.
 */
export function useSettingsSection(initial?: SettingsSection) {
  const [section, setSection] = useState<SettingsSection>(initial ?? load);

  useEffect(() => {
    if (initial) setSection(initial);
  }, [initial]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, section);
    } catch {
      // The selection still holds for as long as this screen is open.
    }
  }, [section]);

  const select = useCallback((next: SettingsSection) => setSection(next), []);

  return { section, select };
}
