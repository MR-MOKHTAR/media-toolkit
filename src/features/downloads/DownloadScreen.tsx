import { useEffect, useRef, useState } from "react";
import { Link2, Music2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { Button } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Segmented";
import { TextInput } from "../../components/ui/TextInput";
import { cn } from "../../lib/cn";
import * as ipc from "../../lib/ipc";
import { formatDuration } from "../../lib/format";
import type { ToastType } from "../../types/feedback";
import { OutputFolderRow, RunButton, ToolShell } from "../media/components/ToolShell";
import type { UrlInfo } from "../jobs/types";
import { useDownloadForm } from "./useDownloadForm";

const QUALITIES = ["best", "1080", "720", "480"] as const;

interface Props {
  isOnline: boolean;
  notify: (type: ToastType, message: string) => void;
}

/**
 * Replaces a 690px modal that had six labelled control regions for what is
 * really "paste a link, pick video or audio".
 *
 * The preview is the one addition: on a valid URL it fetches the title,
 * channel, duration and thumbnail. That is what makes this feel like a product
 * rather than a form, and it confirms the right link was pasted before
 * anything is downloaded.
 */
export function DownloadScreen({ isOnline, notify }: Props) {
  const { t } = useTranslation();
  const { go } = useNavigation();
  const { savePath, toolsReady, selectFolder, start } = useDownloadForm({ isOnline, notify });

  const [url, setUrl] = useState("");
  const [mediaType, setMediaType] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState<string>("best");
  const [info, setInfo] = useState<UrlInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // Debounced: pasting a link fires a change per character otherwise, and each
  // probe is a yt-dlp spawn.
  useEffect(() => {
    const trimmed = url.trim();
    if (!/^https?:\/\/\S+$/i.test(trimmed) || !isOnline) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setProbing(true);
    const timer = setTimeout(() => {
      void ipc
        .probeUrl(trimmed)
        .then((result) => !cancelled && setInfo(result))
        .catch(() => !cancelled && setInfo(null))
        .finally(() => !cancelled && setProbing(false));
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setProbing(false);
      clearTimeout(timer);
    };
  }, [url, isOnline]);

  const submit = () => {
    const ok = start(
      { url, filename: info?.title ?? "", mediaType, quality },
      () => setUrl(""),
    );
    if (ok) go({ name: "jobs" });
  };

  return (
    <ToolShell title={t("tool_download")} subtitle={t("tool_download_hint")}>
      <div className="relative">
        <Link2
          size={17}
          className="pointer-events-none absolute inset-inline-start-3 top-1/2 -translate-y-1/2 text-fg-muted"
          style={{ insetInlineStart: "0.75rem" }}
        />
        <TextInput
          ref={inputRef}
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
          placeholder={t("url_placeholder")}
          // Always LTR: a URL reads left to right in every language.
          dir="ltr"
          className="h-11 ps-10"
        />
      </div>

      {(info || probing) && (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
          {info?.thumbnail ? (
            <img
              src={info.thumbnail}
              alt=""
              className="h-12 w-20 shrink-0 rounded-sm object-cover"
            />
          ) : (
            <div className="h-12 w-20 shrink-0 animate-pulse rounded-sm bg-surface-soft" />
          )}
          <div className="min-w-0 flex-1">
            {probing && !info ? (
              <div className="flex flex-col gap-1.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded-sm bg-surface-soft" />
                <div className="h-3 w-1/3 animate-pulse rounded-sm bg-surface-soft" />
              </div>
            ) : (
              <>
                <p className="truncate text-base text-fg" title={info?.title}>
                  {info?.title}
                </p>
                <p className="truncate text-xs text-fg-muted">
                  {[info?.uploader, formatDuration(info?.durationSecs)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <TypeCard
          selected={mediaType === "video"}
          icon={<Video size={19} />}
          label={t("download_type_video")}
          onSelect={() => setMediaType("video")}
        />
        <TypeCard
          selected={mediaType === "audio"}
          icon={<Music2 size={19} />}
          label={t("download_type_audio")}
          onSelect={() => setMediaType("audio")}
        />
      </div>

      {/* Nothing replaces this when audio is selected. The old modal had a
          whole styled panel whose only content was that audio needs no
          quality setting -- a panel explaining an absent control is the
          definition of clutter. */}
      {mediaType === "video" && (
        <Segmented
          label={t("video_quality")}
          value={quality}
          onChange={setQuality}
          options={QUALITIES.map((value) => ({
            value,
            label: value === "best" ? t("quality_best") : `${value}p`,
          }))}
        />
      )}

      <OutputFolderRow folder={savePath} onChoose={selectFolder} />

      {!toolsReady && (
        <p className="text-sm text-warning">{t("ytdlp_not_found")}</p>
      )}

      <RunButton
        label={t("start_download")}
        disabled={!url.trim() || !savePath || !isOnline || !toolsReady}
        onClick={submit}
      />
    </ToolShell>
  );
}

function TypeCard({
  selected,
  icon,
  label,
  onSelect,
}: {
  selected: boolean;
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <Button
      variant="secondary"
      onClick={onSelect}
      className={cn(
        "h-auto flex-col gap-2 py-4",
        selected && "border-accent-line bg-accent-soft text-accent",
      )}
    >
      {icon}
      <span className={cn("text-base", selected && "font-medium")}>{label}</span>
    </Button>
  );
}
