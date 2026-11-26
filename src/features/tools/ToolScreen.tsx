import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { FolderOpen, Plus, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation, type ToolRoute } from "../../app/navigation";
import { TOOL_ICON } from "../../app/tools";
import { Button } from "../../components/ui/Button";
import { formatCount } from "../../lib/format";
import * as ipc from "../../lib/ipc";
import { allUrlsIn, firstUrlIn } from "../../lib/url";
import { JobList } from "../jobs/components/JobList";
import { jobsOfKind } from "../jobs/selectors";
import { useJobs } from "../jobs/useJobs";
import { useDragDropState } from "../media/useDragDropState";

interface Props {
  route: ToolRoute;
  language: string;
  children: (close: () => void) => ReactNode;
}

export function ToolScreen({ route, language, children }: Props) {
  const { t } = useTranslation();
  const { replace } = useNavigation();
  const { jobs } = useJobs();

  const kind = route.name;
  const Icon = TOOL_ICON[kind];
  const mine = useMemo(() => jobsOfKind(jobs, kind), [jobs, kind]);
  const composing = Boolean(route.composing);
  const isDownload = kind === "download";

  const close = useCallback(
    () => replace({ name: kind, composing: false } as ToolRoute),
    [replace, kind],
  );

  const openDownload = useCallback(
    (link?: string) => {
      replace({ name: "download", link, composing: true });
    },
    [replace],
  );

  const openWithFile = useCallback(
    (path: string) => {
      if (kind === "download") return;
      replace({ name: kind, file: path, composing: true });
    },
    [replace, kind],
  );

  const browse = useCallback(async () => {
    try {
      const selected = await ipc.chooseMediaFile(undefined, {
        media: t("picker_media"),
        video: t("format_video"),
        audio: t("format_audio"),
      });
      if (selected) openWithFile(selected);
    } catch {
      // Fallback: open empty form so drag-and-drop still works in web preview.
      if (kind !== "download") replace({ name: kind, composing: true });
    }
  }, [kind, openWithFile, replace, t]);

  const isDragging = useDragDropState(
    (paths) => {
      if (paths[0]) openWithFile(paths[0]);
    },
    !isDownload && !composing,
  );

  // Ctrl+N opens a new task; pasting directly on the Download screen opens the form with the link.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "n" || !(event.ctrlKey || event.metaKey)) return;
      if (event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      event.preventDefault();
      if (isDownload) openDownload();
      else void browse();
    };

    const onPaste = (event: ClipboardEvent) => {
      if (!isDownload || composing) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      const raw = event.clipboardData?.getData("text") ?? "";
      const all = allUrlsIn(raw);
      const found = all.length > 1 ? all.join("\n") : firstUrlIn(raw);
      if (found) {
        event.preventDefault();
        openDownload(found);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, [browse, composing, isDownload, openDownload]);

  const primaryAction = isDownload ? (
    <Button
      variant="primary"
      size={mine.length === 0 ? "lg" : "md"}
      icon={<Plus size={mine.length === 0 ? 18 : 16} />}
      onClick={() => openDownload()}
    >
      {t("tool_download_action")}
    </Button>
  ) : (
    <Button
      variant="primary"
      size={mine.length === 0 ? "lg" : "md"}
      icon={<FolderOpen size={mine.length === 0 ? 18 : 16} />}
      onClick={() => void browse()}
    >
      {t("chat_suggest_browse")}
    </Button>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mine.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-5 px-6 py-12 text-center">
            {Icon && (
              <div className="flex size-12 items-center justify-center rounded-xl border border-line bg-surface text-fg-muted shadow-(--shadow-card)">
                <Icon size={22} strokeWidth={1.8} />
              </div>
            )}
            <div className="flex flex-col items-center gap-1.5">
              <h1 className="text-lg font-semibold text-fg">{t(`tool_${kind}`)}</h1>
              <p className="max-w-sm text-sm text-fg-muted">{t(`tool_${kind}_about`)}</p>
            </div>
            {primaryAction}
          </div>
        ) : (
          <div className="mx-auto flex w-[min(calc(100%-2rem),var(--container-fluid))] flex-col gap-4 py-5 sm:w-[min(calc(100%-3rem),var(--container-fluid))]">
            <div className="sticky top-0 z-10 -mx-2 flex items-center justify-between gap-3 rounded-lg bg-canvas/95 px-2 py-1.5">
              <span className="truncate text-sm font-medium text-fg-soft">
                {t(`tool_${kind}`)}
                <span className="ms-1.5 text-xs font-normal text-fg-muted tnum">
                  ({formatCount(mine.length, language)})
                </span>
              </span>
              {primaryAction}
            </div>

            <JobList jobs={mine} language={language} empty={null} />
          </div>
        )}
      </div>

      {composing && children(close)}

      {isDragging && !isDownload && !composing && (
        <div className="pointer-events-none absolute inset-4 z-20 flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-accent bg-accent-soft">
          <Upload size={28} className="text-accent" />
          <p className="text-sm font-medium text-fg">{t("drop_file")}</p>
        </div>
      )}
    </div>
  );
}
