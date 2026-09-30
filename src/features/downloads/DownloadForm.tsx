import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  FileAudio,
  FileQuestionMark,
  FileVideo2,
  Gauge,
  Link2,
  ListVideo,
  Music2,
  RotateCw,
  Video,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { Card, ControlGroup, Field } from "../../components/ui/Card";
import { Segmented } from "../../components/ui/Segmented";
import { Select } from "../../components/ui/Select";
import { TextArea } from "../../components/ui/TextArea";
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
import { formatBytes, formatCount, formatDuration } from "../../lib/format";
import { allUrlsIn, firstUrlIn, looksLikeUrl, normalizeUrl } from "../../lib/url";
import type { ToastType } from "../../types/feedback";
import {
  OutputFolderRow,
  RunButton,
} from "../media/components/ToolFormParts";
import { ToolDialog } from "../tools/ToolDialog";
import type { UrlInfo } from "../jobs/types";
import { describeWhen, nextOccurrence } from "../jobs/when";
import { useDownloadForm, type PlaylistChoice } from "./useDownloadForm";
import { qualityLabel, useDownloadSettings } from "./useDownloadSettings";

interface Props {
  /** What was in the field when this form was last left, if it was left for
   *  Settings. Empty on a normal arrival. */
  initialUrl?: string;
  isOnline: boolean;
  notify: (type: ToastType, message: string) => void;
  /** Closes the dialog. Called once the download has actually started -- the
   *  new row is already on the list behind it by then. */
  onDone: () => void;
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
export function DownloadForm({ initialUrl, isOnline, notify, onDone }: Props) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const { go, replace } = useNavigation();
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
  /** True once the clipboard has put a link in an empty field, so the second
   *  effect below knows to select it. */
  const [filledFromClipboard, setFilledFromClipboard] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** What is in the field right now, readable from the clipboard effect --
   *  which runs once, and whose closure would otherwise never see a keystroke
   *  that landed while the read was in flight. */
  const urlRef = useRef(url);
  urlRef.current = url;

  /** The link the field is holding, as the backend will see it: the URL out of
   *  whatever was pasted, with a scheme supplied if it had none. Everything
   *  downstream keys off this rather than the raw text, so the preview, the
   *  probe and the request are all about the same link. */
  const link = normalizeUrl(url);
  /** Every link in the field. Two or more is a batch: a download each, each
   *  identified by the backend on its own -- a probe per line here would be a
   *  yt-dlp spawn per line before anything started. */
  const links = allUrlsIn(url);
  const batch = links.length > 1;
  const info = !batch && probe?.url === link ? probe.info : null;
  /** The probe for this link came back empty-handed. Not a reason to refuse
   *  the download -- the backend looks again, properly, once it starts -- but
   *  a reason to say what is and is not known rather than show nothing. */
  const probeFailed = !batch && probe?.url === link && probe.info === null;

  // A file link has nothing to choose: it is fetched exactly as it is, so the
  // media toggle and the quality picker would both be lying about what is
  // going to happen.
  const isFile = info?.kind === "file";
  const fileKind: FileKind | null = info && isFile
    ? fileKindOf(info.title, info.uploader)
    : null;

  /** Whether this link raises the playlist question at all: it either is a
   *  playlist page, or it is a video that names one. */
  const namesPlaylist = Boolean(info && (info.isPlaylist || info.inPlaylist));
  /** Reset per link rather than remembered: "all of them" is an answer about
   *  one particular playlist, and carrying it to the next link pasted would
   *  queue a second list nobody asked for. */
  const [playlist, setPlaylist] = useState<PlaylistChoice>("one");
  useEffect(() => setPlaylist("one"), [link]);

  /** How many downloads run at once -- a setting now, and what the playlist
   *  hint promises. It used to say "four at a time" whatever was set. */
  const [slots, setSlots] = useState(4);
  useEffect(() => {
    void ipc
      .getNetworkSettings()
      .then((network) => setSlots(network.maxDownloads))
      .catch(() => undefined);
  }, []);

