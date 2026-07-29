import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useWindowControls() {
  const [isMaximized, setIsMaximized] = useState(true);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const syncMaximizedState = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        if (!disposed) setIsMaximized(maximized);
      } catch (error) {
        if (!disposed) console.error(error);
      }
    };

    void syncMaximizedState();

    appWindow
      .onResized(() => {
        void syncMaximizedState();
      })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
          return;
        }

        unlisten = stopListening;
      })
      .catch((error) => {
        if (!disposed) console.error(error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const minimize = useCallback(async () => {
    await getCurrentWindow().minimize();
  }, []);

  const toggleMaximize = useCallback(async () => {
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  }, []);

  const close = useCallback(async () => {
    await getCurrentWindow().close();
  }, []);

  return { isMaximized, minimize, toggleMaximize, close };
}
