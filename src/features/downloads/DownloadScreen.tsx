import { useEffect, useRef, useState } from "react";
import { Gauge, Link2, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { ControlGroup, Field } from "../../components/ui/Card";
import { Segmented } from "../../components/ui/Segmented";
import { TextInput } from "../../components/ui/TextInput";
import { cn } from "../../lib/cn";
import {
  FILE_KIND_ICON,
  FILE_KIND_LABEL_KEY,
  FILE_KIND_TINT,
  fileKindOf,
  formatLabelOf,
  type FileKind,
} from "../../lib/fileKind";
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
import { qualityLabel, useDownloadSettings } from "./useDownloadSettings";

interface Props {
  /** What was in the field when this screen was last left, if it was left for
   *  Settings. Empty on a normal arrival. */
  initialUrl?: string;
  isOnline: boolean;
  notify: (type: ToastType, message: string) => void;
}

/**
 * Paste a link. Any link.
 *
 * The screen no longer assumes what is on the other end. A probe answers that
 * in one request, and the form follows: a media page gets the video/audio
 * choice, a direct file gets its name, its kind, its exact size and nothing to
 * decide. Neither the user nor this component picks the engine -- see
 * `download::choose_engine` -- so a link that turns out to be something other
 * than the preview suggested still downloads correctly.
 *
 * Nothing on this form is a standing preference any more. The quality is set in
 * Settings and only stated here, in a line of hint text, once there is a video
 * for it to be about. Video-or-MP3 is still asked -- it is the one choice that
 * changes from link to link -- but only of the links it is a question about.
 * Both used to sit on the form permanently: two large cards and a bordered row,
 * above an empty field, describing a download nobody had asked for yet.
 */
export function DownloadScreen({ initialUrl, isOnline, notify }: Props) {
  const { t } = useTranslation();
  const { go, replace } = useNavigation();
  const { openPanel } = useHistoryPanel();
  const [url, setUrl] = useState(initialUrl ?? "");
  // Read on mount, which is every time this screen is opened -- so a quality
  // changed in Settings applies to the next link without anything to sync.
  // The form's own media toggle writes back into it rather than shadowing it.
  const { settings, update } = useDownloadSettings();
  const mediaType = settings.mediaType;
  /** The probe result *and the URL it describes*. Keeping the two together is
   *  what lets the rest of the screen tell a fresh answer from the previous
   *  link's, which used to sit under a half-typed URL as if it were about it. */
  const [probe, setProbe] = useState<{ url: string; info: UrlInfo | null } | null>(
    null,
  );
  const [probing, setProbing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = url.trim();
  const info = probe?.url === trimmed ? probe.info : null;

  // A file link has nothing to choose: it is fetched exactly as it is, so the
  // media toggle and the quality picker would both be lying about what is
  // going to happen.
  const isFile = info?.kind === "file";
  const fileKind: FileKind | null = info && isFile
    ? fileKindOf(info.title, info.uploader)
    : null;

  const { savePath, toolsReady, starting, selectFolder, start } = useDownloadForm({
    isOnline,
    notify,
    mediaType,
    link: info,
  });

  useEffect(() => inputRef.current?.focus(), []);

  // Debounced: pasting a link fires a change per character otherwise, and a
  // probe is at best an HTTP round trip and at worst a yt-dlp spawn.
  useEffect(() => {
    if (!/^https?:\/\/\S+$/i.test(trimmed) || !isOnline) {
      setProbe(null);
      return;
    }
    let cancelled = false;
    setProbing(true);
    const timer = setTimeout(() => {
      void ipc
        .probeUrl(trimmed)
        // The URL is stored either way, so a result that arrives after the
        // field has moved on is discarded rather than shown under a link it is
        // not about. A failure leaves the preview empty; `start` asks again,
        // which is the right thing to do about a request that may just have
        // caught a bad moment.
        .then((result) => !cancelled && setProbe({ url: trimmed, info: result }))
        .catch(() => !cancelled && setProbe({ url: trimmed, info: null }))
        .finally(() => !cancelled && setProbing(false));
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setProbing(false);
    };
  }, [trimmed, isOnline]);

  const submit = () => {
    void start(
      { url, mediaType, quality: settings.quality, link: info },
      () => setUrl(""),
    ).then(
      // The form clears itself and stays, ready for the next link; the history
      // beside it opens so the download that just started is visible.
      (ok) => ok && openPanel(),
    );
  };

  return (
    <ToolShell subtitle={t("tool_download_about")}>
      {/* Labelled, like every other control in the app.
          It was a bare box sitting straight against the top of the card, with
          only a placeholder to say what it was -- which is what made it read as
          a search bar bolted onto a form rather than as the form's first field,
          and put its border a few pixels under the card's edge with nothing in
          between. The label is that missing line: it names the field, it gives
          the input something to start below, and it is what a screen reader
          announces instead of a placeholder that disappears on the first
          keystroke. */}
      <Field label={t("url_label")} htmlFor="download-url">
        <div className="relative">
          <Link2
            size={17}
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-muted"
            style={{ insetInlineStart: "0.875rem" }}
          />
          {/* 48px, not the shared 44. This is the app's first screen and the
              one box anything is ever typed into -- it carries the same weight
              as the button that submits it, and at 44 it sat visibly below the
              run button while being the more important half of the form. */}
          <TextInput
            ref={inputRef}
            id="download-url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
            placeholder={t("url_placeholder")}
            // Always LTR: a URL reads left to right in every language.
            dir="ltr"
            className="h-12 ps-11"
          />
        </div>
      </Field>

      {(info || probing) && (
        <LinkPreview info={info} kind={fileKind} probing={probing} />
      )}

      {isFile ? (
        // Not a disabled control and not an empty space: what is about to
        // happen to this file. Dropping the row outright would move every
        // control below it -- including the button being aimed at -- the
        // moment a probe came back.
        <FileNotes resumable={info?.resumable ?? false} />
      ) : (
        // Only once the probe has answered, and only when the answer is a
        // media page. That is the only link where video-or-MP3 is a real
        // question, and it is the moment the user has something to answer it
        // about -- before that the app would be asking what to do with a link
        // nobody has pasted. The preview appears in the same beat, so this
        // costs no extra shift of the form.
        //
        // A segmented control, not the two large cards it replaces: it is one
        // line of the form like every other choice in the app, rather than the
        // biggest thing on the screen.
        info && (
          <ControlGroup>
            <Segmented
              label={t("download_as")}
              value={mediaType}
              onChange={(value) => update("mediaType", value)}
              options={[
                { value: "video", label: t("download_type_video") },
                { value: "audio", label: t("download_type_audio") },
              ]}
            />

            {/* The quality, as a hint under the control it qualifies rather
                than a row of its own. It is not a decision being made here --
                it was made once in Settings -- so it is written the size of
                the other things this form states rather than the size of the
                things it asks. Audio has no quality to state: yt-dlp is asked
                for the best MP3 it can make either way. */}
            {mediaType === "video" ? (
              <QualityHint
                quality={qualityLabel(settings.quality, t("quality_best"))}
                // The link survives the trip: this entry is what `back` from
                // Settings returns to, so it has to carry the field with it.
                onOpenSettings={() => {
                  replace({ name: "download", link: url });
                  go({ name: "settings", section: "downloads" });
                }}
              />
            ) : (
              <p className="text-xs text-fg-muted">{t("audio_quality_note")}</p>
            )}
          </ControlGroup>
        )
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
        disabled={
          !trimmed || !savePath || !isOnline || starting || (!toolsReady && !isFile)
        }
        onClick={submit}
      />
    </ToolShell>
  );
}

/**
 * What is on the other end of the link, before committing to it.
 *
 * Two shapes behind one card: a thumbnail, title and channel for media; a
 * kind-coloured icon, file name, type and size for a file. Same height either
 * way, so a probe landing does not shift the form under the pointer.
 */
function LinkPreview({
  info,
  kind,
  probing,
}: {
  info: UrlInfo | null;
  kind: FileKind | null;
  probing: boolean;
}) {
  const { t, i18n } = useTranslation();
  const Icon = kind ? FILE_KIND_ICON[kind] : null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
      {kind && Icon ? (
        <span
          className={cn(
            "flex h-10 w-16 shrink-0 items-center justify-center rounded-sm",
            FILE_KIND_TINT[kind],
          )}
        >
          <Icon size={20} />
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
              {kind && info
                ? // What it is, then what it is stored as, then how big. The
                  // generic word "File" used to stand in for all three.
                  [
                    t(FILE_KIND_LABEL_KEY[kind]),
                    formatLabelOf(info.title),
                    info.sizeBytes
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

/**
 * What quality this download will ask for, and the way to change it.
 *
 * One line of hint text, not the bordered row this started as. The row was the
 * same size as the controls around it while being the only thing on the form
 * that is not a control -- and it sat there on an empty field, stating the
 * quality of a video nobody had pasted a link to yet. Now it appears with the
 * media choice it belongs to, and says its piece in the space a hint takes.
 */
function QualityHint({
  quality,
  onOpenSettings,
}: {
  quality: string;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
      <Gauge size={12} className="shrink-0" />
      {t("video_quality")}
      {/* ltr: "720p" is a number and a Latin letter, the same in every
          language the interface speaks. */}
      <span dir="ltr" className="font-medium text-fg-soft">
        {quality}
      </span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onOpenSettings}
        className="text-accent transition-colors hover:text-accent-hover hover:underline"
      >
        {t("settings")}
      </button>
    </p>
  );
}

/**
 * The file branch's answer to the quality picker.
 *
 * There is nothing to choose, so this says what will happen instead: the bytes
 * are taken exactly as they are, and whether an interruption costs the whole
 * download or only the rest of it. That second line is the one thing about a
 * direct download the user might actually plan around, and the backend has been
 * reporting it -- `UrlInfo.resumable` -- to nobody.
 */
function FileNotes({ resumable }: { resumable: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface px-3.5 py-2.5 text-center">
      <p className="text-sm text-fg-soft">{t("download_file_note")}</p>
      <p
        className={cn(
          "flex items-center justify-center gap-1.5 text-xs",
          resumable ? "text-success" : "text-fg-muted",
        )}
      >
        <RotateCw size={12} className="shrink-0" />
        {t(resumable ? "download_file_resumable" : "download_file_not_resumable")}
      </p>
    </div>
  );
}

