import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { IconButton } from "./Button";
import { cn } from "../../lib/cn";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line under the title. Optional, but a dialog that asks for something
   *  usually has to say what for. */
  description?: string;
  /** Drawn before the title -- a tool's mark, at row height. */
  icon?: ReactNode;
  /** The bottom row, outside the scroll area. The button that submits whatever
   *  the body is holding goes here, so a long form cannot push it out of
   *  reach. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A form, over the screen that asked for it.
 *
 * Three fixed parts -- header, scrolling body, footer -- and the middle one is
 * the only thing that moves. That is the whole reason this exists rather than a
 * taller card: the compress form with a size target set is longer than the 500px
 * window this app allows, and a run button at the end of a long column ends up
 * below the fold exactly when it is being aimed at. Here it sits on the footer
 * and stays put.
 *
 * The look is `ConfirmDialog`'s, deliberately: same scrim, same glass, same
 * corner, same two keyframes. They are the only two dialogs in the app and they
 * should read as one thing appearing, not two.
 *
 * A plain dialog, not the alert variant. Escape and a click outside both mean
 * "not now" here, which is a perfectly good answer to a form -- unlike a
 * confirmation, where dismissing must never be read as consent.
 */
export function Modal({
  open,
  onOpenChange,
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
            "fixed inset-0 z-50 bg-scrim backdrop-blur-sm",
            "data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-out-quart)]",
          )}
        />

        <Dialog.Content
          // Escape has to stop here.
          //
          // NavigationProvider listens for it on `window` and reads it as
          // `back`, so without this one keystroke both closes the dialog and
          // leaves the screen behind it. Radix's own listener is on `document`
          // in the capture phase, which runs before anything on window bubbles
          // -- so stopping propagation from inside this callback is enough, and
          // neither component has to know the other exists.
          onEscapeKeyDown={(event) => event.stopPropagation()}
          // Focus the form, not the way out of it.
          //
          // Radix opens on the first tabbable thing inside the content, which
          // is the close button in the header -- so a dialog opened to paste a
          // link into arrived with the cursor on X and the field one Tab away.
          // These forms all begin with the control the user came to use, so
          // that is what takes the focus; `data-autofocus` lets a form whose
          // first control is not a text field (the drop zone) say so.
          onOpenAutoFocus={(event) => {
            const content = event.currentTarget as HTMLElement | null;
            const first = content?.querySelector<HTMLElement>(
              '[data-autofocus], input:not([type="hidden"]), textarea, select',
            );
            if (!first) return;
            event.preventDefault();
            first.focus();
          }}
          // Radix wants a described-by target or it warns; a dialog with no
          // subtitle simply has none.
          aria-describedby={description ? undefined : ""}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex flex-col",
            // 576px, the width the form card had on the screens this replaces.
            // Capped against the viewport for the 600px window minimum, and
            // against its height for the 500px one -- the body scrolls, the
            // header and footer do not.
            "w-[min(36rem,calc(100vw-2rem))] max-h-[calc(100vh-4rem)]",
            "-translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-xl border border-line-soft shadow-(--shadow-panel)",
            "bg-surface-glass backdrop-blur-glass",
            // scale-in animates `scale`, not `transform`: the two centring
            // utilities above compile to the `translate` property, and a
            // transform in the keyframe would be added to them rather than
            // replace them -- see theme.css.
            "data-[state=open]:animate-[scale-in_var(--duration-base)_var(--ease-out-quart)]",
            "focus:outline-none",
            className,
          )}
        >
          {/* Gradient hairline along the top edge, the same one FormCard and
              ConfirmDialog carry. It marks the primary surface. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-(image:--gradient-accent) opacity-40"
          />

          <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-4">
            {icon}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Dialog.Title className="truncate text-lg font-medium text-fg">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="truncate text-sm text-fg-muted">
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

          {/* min-h-0 is what lets this shrink enough to scroll rather than
              pushing the footer off the bottom of the dialog. */}
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
            {children}
          </div>

          {footer && (
            <div className="shrink-0 border-t border-line px-5 py-4">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