  const { savePath, autoFolder, toolsReady, starting, selectFolder, start } = useDownloadForm({
    isOnline,
    notify,
    mediaType,
    link: info,
  });

  /** Now, or at a time -- see `WhenRow`. Per visit to the form, not
   *  remembered: a schedule is a decision about these links, and the next
   *  link pasted is most likely wanted now. The time itself is remembered. */
  const [when, setWhen] = useState<"now" | "later">("now");
  const startAt = when === "later" ? nextOccurrence(settings.scheduleTime) : null;

  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  // The field changes shape when a second link arrives, and the one being
  // typed into should not lose the caret for it.
  useEffect(() => {
    if (batch) areaRef.current?.focus();
    else inputRef.current?.focus();
  }, [batch]);

  // The link that is already on the clipboard, put in the field.
  //
  // Opening this form is, almost always, the second half of copying a link
  // somewhere else -- so the field starts holding the thing the user came here
  // to paste, and the preview for it is already loading by the time they look
  // at the dialog. Selected rather than left at the caret, so typing over it
  // costs nothing if the guess was wrong.
  //
  // Skipped when arriving from Settings mid-edit: `initialUrl` is the field as
  // it was left, and the clipboard has no business overwriting it. Skipped too
  // if anything has been typed while the read was in flight -- reading the
  // clipboard is IPC, and the user is faster than it sometimes.
  useEffect(() => {
    if (initialUrl?.trim()) return;
    let cancelled = false;
    void ipc.readClipboardText().then((text) => {
      // A list copied from somewhere else fills the field as a list.
      const all = text ? allUrlsIn(text) : [];
      const found = all.length > 1 ? all.join("\n") : text && firstUrlIn(text);
      // `urlRef` rather than `url`: this effect runs once and its closure would
      // hold the empty string forever, so the field's own state is the only
      // thing that can say whether anything has been typed since.
      if (cancelled || !found || urlRef.current) return;
      setUrl(found);
      setFilledFromClipboard(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initialUrl]);

  // Selecting has to wait for the value to be on the input, which is the render
  // after `setUrl` -- hence a second effect rather than a call beside it.
  useEffect(() => {
    if (filledFromClipboard) (areaRef.current ?? inputRef.current)?.select();
  }, [filledFromClipboard]);

  // Debounced: pasting a link fires a change per character otherwise, and a
  // probe is at best an HTTP round trip and at worst a yt-dlp spawn.
  useEffect(() => {
    if (batch || !looksLikeUrl(link) || !isOnline) {
      setProbe(null);
      return;
    }
    let cancelled = false;
    setProbing(true);
    const timer = setTimeout(() => {
      void ipc
        .probeUrl(link, settings.cookiesFrom || undefined)
        // The URL is stored either way, so a result that arrives after the
        // field has moved on is discarded rather than shown under a link it is
        // not about. A failure leaves the preview empty; `start` asks again,
        // which is the right thing to do about a request that may just have
        // caught a bad moment.
        .then((result) => !cancelled && setProbe({ url: link, info: result }))
        .catch(() => !cancelled && setProbe({ url: link, info: null }))
        .finally(() => !cancelled && setProbing(false));
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setProbing(false);
    };
  }, [batch, link, isOnline, settings.cookiesFrom]);

  /** The button's own rule, so Enter in the field -- which does not go
   *  through the button -- cannot start what the button would refuse. Only a
   *  link is worth submitting: "hello" used to close the dialog, flash a row
   *  and come back as a raw backend error. */
  // A batch is not held back by a missing yt-dlp: direct files in it do not
  // need one, and a page that does fails on its own row, saying why.
  const canSubmit =
    looksLikeUrl(link) &&
    Boolean(savePath) &&
    isOnline &&
    !starting &&
    (batch || toolsReady || isFile);

  const submit = () => {
    if (!canSubmit) return;
    void start(
      {
        url: link,
        mediaType,
        quality: settings.quality,
        audioFormat: settings.audioFormat,
        // Only ever "all" for a link that raises the question. A stale choice
        // cannot leak onto the next link -- the effect above resets it -- but
        // the request is the wrong place to rely on that.
        playlist: namesPlaylist ? playlist : "one",
        cookiesFrom: settings.cookiesFrom,
        parallel: settings.parallel,
        link: info,
        urls: batch ? links : undefined,
        startAt,
      },
      // Closes as soon as the request is accepted, not when the backend has
      // finished looking the link up. The download appears as the top row of
      // the list behind it a moment later; the form is unmounted, so there is
      // nothing left to clear.
      onDone,
    );
  };

  return (
    <ToolDialog
      tool="download"
      onClose={onDone}
      dirty={looksLikeUrl(link)}
      footer={
        <RunButton
          label={
            batch
              ? t("batch_start", { links: formatCount(links.length, i18n.language) })
              : when === "later"
                ? t("schedule_button")
                : t("start_download")
          }
          disabled={!canSubmit}
          onClick={submit}
        />
      }
    >
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
        {batch ? (
          // More than one link: a list, one per line, edited as text. Enter
          // is a new line here; Ctrl+Enter starts them, like any multi-line
          // field that submits.
          <TextArea
            ref={areaRef}
            id="download-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                submit();
              }
            }}
            rows={Math.min(8, Math.max(3, links.length + 1))}
            dir="ltr"
            spellCheck={false}
            placeholder={t("url_placeholder")}
          />
        ) : (
        <div className="relative">
          <Link2
            size={17}
            className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-fg-muted"
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
            // A link pasted out of a message arrives with the message around
            // it. Keeping only the link is what the field would have to be
            // hand-edited into anyway, and it is what the preview below needs
            // to have something to show.
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              // Several links: the field becomes a list of them -- added to
              // what is there, unless all of that was selected to be replaced.
              const input = event.currentTarget;
              const replacing =
                input.selectionStart === 0 && input.selectionEnd === input.value.length;
              const several = allUrlsIn(replacing ? text : `${url}\n${text}`);
              if (several.length > 1) {
                event.preventDefault();
                setUrl(several.join("\n"));
                return;
              }
              const found = firstUrlIn(text);
              if (!found || found === text.trim()) return;
              event.preventDefault();
              setUrl(found);
            }}
            onKeyDown={(event) => event.key === "Enter" && submit()}
            placeholder={t("url_placeholder")}
            // A URL reads left to right in every language, so text that is
            // actually in the field is pinned LTR -- mirroring it makes it
            // unreadable and impossible to edit.
            //
            // An *empty* field holds no URL, only the Persian or Arabic
            // sentence asking for one -- and pinned LTR that sentence sat at
            // the far end of the box from the icon the field starts at, facing
            // the wrong way in an interface reading the other way. So the
            // direction follows the interface until there is something in the
            // field for it to be about.
            dir={url ? "ltr" : i18n.dir()}
            // Physical, not `ps-11`: the padding has to stay on the side the
            // icon is on, and the icon follows the interface while the input's
            // own direction flips with its content.
            className={cn("h-12", isRtl ? "pr-11" : "pl-11")}
          />
        </div>
        )}
      </Field>

