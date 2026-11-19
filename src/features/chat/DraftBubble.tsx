import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import type { JobKind } from "../jobs/types";
import { AppMessage } from "./ChatThread";

/**
 * A tool's form, as the app's reply in the conversation rather than a dialog
 * over it: the preview and the choices for what was just sent, with the button
 * that starts it. Starting it turns this into the job's own message.
 *
 * Takes what `ToolDialog` took, so the forms did not have to change shape to
 * move into the thread. `dirty` and `wide` have nothing to guard or widen any
 * more -- there is no outside to click and the thread is already as wide as a
 * message gets -- and are accepted so the two can be swapped.
 */
export function DraftBubble({
  tool,
  onClose,
  footer,
  children,
}: {
  tool: string;
  onClose: () => void;
  footer: ReactNode;
  dirty?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);

  // Into view, and the first control focused -- what the dialog used to do on
  // opening. Not a text field when there is none: the drop zone says so with
  // `data-autofocus`.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    element.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const first = element.querySelector<HTMLElement>(
      '[data-autofocus], input:not([type="hidden"]), textarea, select',
    );
    first?.focus({ preventScroll: true });
  }, []);

  return (
    <div ref={root} className="scroll-mb-4">
      <AppMessage kind={tool as JobKind}>
        <section
          aria-label={t(`tool_${tool}`)}
          className={cn(
            "glass-card relative flex flex-col overflow-hidden rounded-2xl rounded-es-md border",
            "holo-rim [--rim-over:1px] [--rim-opacity:0.55]",
            "animate-[scale-in_var(--duration-base)_var(--ease-out-quart)]",
          )}
        >
          <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="holo-text min-w-0 flex-1 truncate text-sm font-semibold">
              {t(`tool_${tool}`)}
            </span>
            <IconButton label={t("cancel_button")} onClick={onClose}>
              <X size={16} />
            </IconButton>
          </header>
          <div className="flex flex-col gap-5 px-4 py-4">{children}</div>
          <div className="border-t border-line px-4 py-3">{footer}</div>
        </section>
      </AppMessage>
    </div>
  );
}
