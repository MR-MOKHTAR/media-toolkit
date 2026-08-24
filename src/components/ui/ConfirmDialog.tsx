import type { ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useTranslation } from "react-i18next";

import { Button } from "./Button";
import { cn } from "../../lib/cn";

interface ConfirmDialogProps {
  /** The control that opens it. Rendered as the trigger, so the focus it had
   *  before the dialog opened is the focus it gets back after. */
  trigger: ReactNode;
  title: string;
  /** What is about to happen, in one line. Say the consequence, not the
   *  action -- the button already names the action. */
  description: string;
  /** The destructive button's label. Names the deed ("Clear", "Reset"), never
   *  "OK", so the two buttons can be told apart without reading the title. */
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * The prompt before something that cannot be undone.
 *
 * An alert dialog rather than a plain one, and the difference is the point:
 * a plain dialog closes on Escape and on a click outside, and for a
 * confirmation both of those are ambiguous -- the user meant to dismiss, and
 * dismissing must never be taken as consent. Radix's alert variant only leaves
 * through one of the two buttons, and opens with focus on Cancel.
 *
 * Cancel comes first in the DOM for that reason. It is the safe answer, so it
 * is the one a return key finds.
 */
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
        {/* fade-in/scale-in are this project's own keyframes. The classes here
            before were `animate-in` and `fade-in-0` from tailwindcss-animate,
            which is not a dependency, so both compiled to nothing and the
            dialog appeared instantly. */}
        <AlertDialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-scrim backdrop-blur-sm",
            "data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-out-quart)]",
          )}
        />

        <AlertDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))]",
            "-translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-line-soft p-5 shadow-(--shadow-panel)",
            "bg-surface-glass backdrop-blur-glass",
            // scale-in carries the centring translate itself -- animating
            // `transform` here would otherwise drop the dialog into the corner
            // for the length of the animation.
            "data-[state=open]:animate-[scale-in_var(--duration-base)_var(--ease-out-quart)]",
            /* Gradient top accent, same as FormCard. */
            "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px",
            "before:bg-(image:--gradient-accent) before:opacity-40 before:rounded-t-xl",
            "relative overflow-hidden",
            "focus:outline-none",
          )}
        >
          <AlertDialog.Title className="text-lg font-medium text-fg">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-fg-soft">
            {description}
          </AlertDialog.Description>

          {/* justify-end, which is logical: the pair sits on the trailing edge
              in both writing directions. */}
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