      {batch && (
        <BatchList
          links={links}
          onRemove={(target) =>
            setUrl(links.filter((other) => other !== target).join("\n"))
          }
        />
      )}

      {(info || probing) && (
        <LinkPreview info={info} kind={fileKind} probing={probing} />
      )}
      {!info && !probing && probeFailed && <UnknownLinkPreview link={link} />}

      {isFile ? (
        // Not a disabled control and not an empty space: what is about to
        // happen to this file. Dropping the row outright would move every
        // control below it -- including the button being aimed at -- the
        // moment a probe came back.
        <FileNotes resumable={info?.resumable ?? false} />
      ) : (
        // As soon as there is a link in the field -- not once the probe has
        // answered about it.
        //
        // It used to wait for `info`, on the reasoning that video-or-audio is
        // only a real question for a media page. The reasoning holds; making
        // the probe the gate does not. A probe is a network request and a
        // yt-dlp spawn, and when it fails -- an extractor that needs cookies, a
        // rate limit, a slow line, or the version of this app whose yt-dlp
        // arguments were in the wrong order -- the form quietly lost the one
        // choice it exists to ask, and every YouTube link downloaded as video
        // with no way to say otherwise. The choice does not depend on the
        // answer, so it no longer waits for it.
        //
        // A direct file is still the exception, and that one is known rather
        // than assumed: the branch above only runs on a probe that came back
        // saying "file".
        //
        // A segmented control, not the two large cards it replaces: it is one
        // line of the form like every other choice in the app, rather than the
        // biggest thing on the screen.
        looksLikeUrl(link) && (
          <ControlGroup>
            <Segmented
              label={t("download_as")}
              value={mediaType}
              onChange={(value) => update("mediaType", value)}
              // The same two glyphs the Settings panel puts on this exact
              // choice, so the control the form asks with and the one that
              // remembers the answer are recognisably the same control.
              options={[
                {
                  value: "video",
                  label: t("download_type_video"),
                  icon: <Video size={16} />,
                },
                {
                  value: "audio",
                  label: t("download_type_audio"),
                  icon: <Music2 size={16} />,
                },
              ]}
            />

            {/* What the choice above will actually produce, as a hint under
                the control it qualifies rather than a row of its own. It is
                not a decision being made here -- it was made once in Settings
                -- so it is written the size of the other things this form
                states rather than the size of the things it asks.

                Both halves of the toggle get one. Audio used to get a flat
                sentence with nothing to press: the form said "best quality the
                site offers" and left the actual question about an audio
                download -- the track as it came, or MP3 -- unmentioned and
                unreachable, three clicks away in a Settings section the user
                had no reason to know existed. */}
            <SettingHint
              icon={mediaType === "video" ? <Gauge size={12} /> : <FileAudio size={12} />}
              label={mediaType === "video" ? t("video_quality") : t("audio_format")}
              value={
                mediaType === "video"
                  ? qualityLabel(settings.quality, t("quality_best"))
                  : settings.audioFormat === "mp3"
                    ? "MP3"
                    : t("audio_format_original")
              }
              // The link and the open form both survive the trip: this entry
              // is what `back` from Settings returns to, so it has to carry
              // the field and the fact that the dialog was open with it.
              onOpenSettings={() => {
                replace({ name: "download", link: url, composing: true });
                go({ name: "settings", section: "downloads" });
              }}
            />

            {/* Said out loud for a link nobody could identify: the choice is
                recorded, and applied only if the link does turn out to be a
                page with video on it. An installer behind it is saved as an
                installer, not as whatever this control happened to say. */}
            {probeFailed && (
              <p className="text-xs text-fg-muted">{t("download_as_unknown_hint")}</p>
            )}

            {/* The other question this link raises, and only when it raises
                one. The backend has been reporting that a link is a playlist
                since the feature existed, to a form that showed a warning and
                offered nothing -- so the answer was always "the first video",
                and the other thirty-nine simply never arrived.

                Defaults to the one video. Queueing forty downloads is not what
                anybody means by pressing Download once, and it is the choice
                that is expensive to undo. */}
            {info && namesPlaylist && (
              <div className="flex flex-col gap-1.5">
                <Segmented
                  label={t("playlist_scope")}
                  value={playlist}
                  onChange={setPlaylist}
                  options={[
                    { value: "one" as const, label: t("playlist_only_this") },
                    {
                      value: "all" as const,
                      label: info.entryCount
                        ? t("playlist_all_of", {
                            total: formatCount(info.entryCount, i18n.language),
                          })
                        : t("playlist_all"),
                    },
                  ]}
                />
                {playlist === "all" && (
                  <p className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <ListVideo size={12} className="shrink-0" />
                    <span>
                      {t("playlist_all_hint", { slots: formatCount(slots, i18n.language) })}
                    </span>
                  </p>
                )}
              </div>
            )}
          </ControlGroup>
        )
      )}

