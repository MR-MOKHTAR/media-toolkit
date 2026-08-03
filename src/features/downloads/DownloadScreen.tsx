import { useEffect, useRef, useState } from "react";
import { Link2, Music2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Segmented";
import { TextInput } from "../../components/ui/TextInput";
import { cn } from "../../lib/cn";
import * as ipc from "../../lib/ipc";
import { formatDuration } from "../../lib/format";
import type { ToastType } from "../../types/feedback";
import {
  OutputFolderRow,
  RunButton,
  ToolShell,
} from "../media/components/ToolShell";
import type { UrlInfo } from "../jobs/types";
import { useHistoryPanel } from "../jobs/useHistoryPanel";
import { useDownloadForm } from "./useDownloadForm";

const QUALITIES = ["best", "1080", "720", "480"] as const;

/** 720p, not "best".
 *
 *  "Best available" is whatever the site happens to serve -- on YouTube that is
 *  often 4K, which is a multi-gigabyte file and a long wait for something most
 *  people watch on a laptop. 720p is the size everyone can afford; anyone who
 *  wants the full thing is one click away from it. */
const DEFAULT_QUALITY: string = "720";

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
  const { openPanel } = useHistoryPanel();
  const { savePath, toolsReady, selectFolder, start } = useDownloadForm({
    isOnline,
    notify,
  });

  const [url, setUrl] = useState("");
  const [mediaType, setMediaType] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState<string>(DEFAULT_QUALITY);
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
    // The form clears itself and stays, ready for the next link; the history
    // beside it opens so the download that just started is visible.
    if (ok) openPanel();
  };

  return (
    <ToolShell subtitle={t("tool_download_about")}>
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

      {/* Audio has no quality to pick -- yt-dlp is asked for the best MP3 it
          can make either way -- but the slot still has to be filled. Dropping
          the row outright shortened the form by its own height, so every
          control below it, including the button being aimed at, jumped up the
          moment Audio was clicked. A line stating what audio will produce
          holds the layout still and answers the question the missing control
          would otherwise raise. */}
      {mediaType === "video" ? (
        <Segmented
          label={t("video_quality")}
          value={quality}
          onChange={setQuality}
          options={QUALITIES.map((value) => ({
            value,
            label: value === "best" ? t("quality_best") : `${value}p`,
          }))}
        />
      ) : (
        <p className="rounded-md border border-line bg-surface px-3 py-2.5 text-center text-base text-fg-soft">
          {t("audio_quality_note")}
        </p>
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
      <span className={cn("text-base", selected && "font-medium")}>
        {label}
      </span>
    </Button>
  );
}
