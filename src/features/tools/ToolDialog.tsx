import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { TOOL_ICON } from "../../app/tools";
import { Modal } from "../../components/ui/Modal";

/**
 * The form, over the tool's own list.
 *
 * `Modal` knows nothing about tools; this knows nothing about dialogs. All it
 * does is answer the three questions the modal asks -- title, subtitle, mark --
 * out of the same three things the sidebar row and the screen header already
 * use, so a tool cannot be called one thing in the rail that leads to it and
 * another at the top of the form it opens.
 *
 * Always open: `ToolScreen` mounts this only while the route says `composing`,
 * so a closed form is an unmounted one rather than a hidden one.
 */
export function ToolDialog({
  tool,
  onClose,
  footer,
  children,
}: {
  /** The key `tool_${key}`, `tool_${key}_about` and `TOOL_ICON` all share. */
  tool: string;
  onClose: () => void;
  /** The button that starts the job. It lives on the dialog's footer rather
   *  than at the end of the fields, so it stays put while the form scrolls. */
  footer: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const Icon = TOOL_ICON[tool];

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t(`tool_${tool}`)}
      description={t(`tool_${tool}_about`)}
      icon={
        Icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-(image:--gradient-accent) text-on-accent shadow-(--shadow-glow)">
            <Icon size={18} strokeWidth={1.75} />
          </span>
        )
      }
      footer={footer}
    >
      {children}
    </Modal>
  );
}
