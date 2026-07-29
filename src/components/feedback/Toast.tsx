import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

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

export function Toast({
  toast,
  isRtl,
  onClose,
}: {
  toast: ToastState | null;
  isRtl: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          // Enters from the edge it is anchored to, so it follows the writing
          // direction instead of being branched per language.
          initial={{ opacity: 0, x: isRtl ? -20 : 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: isRtl ? -20 : 20 }}
          transition={{ duration: 0.18 }}
          className={cn(
            "fixed bottom-4 z-50 flex max-w-sm items-start gap-2.5 rounded-lg",
            "border border-line bg-surface p-3 shadow-(--shadow-panel)",
          )}
          style={{ insetInlineEnd: "1rem" }}
          role="status"
        >
          <ToastIcon type={toast.type} />
          <p className="flex-1 text-sm text-fg">{toast.message}</p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-fg-muted transition-colors hover:text-fg"
            aria-label="close"
          >
            <X size={15} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ToastIcon({ type }: { type: ToastType }) {
  const Icon = ICONS[type];
  return <Icon size={17} className={cn("mt-0.5 shrink-0", TONES[type])} />;
}
