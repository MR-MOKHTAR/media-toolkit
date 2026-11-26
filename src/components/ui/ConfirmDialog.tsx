import type { ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useTranslation } from "react-i18next";

import { Button } from "./Button";
import { cn } from "../../lib/cn";

interface ConfirmDialogProps {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>

      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-scrim",
            "data-[state=open]:animate-[fade-in_var(--duration-fast)_var(--ease-out-quart)]",
          )}
        />

        <AlertDialog.Content
          onEscapeKeyDown={(event) => event.stopPropagation()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(25rem,calc(100vw-2rem))]",
            "-translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-xl border border-line bg-surface p-5 shadow-(--shadow-panel)",
            "data-[state=open]:animate-[scale-in_var(--duration-base)_var(--ease-out-quart)]",
            "focus:outline-none",
          )}
        >
          <AlertDialog.Title className="text-base font-semibold text-fg">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-fg-soft">
            {description}
          </AlertDialog.Description>

          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">{t("cancel_button")}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="danger" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
