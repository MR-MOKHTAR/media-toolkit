import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "downloader-sidebar";
const NARROW_WINDOW_PX = 900;

function getInitialCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "collapsed") return true;
    if (stored === "expanded") return false;
  } catch {
    // Fall through to width heuristic when storage is unavailable.
  }

  return window.innerWidth < NARROW_WINDOW_PX;
}

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "collapsed" : "expanded");
    } catch {
      // Applies for this session.
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((current) => !current), []);
  const collapse = useCallback(() => setCollapsed(true), []);

  return { collapsed, toggle, collapse };
}
