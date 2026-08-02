import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "downloader-sidebar";

/** Below this the sidebar's 240px is a third of the window, so a first-time
 *  visit on a small screen starts as the icon rail instead. Only the first
 *  visit: once there is a stored choice it wins, and resizing never overrides
 *  it -- a window drag that silently rearranges the app is worse than a
 *  sidebar the user has to collapse once. */
const NARROW_WINDOW_PX = 900;

function getInitialCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "collapsed") return true;
    if (stored === "expanded") return false;
  } catch {
    // Fall through to the width guess when storage is unavailable.
  }

  return window.innerWidth < NARROW_WINDOW_PX;
}

/**
 * Whether the sidebar is showing labels or just icons, remembered between
 * runs like the theme and the language.
 */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "collapsed" : "expanded");
    } catch {
      // The choice still applies for this session.
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((current) => !current), []);

  return { collapsed, toggle };
}
