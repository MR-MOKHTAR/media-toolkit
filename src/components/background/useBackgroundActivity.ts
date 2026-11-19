import { useEffect, useState } from "react";

import * as ipc from "../../lib/ipc";

export interface BackgroundActivity {
  /** Someone can see the window: not in the tray, not minimised, not a hidden
   *  tab in `vite dev`. Nothing animates while this is false. */
  visible: boolean;
  /** The window has focus. Unfocused, the background keeps moving at a lower
   *  frame rate -- it is still on screen, just not being looked at. */
  focused: boolean;
  /** The OS asks for less motion. The background then draws one still frame. */
  reducedMotion: boolean;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Whether the living background has anyone to draw for.
 *
 * Three sources, because no one of them is enough on WebKitGTK: a window hidden
 * into the tray reports nothing to the page (Rust tells us -- see `tray.rs`), a
 * minimised one only resizes, and `visibilitychange` covers the browser during
 * development. Also writes `data-bg-paused` on <html>, which is what stops the
 * CSS layer's animations; the WebGL scene reads the returned flags.
 */
export function useBackgroundActivity(): BackgroundActivity {
  const [trayVisible, setTrayVisible] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const [focused, setFocused] = useState(() => document.hasFocus());
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.(REDUCED_MOTION).matches ?? false,
  );

  useEffect(() => {
    let disposed = false;
    const stops: Array<() => void> = [];
    const keep = (promise: Promise<() => void>) =>
      promise
        .then((stop) => (disposed ? stop() : stops.push(stop)))
        // No native window in `vite dev`: the page's own signals are all there is.
        .catch(() => undefined);

    keep(ipc.onAppVisibility((visible) => {
      setTrayVisible(visible);
      if (visible) setMinimized(false);
    }));
    keep(ipc.onWindowFocusChange(setFocused));
    keep(ipc.onWindowResized(() => {
      void ipc.isWindowMinimized().then((value) => {
        if (!disposed) setMinimized(value);
      });
    }));

    const onVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    const media = window.matchMedia?.(REDUCED_MOTION);
    const onMotion = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    media?.addEventListener("change", onMotion);

    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      media?.removeEventListener("change", onMotion);
    };
  }, []);

  const visible = trayVisible && pageVisible && !minimized;

  useEffect(() => {
    const root = document.documentElement;
    if (visible) delete root.dataset.bgPaused;
    else root.dataset.bgPaused = "";
  }, [visible]);

  return { visible, focused, reducedMotion };
}
