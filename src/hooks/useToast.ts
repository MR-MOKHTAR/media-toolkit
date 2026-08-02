import { useCallback, useEffect, useState } from "react";
import type { ToastState, ToastType } from "../types/feedback";

export type { ToastState, ToastType } from "../types/feedback";

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((type: ToastType, message: string) => {
    setToast({ id: Date.now(), type, message });
  }, []);

  const dismiss = useCallback(() => {
    setToast(null);
  }, []);

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(
      dismiss,
      toast.type === "error" ? 7000 : 5200,
    );

    return () => window.clearTimeout(timer);
  }, [dismiss, toast]);

  return { toast, notify, dismiss };
}
