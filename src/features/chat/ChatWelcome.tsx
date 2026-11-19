import { ClipboardPaste, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ToolRoute } from "../../app/navigation";
import { TOOL_ICON } from "../../app/tools";
import { ToolIllustration } from "../../components/illustrations/ToolIllustration";
import { Button } from "../../components/ui/Button";

/**
 * An empty conversation: what a chat app shows before the first message --
 * the tool's mark and name, a line on how to start, and a couple of
 * one-click starts.
 */
export function ChatWelcome({
  kind,
  onPaste,
  onBrowse,
}: {
  kind: ToolRoute["name"];
  onPaste: () => void;
  onBrowse: () => void;
}) {
  const { t } = useTranslation();
  const Icon = TOOL_ICON[kind];

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 py-10 text-center">
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 -z-10 scale-150 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--tool-a)_30%,transparent),transparent_70%)]" />
        <ToolIllustration kind={kind} />
      </div>
      <div className="flex flex-col items-center gap-2">
        {Icon && (
          <span className="tool-tile holo-rim holo-rim-live relative flex size-12 items-center justify-center rounded-2xl">
            <Icon size={22} strokeWidth={1.85} />
          </span>
        )}
        <h2 className="holo-text text-2xl font-semibold">{t(`tool_${kind}`)}</h2>
        <p className="max-w-md text-sm text-fg-muted">
          {kind === "download" ? t("chat_welcome_link") : t("chat_welcome_file")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {kind === "download" ? (
          <Button variant="secondary" icon={<ClipboardPaste size={16} />} onClick={onPaste}>
            {t("chat_suggest_paste")}
          </Button>
        ) : (
          <Button variant="secondary" icon={<FolderOpen size={16} />} onClick={onBrowse}>
            {t("chat_suggest_browse")}
          </Button>
        )}
      </div>
    </div>
  );
}
