import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  ClipboardPaste,
  FileQuestionMark,
  FileVideo2,
  Link2,
  ListVideo,
  Loader2,
  Music2,
  RotateCw,
  Video,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, ControlGroup, Field, SectionLabel } from "../../components/ui/Card";
import { IconButton } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { Modal } from "../../components/ui/Modal";
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
import type { PlaylistListing, UrlInfo } from "../jobs/types";
import { describeWhen, nextOccurrence } from "../jobs/when";
import { useDownloadForm, type PlaylistChoice } from "./useDownloadForm";
import { useDownloadSettings } from "./useDownloadSettings";
import { effectiveQuality, secondsOf } from "./downloadChoices";
import { AudioFormatPicker, MoreOptions, VideoQualityPicker } from "./components/MediaChoices";
import { PlaylistPicker } from "./components/PlaylistPicker";

interface Props {
  initialUrl?: string;
  isOnline: boolean;
  notify: (type: ToastType, message: string) => void;
  onDone: () => void;
}

export function DownloadForm({ initialUrl, isOnline, notify, onDone }: Props) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const [url, setUrl] = useState(initialUrl ?? "");
  const { settings, update } = useDownloadSettings();
  const [typeOverride, setTypeOverride] = useState<"video" | "audio" | null>(null);
  const [probe, setProbe] = useState<{ url: string; info: UrlInfo | null } | null>(null);
  const [probing, setProbing] = useState(false);
  const [filledFromClipboard, setFilledFromClipboard] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const link = normalizeUrl(url);
  const links = allUrlsIn(url);
  const batch = links.length > 1;
  const info = !batch && probe?.url === link ? probe.info : null;
  const probeFailed = !batch && probe?.url === link && probe.info === null;

  const isFile = info?.kind === "file";
  const fileKind: FileKind | null = info && isFile
    ? fileKindOf(info.title, info.uploader)
    : null;

  const summary = info?.media ?? null;
  const mediaType: "video" | "audio" =
    typeOverride ?? (summary?.suggestsAudio ? "audio" : settings.mediaType);
  useEffect(() => setTypeOverride(null), [link]);
  const setMediaType = (value: "video" | "audio") => {
    setTypeOverride(value);
    update("mediaType", value);
  };

  const [section, setSection] = useState<{ start: string; end: string } | null>(null);
  useEffect(() => setSection(null), [link]);

  const namesPlaylist = Boolean(info && (info.isPlaylist || info.inPlaylist));
  const [playlist, setPlaylist] = useState<PlaylistChoice>("one");
  useEffect(() => setPlaylist("one"), [link]);

  const [listing, setListing] = useState<{ url: string; data: PlaylistListing | null; failed: boolean } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (playlist !== "all" || !looksLikeUrl(link)) return;
    if (listing?.url === link) return;
    let cancelled = false;
    setListing({ url: link, data: null, failed: false });
    void ipc
      .listPlaylist(link, settings.cookiesFrom || undefined)
      .then((data) => {
        if (cancelled) return;
        setListing({ url: link, data, failed: false });
        setPicked(new Set(data.entries.map((entry) => entry.url)));
      })
      .catch(() => !cancelled && setListing({ url: link, data: null, failed: true }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist, link, settings.cookiesFrom]);
  const playlistData = listing?.url === link ? listing.data : null;

  const batchProbes = useBatchProbes(batch && isOnline ? links : [], settings.cookiesFrom);

  const { savePath, autoFolder, toolsReady, starting, selectFolder, start } = useDownloadForm({
    isOnline,
    notify,
    mediaType,
    link: info,
  });

  const [when, setWhen] = useState<"now" | "later">("now");
  const startAt = when === "later" ? nextOccurrence(settings.scheduleTime) : null;

  useEffect(() => {
    if (batch) areaRef.current?.focus();
    else inputRef.current?.focus();
  }, [batch]);

  useEffect(() => {
    if (initialUrl?.trim()) return;
    let cancelled = false;
    void ipc.readClipboardText().then((text) => {
      const all = text ? allUrlsIn(text) : [];
      const found = all.length > 1 ? all.join("\n") : text && firstUrlIn(text);
      if (cancelled || !found || urlRef.current) return;
      setUrl(found);
      setFilledFromClipboard(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initialUrl]);

  useEffect(() => {
    if (filledFromClipboard) (areaRef.current ?? inputRef.current)?.select();
  }, [filledFromClipboard]);

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
        .then((result) => !cancelled && setProbe({ url: link, info: result }))
        .catch(() => !cancelled && setProbe({ url: link, info: null }))
        .finally(() => !cancelled && setProbing(false));
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setProbing(false);
    };
  }, [batch, link, isOnline, settings.cookiesFrom]);

  const sectionRange = (() => {
    if (!section || mediaType !== "video") return null;
    const startSecs = secondsOf(section.start);
    const endSecs = secondsOf(section.end);
    return startSecs !== null && endSecs !== null && endSecs > startSecs
      ? { startSecs, endSecs }
      : undefined;
  })();
  const sectionValid = sectionRange !== undefined;

  const canSubmit =
    looksLikeUrl(link) &&
    Boolean(savePath) &&
    isOnline &&
    !starting &&
    (batch || toolsReady || isFile || !info) &&
    !(namesPlaylist && playlist === "all" && playlistData !== null && picked.size === 0) &&
    sectionValid;

  const pasteFromClipboard = async () => {
    const clip = await ipc.readClipboardText();
    if (!clip) return;
    const all = allUrlsIn(clip);
    const found = all.length > 1 ? all.join("\n") : firstUrlIn(clip) ?? clip.trim();
    if (found) setUrl(found);
  };

  const submit = () => {
    if (!canSubmit) return;
    void start(
      {
        url: link,
        mediaType,
        video: {
          quality: effectiveQuality(summary, settings.quality),
          codec: "auto",
          container: "mp4",
        },
        audio: {
          format: settings.audioFormat,
          bitrateKbps: undefined,
        },
        subtitles: { langs: settings.subtitleLangs, embed: true },
        embedMetadata: true,
        embedCover: true,
        sponsorBlock: false,
        section: sectionRange ?? null,
        playlistPicks:
          namesPlaylist && playlist === "all" && playlistData
            ? playlistData.entries
                .map((entry, index) => ({ entry, position: index + 1 }))
                .filter(({ entry }) => picked.has(entry.url))
            : undefined,
        playlistTitle: playlistData?.title ?? null,
        playlistFolder: true,
        playlistNumbers: true,
        playlist: namesPlaylist ? playlist : "one",
        cookiesFrom: settings.cookiesFrom,
        parallel: settings.parallel,
        link: info,
        urls: batch ? links : undefined,
        startAt,
      },
      onDone,
    );
  };

  const folderControl = (
    <OutputFolderRow
      folder={savePath}
      label={autoFolder && looksLikeUrl(link) ? t("save_auto_by_type") : undefined}
      onChoose={selectFolder}
    />
  );

  const scheduleControl = (
    <WhenRow
      when={when}
      onWhenChange={setWhen}
      time={settings.scheduleTime}
      onTimeChange={(time) => update("scheduleTime", time)}
      startAt={startAt}
    />
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      keepOnOutsideClick={looksLikeUrl(link)}
      title={t("tool_download")}
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
      <Field label={t("url_label")} htmlFor="download-url">
        {batch ? (
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
            rows={Math.min(6, Math.max(3, links.length + 1))}
            dir="ltr"
            spellCheck={false}
            placeholder={t("url_placeholder")}
          />
        ) : (
          <div className="relative">
            <Link2
              size={16}
              className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-fg-muted"
            />
            <TextInput
              ref={inputRef}
              id="download-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onPaste={(event) => {
                const text = event.clipboardData.getData("text");
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
              dir={url ? "ltr" : i18n.dir()}
              className={cn("h-11", isRtl ? "pl-10 pr-10" : "pl-10 pr-10")}
            />
            <div className="absolute end-1.5 top-1/2 -translate-y-1/2">
              {url ? (
                <IconButton label={t("remove")} onClick={() => setUrl("")}>
                  <X size={15} />
                </IconButton>
              ) : (
                <IconButton
                  label={t("composer_paste")}
                  onClick={() => void pasteFromClipboard()}
                >
                  <ClipboardPaste size={15} />
                </IconButton>
              )}
            </div>
          </div>
        )}
      </Field>

      {batch && (
        <BatchList
          links={links}
          probes={batchProbes}
          onRemove={(target) =>
            setUrl(links.filter((other) => other !== target).join("\n"))
          }
        />
      )}

      {(info || probing) && (
        <LinkPreview info={info} kind={fileKind} probing={probing} />
      )}
      {!info && !probing && probeFailed && <UnknownLinkPreview link={link} />}

      {looksLikeUrl(link) && !batch && !info && !probeFailed && isOnline && (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted" role="status">
          {probing ? (
            <Loader2 size={12} className="shrink-0 animate-spin" />
          ) : (
            <Link2 size={12} className="shrink-0" />
          )}
          {t("download_detecting")}
        </p>
      )}

      {isFile ? (
        <>
          <FileNotes resumable={info?.resumable ?? false} />
          <Disclosure
            label={t("more_options")}
            summary={when === "later" && startAt ? describeWhen(startAt, t) : undefined}
            open={settings.advancedOpen}
            onOpenChange={(open) => update("advancedOpen", open)}
          >
            {folderControl}
            {scheduleControl}
          </Disclosure>
        </>
      ) : (
        looksLikeUrl(link) &&
        (batch || info || probeFailed) && (
          <>
            <div className="flex flex-col gap-1.5">
              <SectionLabel>{t("download_as")}</SectionLabel>
              <Segmented
                label={t("download_as")}
                value={mediaType}
                onChange={setMediaType}
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
            </div>

            {mediaType === "video" ? (
              <VideoQualityPicker
                summary={summary}
                settings={settings}
                update={update}
                language={i18n.language}
              />
            ) : (
              <AudioFormatPicker
                summary={summary}
                durationSecs={info?.durationSecs ?? null}
                settings={settings}
                update={update}
                language={i18n.language}
              />
            )}

            {info && namesPlaylist && (
              <ControlGroup>
                <SectionLabel>{t("playlist_scope")}</SectionLabel>
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
                  <PlaylistPicker
                    listing={playlistData}
                    loading={listing?.url === link && !listing.data && !listing.failed}
                    failed={listing?.url === link && listing.failed}
                    selected={picked}
                    onSelectedChange={setPicked}
                  />
                )}
              </ControlGroup>
            )}

            <MoreOptions
              mediaType={mediaType}
              summary={summary}
              durationSecs={info?.durationSecs ?? null}
              settings={settings}
              update={update}
              section={section}
              onSectionChange={setSection}
              folderRow={folderControl}
              scheduleRow={scheduleControl}
              extraSummary={when === "later" && startAt ? describeWhen(startAt, t) : null}
            />
          </>
        )
      )}

      {!toolsReady && !isFile && (info || probeFailed) && (
        <p className="text-sm text-warning-text">{t("ytdlp_not_found")}</p>
      )}
    </Modal>
  );
}

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
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  useEffect(() => setThumbnailFailed(false), [info?.thumbnail]);

  return (
    <Card padding="sm" className="flex items-center gap-3">
      {kind && Icon ? (
        <span
          className={cn(
            "flex h-10 w-14 shrink-0 items-center justify-center rounded-sm",
            FILE_KIND_TINT[kind],
          )}
        >
          <Icon size={19} />
        </span>
      ) : info?.thumbnail && !thumbnailFailed ? (
        <span className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-surface">
          <img
            src={info.thumbnail}
            alt=""
            onError={() => setThumbnailFailed(true)}
            className="size-full object-cover"
          />
          {info.durationSecs ? (
            <span
              dir="ltr"
              className="absolute bottom-1 end-1 rounded-sm bg-black/75 px-1 text-[11px] leading-4 font-medium text-white tnum"
            >
              {formatDuration(info.durationSecs)}
            </span>
          ) : null}
        </span>
      ) : info ? (
        <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-sm bg-surface text-fg-muted">
          <FileVideo2 size={19} />
        </span>
      ) : (
        <div className="h-10 w-14 shrink-0 animate-pulse rounded-sm bg-line" />
      )}

      <div className="min-w-0 flex-1">
        {probing && !info ? (
          <div className="flex flex-col gap-1.5">
            <div className="h-3.5 w-3/4 animate-pulse rounded-sm bg-line" />
            <div className="h-3 w-1/3 animate-pulse rounded-sm bg-line" />
          </div>
        ) : (
          <>
            <p dir="auto" className="truncate text-start text-sm font-medium text-fg" title={info?.title}>
              {info?.title}
            </p>
            <p className="truncate text-xs text-fg-muted">
              {kind && info
                ? [
                    t(FILE_KIND_LABEL_KEY[kind]),
                    formatLabelOf(info.title),
                    info.sizeBytes
                      ? formatBytes(info.sizeBytes, i18n.language)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : [info?.uploader, info?.thumbnail ? null : formatDuration(info?.durationSecs)]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
            {info && (info.isPlaylist || info.inPlaylist) && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
                <ListVideo size={12} className="shrink-0" />
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

function BatchList({
  links,
  probes,
  onRemove,
}: {
  links: string[];
  probes: Map<string, UrlInfo | null>;
  onRemove: (link: string) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <Card padding="none" className="flex flex-col">
      <p className="border-b border-line px-3 py-2 text-xs font-medium text-fg-soft">
        {t("batch_count", { links: formatCount(links.length, i18n.language) })}
      </p>
      <ul className="max-h-36 overflow-y-auto py-1">
        {links.map((link) => (
          <li key={link} className="flex items-center gap-2 px-3 py-1">
            {probes.has(link) ? (
              probes.get(link)?.thumbnail ? (
                <img src={probes.get(link)!.thumbnail!} alt="" className="h-6 w-10 shrink-0 rounded-sm object-cover" />
              ) : (
                <Link2 size={13} className="shrink-0 text-fg-muted" />
              )
            ) : (
              <Loader2 size={13} className="shrink-0 animate-spin text-fg-muted" />
            )}
            {probes.get(link) ? (
              <span className="min-w-0 flex-1 truncate text-sm text-fg" title={link}>
                {probes.get(link)!.title}
                {probes.get(link)!.durationSecs ? (
                  <span dir="ltr" className="ms-1.5 text-xs text-fg-muted tnum">
                    {formatDuration(probes.get(link)!.durationSecs)}
                  </span>
                ) : null}
              </span>
            ) : (
              <span dir="ltr" className="min-w-0 flex-1 truncate text-sm text-fg-soft" title={link}>
                {link}
              </span>
            )}
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

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, step) => String(step * 5).padStart(2, "0"));

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
  const minuteOptions = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort();

  return (
    <ControlGroup>
      <SectionLabel>{t("schedule_when")}</SectionLabel>
      <Segmented
        label={t("schedule_when")}
        value={when}
        onChange={onWhenChange}
        options={[
          { value: "now", label: t("schedule_now") },
          { value: "later", label: t("schedule_later"), icon: <CalendarClock size={15} /> },
        ]}
      />
      {when === "later" && (
        <div className="flex flex-col gap-1.5">
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

function UnknownLinkPreview({ link }: { link: string }) {
  const { t } = useTranslation();

  return (
    <Card padding="sm" className="flex items-center gap-3">
      <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-sm bg-surface text-fg-muted">
        <FileQuestionMark size={19} />
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

function FileNotes({ resumable }: { resumable: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-soft px-3 py-2 text-center">
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

function useBatchProbes(links: string[], cookiesFrom: string): Map<string, UrlInfo | null> {
  const [probes, setProbes] = useState<Map<string, UrlInfo | null>>(new Map());
  const asked = useRef(new Set<string>());
  const key = links.join("\n");

  useEffect(() => {
    const pending = links.filter((link) => !asked.current.has(link));
    if (pending.length === 0) return;
    let cancelled = false;
    const worker = async () => {
      for (;;) {
        const next = pending.shift();
        if (!next || cancelled) return;
        asked.current.add(next);
        const info = await ipc.probeUrl(next, cookiesFrom || undefined).catch(() => null);
        if (cancelled) {
          asked.current.delete(next);
          return;
        }
        setProbes((current) => new Map(current).set(next, info));
      }
    };
    void Promise.all([worker(), worker()]);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cookiesFrom]);

  return probes;
}
