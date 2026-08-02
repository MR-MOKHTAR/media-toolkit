import { useCallback, useEffect, useState } from "react";
import type { ToastAction, ToastState, ToastType } from "../types/feedback";

export type { ToastAction, ToastState, ToastType } from "../types/feedback";

/** Three at once. The queue runs up to four jobs in parallel, so a single slot
 *  meant simultaneous finishes erased each other; more than three and the stack
 *  covers the screen it is reporting about. */
const MAX_VISIBLE = 3;

const LIFETIME_MS = { error: 7000, other: 5200 } as const;

export function useToast() {
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const notify = useCallback(
    (type: ToastType, message: string, options?: { action?: ToastAction }) => {
      const toast: ToastState = {
        id: crypto.randomUUID(),
        type,
        message,
        expiresAt:
          Date.now() + (type === "error" ? LIFETIME_MS.error : LIFETIME_MS.other),
        action: options?.action,
      };
      // Drops from the front, so the newest news is never the one pushed out.
      setToasts((current) => [...current, toast].slice(-MAX_VISIBLE));
    },
    [],
  );

  /** With an id, dismisses that one; without, clears the stack. */
  const dismiss = useCallback((id?: string) => {
    setToasts((current) =>
      id === undefined ? [] : current.filter((toast) => toast.id !== id),
    );
  }, []);

  // One timer for whichever toast expires first, rather than a timer per toast
  // kept in a ref map. Re-armed on every change to the stack, and every wake-up
  // sweeps all of them, so a toast can never outlive its deadline.
  useEffect(() => {
    if (toasts.length === 0) return;

    const soonest = Math.min(...toasts.map((toast) => toast.expiresAt));
    const timer = window.setTimeout(
      () => {
        const now = Date.now();
        setToasts((current) => current.filter((toast) => toast.expiresAt > now));
      },
      Math.max(0, soonest - Date.now()),
    );

    return () => window.clearTimeout(timer);
  }, [toasts]);

  return { toasts, notify, dismiss };
}
