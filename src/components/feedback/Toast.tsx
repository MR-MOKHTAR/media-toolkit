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
  success: "text-success-text",
  error: "text-danger-text",
  warning: "text-warning-text",
  info: "text-accent",
};

export function Toast({
  toasts,
  onDismiss,
  onHold,
}: {
  toasts: ToastState[];
  isRtl?: boolean;
  onDismiss: (id: string) => void;
  onHold: (holding: boolean) => void;
}) {
  const { t } = useTranslation();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 end-4 z-[60] flex max-w-sm flex-col gap-2"
      onMouseEnter={() => onHold(true)}
      onMouseLeave={() => onHold(false)}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "flex w-full items-start gap-2.5 rounded-lg border border-line bg-surface p-3 shadow-(--shadow-panel)",
            "animate-[fade-in_var(--duration-base)_var(--ease-out-quart)]",
          )}
          role={toast.type === "error" ? "alert" : "status"}
        >
          <ToastIcon type={toast.type} />

          <div className="min-w-0 flex-1">
            <p className="line-clamp-3 text-sm text-fg">{toast.message}</p>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
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
            className="-m-1.5 flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            aria-label={t("close")}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function ToastIcon({ type }: { type: ToastType }) {
  const Icon = ICONS[type];
  return <Icon size={17} className={cn("mt-0.5 shrink-0", TONES[type])} />;
}
