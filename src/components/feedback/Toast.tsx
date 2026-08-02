import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import type { ToastState, ToastType } from "../../types/feedback";

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const TONES: Record<ToastType, string> = {
  success: "text-success",
  error: "text-danger",
  warning: "text-warning",
  info: "text-accent",
};

/**
 * The toast stack.
 *
 * A stack rather than a single slot because the queue runs several jobs at
 * once: when two finished in the same second the first message was replaced
 * before anyone could read it. Oldest first, so new ones arrive at the bottom
 * next to the anchor and the older ones ride up.
 */
export function Toast({
  toasts,
  isRtl,
  onDismiss,
}: {
  toasts: ToastState[];
  isRtl: boolean;
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed bottom-4 z-50 flex max-w-sm flex-col gap-2"
      style={{ insetInlineEnd: "1rem" }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            // `layout` so the survivors slide into the gap when one in the
            // middle of the stack expires, instead of jumping.
            layout
            // Enters from the edge it is anchored to, so it follows the writing
            // direction instead of being branched per language.
            initial={{ opacity: 0, x: isRtl ? -20 : 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isRtl ? -20 : 20 }}
            transition={{ duration: 0.18 }}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-lg",
              "border border-line bg-surface p-3 shadow-(--shadow-panel)",
            )}
            // An error is worth interrupting a screen reader for; the rest are
            // status updates that can wait for a pause.
            role={toast.type === "error" ? "alert" : "status"}
          >
            <ToastIcon type={toast.type} />

            <div className="min-w-0 flex-1">
              {/* Clamped: a job title can be a whole video name, and one toast
                  must not grow tall enough to push the others off screen. */}
              <p className="line-clamp-3 text-sm text-fg">{toast.message}</p>
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onClick();
                    // Acting on a toast answers it, so it has nothing left to say.
                    onDismiss(toast.id);
                  }}
                  className="mt-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-80"
                >
                  {toast.action.label}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 text-fg-muted transition-colors hover:text-fg"
              aria-label={t("close")}
            >
              <X size={15} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastIcon({ type }: { type: ToastType }) {
  const Icon = ICONS[type];
  return <Icon size={17} className={cn("mt-0.5 shrink-0", TONES[type])} />;
}