      {looksLikeUrl(link) && (
        <WhenRow
          when={when}
          onWhenChange={setWhen}
          time={settings.scheduleTime}
          onTimeChange={(time) => update("scheduleTime", time)}
          startAt={startAt}
        />
      )}

      <OutputFolderRow
        folder={savePath}
        label={autoFolder && looksLikeUrl(link) ? t("save_auto_by_type") : undefined}
        onChoose={selectFolder}
      />

      {/* Only when it matters. yt-dlp is needed for a page and not for a file,
          so a missing one is a warning on one kind of link and nothing at all
          on the other. */}
      {!toolsReady && !isFile && (
        <p className="text-sm text-warning-text">{t("ytdlp_not_found")}</p>
      )}
    </ToolDialog>
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
  /** A thumbnail URL that did not load -- expired, blocked, or refused to a
   *  client without the site's cookies. The broken-image glyph is not a
   *  preview. */
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  useEffect(() => setThumbnailFailed(false), [info?.thumbnail]);

  return (
    <Card padding="sm" className="flex items-center gap-3">
      {kind && Icon ? (
        <span
          className={cn(
            "flex h-10 w-16 shrink-0 items-center justify-center rounded-sm",
            FILE_KIND_TINT[kind],
          )}
        >
          <Icon size={20} />
        </span>
      ) : info?.thumbnail && !thumbnailFailed ? (
        <img
          src={info.thumbnail}
          alt=""
          onError={() => setThumbnailFailed(true)}
          className="h-10 w-16 shrink-0 rounded-sm object-cover"
        />
      ) : info ? (
        // A page with no picture to show. It used to keep the loading pulse
        // after the probe had answered, which read as a preview still coming.
        <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-sm bg-surface-soft text-fg-muted">
          <FileVideo2 size={20} />
        </span>
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

            {/* That this link carries a playlist. The *choice* about it is a
                control further down the form -- this line is only the label,
                sitting with the title and channel it belongs to.

                It used to be a warning, because "the first video and nothing
                else" was all the app could do. It is not a warning any more. */}
            {info && (info.isPlaylist || info.inPlaylist) && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
                <ListVideo size={12} className="shrink-0" />
                {/* Two keys rather than i18next's `count`, which switches on a
                    plural rule and would need one key per form -- two in
                    English, six in Arabic -- and the locale checker requires
                    every bundle to carry the same key set. The length is worth
                    saying when it is known and not worth inventing when it is
                    not. */}
                <span className="truncate">
                  {info.entryCount
                    ? t("playlist_of", {
                        total: formatCount(info.entryCount, i18n.language),
                      })
                    : t("playlist_label")}
                </span>
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * The links a batch will download, one row each, with a way to drop one.
 *
 * The text field above is the list as typed; this is the list as understood --
 * tidied, de-duplicated, and without the prose a link was pasted inside. Each
 * row becomes a download of its own, whatever the others turn out to be.
 */
function BatchList({
  links,
  onRemove,
}: {
  links: string[];
  onRemove: (link: string) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <Card padding="none" className="flex flex-col">
      <p className="border-b border-line px-3 py-2 text-xs font-medium text-fg-soft">
        {t("batch_count", { links: formatCount(links.length, i18n.language) })}
      </p>
      <ul className="max-h-40 overflow-y-auto py-1">
        {links.map((link) => (
          <li key={link} className="flex items-center gap-2 px-3 py-1">
            <Link2 size={13} className="shrink-0 text-fg-muted" />
            <span dir="ltr" className="min-w-0 flex-1 truncate text-sm text-fg-soft" title={link}>
              {link}
            </span>
            <button
              type="button"
              onClick={() => onRemove(link)}
              aria-label={t("batch_remove", { link })}
              className="flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger-text"
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** 00 through 23, and the minutes in steps of five -- a schedule is "at two",
 *  not "at 02:07". */
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, step) => String(step * 5).padStart(2, "0"));

/**
 * Now, or at a time.
 *
 * For the internet packages that are free or cheaper at night: paste the links
 * in the evening, set 02:00, and leave the app open. Two selects rather than a
 * time input, whose rendering in the Linux webview is a bare text box with no
 * hint of the format it wants. The next time the clock reads that is the one
 * used -- today if still ahead, tomorrow otherwise -- and the line under the
 * control says which, so "02:00" is never ambiguous.
 */
function WhenRow({
  when,
  onWhenChange,
  time,
  onTimeChange,
  startAt,
}: {
  when: "now" | "later";
  onWhenChange: (when: "now" | "later") => void;
  time: string;
  onTimeChange: (time: string) => void;
  startAt: number | null;
}) {
  const { t } = useTranslation();
  const [hour = "02", minute = "00"] = time.split(":");
  // A stored minute that is not on the five-minute grid still has to show.
  const minuteOptions = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort();

  return (
    <ControlGroup>
      <Segmented
        label={t("schedule_when")}
        value={when}
        onChange={onWhenChange}
        options={[
          { value: "now", label: t("schedule_now") },
          { value: "later", label: t("schedule_later"), icon: <CalendarClock size={16} /> },
        ]}
      />
      {when === "later" && (
        <div className="flex flex-col gap-1.5">
          {/* A clock reads the same way in every language: hours, then minutes. */}
          <div dir="ltr" className="flex items-center gap-2">
            <Select
              aria-label={t("schedule_hour")}
              value={hour}
              onChange={(next) => onTimeChange(`${next}:${minute}`)}
              options={HOURS.map((value) => ({ value, label: value }))}
              className="w-24 tnum"
            />
            <span className="text-fg-muted" aria-hidden>
              :
            </span>
            <Select
              aria-label={t("schedule_minute")}
              value={minute}
              onChange={(next) => onTimeChange(`${hour}:${next}`)}
              options={minuteOptions.map((value) => ({ value, label: value }))}
              className="w-24 tnum"
            />
          </div>
          {startAt !== null && (
            <p className="flex items-center gap-1.5 text-xs text-fg-muted">
              <CalendarClock size={12} className="shrink-0" />
              <span>{t("schedule_hint", { when: describeWhen(startAt, t) })}</span>
            </p>
          )}
        </div>
      )}
    </ControlGroup>
  );
}

/**
 * The preview for a link the probe could not identify.
 *
 * It used to be nothing at all: the preview vanished, and the download that
 * followed was quietly assumed to be a video. It is neither assumed nor hidden
 * now. The link's type is shown as unknown -- which is the truth -- and the line
 * under it says when that changes: the engine looks at the link again when the
 * download starts, and the job's row takes on whatever it finds.
 */
function UnknownLinkPreview({ link }: { link: string }) {
  const { t } = useTranslation();

  return (
    <Card padding="sm" className="flex items-center gap-3">
      <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-sm bg-fg-muted/10 text-fg-muted">
        <FileQuestionMark size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg" dir="ltr" title={link}>
          {link}
        </p>
        <p className="truncate text-xs text-fg-muted">
          {t("file_kind_unknown")} · {t("file_kind_unknown_hint")}
        </p>
      </div>
    </Card>
  );
}

/**
 * What this download will ask for, and the way to change it.
 *
 * One line of hint text, not the bordered row this started as. The row was the
 * same size as the controls around it while being the only thing on the form
 * that is not a control -- and it sat there on an empty field, stating the
 * quality of a video nobody had pasted a link to yet. Now it appears with the
 * media choice it belongs to, and says its piece in the space a hint takes.
 *
 * One component for both halves of that choice rather than a quality-shaped one
 * and a sentence: they are the same line saying the same kind of thing -- the
 * standing setting this download will use, and where it lives.
 */
function SettingHint({
  icon,
  label,
  value,
  onOpenSettings,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
      <span className="shrink-0">{icon}</span>
      {label}
      {/* ltr: "720p" and "MP3" are numbers and Latin letters, the same in every
          language the interface speaks. A translated word -- "Original" -- is
          unaffected by the direction of a span that holds one word. */}
      <span dir="ltr" className="font-medium text-fg-soft">
        {value}
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
          resumable ? "text-success-text" : "text-fg-muted",
        )}
      >
        <RotateCw size={12} className="shrink-0" />
        {t(resumable ? "download_file_resumable" : "download_file_not_resumable")}
      </p>
    </div>
  );
}

