import { useEffect, useRef, useState } from "react";
import { File, Link2, Music2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Segmented";
import { TextInput } from "../../components/ui/TextInput";
import { cn } from "../../lib/cn";
import * as ipc from "../../lib/ipc";
import { formatBytes, formatDuration } from "../../lib/format";
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
 * Paste a link. Any link.
 *
 * The screen no longer assumes what is on the other end. A probe answers that
 * in one request, and the form follows: a media page gets the video/audio
 * choice and a quality picker, a direct file gets its name and its exact size
 * and nothing to decide. Neither the user nor this component picks the engine
 * -- see `download::choose_engine` -- so a link that turns out to be something
 * other than the preview suggested still downloads correctly.
 */
export function DownloadScreen({ isOnline, notify }: Props) {
  const { t } = useTranslation();
  const { openPanel } = useHistoryPanel();
  const [url, setUrl] = useState("");
  const [mediaType, setMediaType] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState<string>(DEFAULT_QUALITY);
  const [info, setInfo] = useState<UrlInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A file link has nothing to choose: it is fetched exactly as it is, so the
  // media toggle and the quality picker would both be lying about what is
  // going to happen.
  const isFile = info?.kind === "file";

  const { savePath, toolsReady, selectFolder, start } = useDownloadForm({
    isOnline,
    notify,
    mediaType,
    isFile,
  });

  useEffect(() => inputRef.current?.focus(), []);

  // Debounced: pasting a link fires a change per character otherwise, and a
  // probe is at best an HTTP round trip and at worst a yt-dlp spawn.
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
    };
  }, [url, isOnline]);

  const submit = () => {
    const ok = start(
      {
        url,
        // The server's own name is kept for a file -- it is already the right
        // one, extension included. A video's title is not a file name until
        // yt-dlp has sanitized it, which is why it is passed for media.
        filename: isFile ? "" : (info?.title ?? ""),
        mediaType,
        quality,
        isFile,
      },
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
          size={16}
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-muted"
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
          className="ps-10"
        />
      </div>

      {(info || probing) && (
        <LinkPreview info={info} probing={probing} />
      )}

      {isFile ? (
        // Not a disabled control and not an empty space: a line that says what
        // is about to happen. Dropping the row outright would move every
        // control below it -- including the button being aimed at -- the
        // moment a probe came back.
        <p className="rounded-md border border-line bg-surface px-3.5 py-2.5 text-center text-sm text-fg-soft">
          {t("download_file_note")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <TypeCard
              selected={mediaType === "video"}
              icon={<Video size={18} />}
              label={t("download_type_video")}
              onSelect={() => setMediaType("video")}
            />
            <TypeCard
              selected={mediaType === "audio"}
              icon={<Music2 size={18} />}
              label={t("download_type_audio")}
              onSelect={() => setMediaType("audio")}
            />
          </div>

          {/* Audio has no quality to pick -- yt-dlp is asked for the best MP3
              it can make either way -- but the slot still has to be filled,
              for the same reason as above. */}
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
            <p className="rounded-md border border-line bg-surface px-3.5 py-2.5 text-center text-sm text-fg-soft">
              {t("audio_quality_note")}
            </p>
          )}
        </>
      )}

      <OutputFolderRow folder={savePath} onChoose={selectFolder} />

      {/* Only when it matters. yt-dlp is needed for a page and not for a file,
          so a missing one is a warning on one kind of link and nothing at all
          on the other. */}
      {!toolsReady && !isFile && (
        <p className="text-sm text-warning">{t("ytdlp_not_found")}</p>
      )}

      <RunButton
        label={t("start_download")}
        disabled={!url.trim() || !savePath || !isOnline || (!toolsReady && !isFile)}
        onClick={submit}
      />
    </ToolShell>
  );
}

/**
 * What is on the other end of the link, before committing to it.
 *
 * Two shapes behind one card: a thumbnail, title and channel for media; an
 * icon, file name and size for a file. Same height either way, so a probe
 * landing does not shift the form under the pointer.
 */
function LinkPreview({
  info,
  probing,
}: {
  info: UrlInfo | null;
  probing: boolean;
}) {
  const { t, i18n } = useTranslation();
  const isFile = info?.kind === "file";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
      {isFile ? (
        <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent">
          <File size={20} />
        </span>
      ) : info?.thumbnail ? (
        <img
          src={info.thumbnail}
          alt=""
          className="h-10 w-16 shrink-0 rounded-sm object-cover"
        />
      ) : (
        <div className="h-10 w-16 shrink-0 animate-pulse rounded-sm bg-surface-soft" />
      )}

      <div className="min-w-0 flex-1">
        {probing && !info ? (
          <div className="flex flex-col gap-1.5">
            <div className="h-3.5 w-3/4 animate-pulse rounded-sm bg-surface-soft" />
            <div className="h-3 w-1/3 animate-pulse rounded-sm bg-surface-soft" />
          </div>
        ) : (
          <>
            <p className="truncate text-sm text-fg" title={info?.title}>
              {info?.title}
            </p>
            <p className="truncate text-xs text-fg-muted">
              {isFile
                ? [
                    t("link_kind_file"),
                    info?.sizeBytes
                      ? formatBytes(info.sizeBytes, i18n.language)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : [info?.uploader, formatDuration(info?.durationSecs)]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </>
        )}
      </div>
    </div>
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
        "h-auto flex-col gap-1.5 py-3.5",
        selected && "border-accent-line bg-accent-soft text-accent",
      )}
    >
      {icon}
      <span className={cn("text-sm", selected && "font-medium")}>{label}</span>
    </Button>
  );
}
