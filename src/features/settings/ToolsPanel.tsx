import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MinusCircle, RefreshCw, XCircle } from "lucide-react";
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

const BUNDLED = ["ytdlp", "ffmpeg", "ffprobe"] as const;

/** What each row is called, where that is not just the key. */
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

      <JsRuntimeRow name={tools ? tools.jsRuntime : undefined} />
    </Card>
  );
}

/**
 * The JavaScript runtime, which is the one row here that is not a promise.
 *
 * Deno used to be bundled for this and it was 95 MB unpacked -- two thirds of
 * the installer -- so it is not shipped any more. yt-dlp uses whichever of
 * deno, node, bun or quickjs it finds on the machine, and works without any of
 * them: measured against a 4K YouTube video, the same 53 formats came back
 * either way, and the only difference was a warning.
 *
 * So a missing one is not an error and is not drawn as one. It reads as what it
 * is -- an optional thing that is not here -- because a red "Missing" on a row
 * nothing depends on teaches people to ignore the red on the rows that matter.
 */
function JsRuntimeRow({ name }: { name?: string | null }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-fg">
          {t("tool_js_runtime")}
        </span>
        <span className="block truncate text-xs text-fg-muted">
          {t("tool_js_runtime_about")}
        </span>
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 text-sm",
          name === undefined ? "text-fg-muted" : name ? "text-success" : "text-fg-muted",
        )}
      >
        {name === undefined ? (
          <>
            <Loader2 size={15} className="animate-spin" />
            {t("tool_checking")}
          </>
        ) : name ? (
          <>
            <CheckCircle2 size={15} />
            {/* The engine's own name, ltr: "node" is a program, not a word to
                be laid out right to left in Persian. */}
            <span dir="ltr">{name}</span>
          </>
        ) : (
          <>
            <MinusCircle size={15} />
            {t("tool_optional_absent")}
          </>
        )}
      </span>
    </div>
  );
}
