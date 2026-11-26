import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { IconButton } from "./Button";
import { cn } from "../../lib/cn";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keepOnOutsideClick?: boolean;
  wide?: boolean;
  title: string;
  description?: string;
  icon?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Modal({
  open,
  onOpenChange,
  keepOnOutsideClick,
  wide,
  title,
  description,
  icon,
  footer,
  children,
  className,
}: ModalProps) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-scrim",
            "data-[state=open]:animate-[fade-in_var(--duration-fast)_var(--ease-out-quart)]",
          )}
        />

        <Dialog.Content
          tabIndex={-1}
          onPointerDownOutside={(event) => {
            if (keepOnOutsideClick) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest("[data-own-escape]")) {
              event.preventDefault();
              return;
            }
            event.stopPropagation();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const content = event.currentTarget as HTMLElement | null;
            const first = content?.querySelector<HTMLElement>(
              '[data-autofocus], input:not([type="hidden"]), textarea, select',
            );
            (first ?? content)?.focus();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          aria-describedby={description ? undefined : ""}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex flex-col",
            wide
              ? "w-[min(clamp(42rem,58vw,56rem),calc(100vw-2rem))]"
              : "w-[min(clamp(34rem,46vw,42rem),calc(100vw-2rem))]",
            "max-h-[calc(100vh-3.5rem)]",
            "-translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-panel)",
            "data-[state=open]:animate-[scale-in_var(--duration-base)_var(--ease-out-quart)]",
            "focus:outline-none",
            className,
          )}
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-3.5">
            {icon}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Dialog.Title className="truncate text-base font-semibold text-fg">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="truncate text-xs text-fg-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton label={t("close")}>
                <X size={16} />
              </IconButton>
            </Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            {children}
          </div>

          {footer && (
            <div className="shrink-0 border-t border-line bg-surface-soft px-5 py-3.5">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
