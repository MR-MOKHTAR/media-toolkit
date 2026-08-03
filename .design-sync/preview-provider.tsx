/**
 * The context every preview card mounts inside.
 *
 * Four of the exported components read translations, and AppSidebar also reads
 * the navigation and jobs stores. Outside those providers they either render
 * raw i18n keys or throw, so this composes the real ones -- it is scaffolding
 * for the preview harness, not a stand-in for them.
 *
 * Importing src/i18n runs its init at module scope, which is what registers the
 * instance react-i18next falls back to when there is no <I18nextProvider>.
 */
import type { ReactNode } from "react";

import "../src/i18n";
import { NavigationProvider } from "../src/app/navigation";
import { JobsProvider } from "../src/features/jobs/useJobs";

interface TauriHost {
  __TAURI_INTERNALS__?: {
    transformCallback(callback: (payload: unknown) => void): number;
    invoke(): Promise<unknown>;
    convertFileSrc(path: string): string;
  };
}

/**
 * The jobs store subscribes to Tauri events on mount, and outside the desktop
 * shell `@tauri-apps/api` reads `transformCallback` off an object that does not
 * exist -- one TypeError per card, on every component, for a backend a preview
 * was never going to have. A host that answers nothing is the honest browser
 * equivalent: the store mounts, the subscription resolves, no job ever arrives.
 *
 * Runs at module scope, which is before any card mounts -- the reads all happen
 * in effects, not at import.
 */
const host = globalThis as unknown as TauriHost;
if (!host.__TAURI_INTERNALS__) {
  let nextCallbackId = 0;
  const callbacks = new Map<number, (payload: unknown) => void>();
  host.__TAURI_INTERNALS__ = {
    transformCallback(callback) {
      const id = ++nextCallbackId;
      callbacks.set(id, callback);
      return id;
    },
    invoke: () => Promise.resolve(undefined),
    convertFileSrc: (path) => path,
  };
}

export function DesignSystemProvider({ children }: { children: ReactNode }) {
  return (
    <NavigationProvider>
      {/* Jobs reports failures through a toast the harness has nowhere to put,
          so notifications are swallowed here rather than rendered twice. */}
      <JobsProvider notify={() => {}}>{children}</JobsProvider>
    </NavigationProvider>
  );
}
