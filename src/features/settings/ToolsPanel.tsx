import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { cn } from "../../lib/cn";
import * as ipc from "../../lib/ipc";
import type { ToastType } from "../../types/feedback";
import { describe } from "../media/useMediaJob";
import type { ToolStatus } from "../jobs/types";

interface Props {
  notify: (type: ToastType, message: string) => void;
}

const BUNDLED = ["ytdlp", "ffmpeg", "ffprobe", "deno"] as const;

/** What each row is called, where that is not just the key. `deno` is the
 *  JavaScript runtime yt-dlp runs YouTube's player challenge in, and nobody
 *  installing a media app has any reason to know that -- so the row says what
 *  it is for rather than what it is. */
const TOOL_LABEL: Partial<Record<(typeof BUNDLED)[number], string>> = {
  ytdlp: "yt-dlp",
};

/**
 * Whether the binaries the app is built on are actually there, and the one
 * button that keeps the downloader working.
 *
 * yt-dlp breaks against YouTube every few weeks. A new install ships a current
 * build, but someone who installed months ago is stuck with what came with it,
 * so this update is the only thing standing between them and a downloader that
 * has quietly stopped working.
 */
export function ToolsPanel({ notify }: Props) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    void ipc.getToolStatus().then(setTools).catch(() => undefined);
  }, []);

  const updateYtdlp = async () => {
    setUpdating(true);
    try {
      const result = await ipc.updateYtdlp();
      notify(
        "success",
        result.changed
          ? t("ytdlp_updated", { version: result.current })
          : t("ytdlp_already_current", { version: result.current }),
      );
      setTools(await ipc.getToolStatus());
    } catch (error) {
      notify("error", describe(ipc.toAppError(error), t));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Card padding="none" className="flex flex-col divide-y divide-line">
      {BUNDLED.map((tool) => {
        // Three states, not two. Defaulting the unknown one to false meant every
        // tool flashed a red "not installed" before the answer arrived -- a claim
        // the app had not checked yet.
        const ok = tools ? tools[tool] : null;
        return (
          <div
            key={tool}
            className="flex flex-wrap items-center gap-2 px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-fg" dir="ltr">
              {TOOL_LABEL[tool] ?? tool}
              {tool === "ytdlp" && tools?.ytdlpVersion && (
                <span className="ms-2 text-xs text-fg-muted tnum">
                  {tools.ytdlpVersion}
                </span>
              )}
              {/* The one row whose purpose is not obvious from its name.
                  Written beside it rather than left to a tooltip, because the
                  moment it matters is the moment it says "Missing". */}
              {tool === "deno" && (
                <span className="ms-2 text-xs text-fg-muted">
                  {t("tool_deno_about")}
                </span>
              )}
            </span>
            {tool === "ytdlp" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={updating}
                onClick={() => void updateYtdlp()}
              >
                {updating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {t("check_for_updates")}
              </Button>
            )}
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 text-sm",
                ok === null ? "text-fg-muted" : ok ? "text-success" : "text-danger",
              )}
            >
              {ok === null ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {t("tool_checking")}
                </>
              ) : ok ? (
                <>
                  <CheckCircle2 size={15} />
                  {t("tool_ready")}
                </>
              ) : (
                <>
                  <XCircle size={15} />
                  {t("tool_missing")}
                </>
              )}
            </span>
          </div>
        );
      })}
    </Card>
  );
}
