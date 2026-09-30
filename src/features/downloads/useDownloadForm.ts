/**
 * Everything the download screen needs that is not the job queue itself:
 * the save folder, whether the tools are present, and the pre-flight checks.
 *
 * What used to live here and no longer does: the YouTube URL check (yt-dlp
 * supports around a thousand sites and the backend now accepts any http URL),
 * and the "one download at a time" guard, which existed only because the
 * backend had a single process slot.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import {
  FILE_KIND_LABEL_KEY,
  fileKindOf,
  formatLabelOf,
} from "../../lib/fileKind";
import { formatCount } from "../../lib/format";
import * as ipc from "../../lib/ipc";
import { normalizeUrl } from "../../lib/url";
import type { ToastType } from "../../types/feedback";
import { detailKey } from "../jobs/detail";
import { describeAppError } from "../jobs/errorText";
import { describeWhen } from "../jobs/when";
import { useJobs } from "../jobs/useJobs";
import type { JobFileKind, LibrarySlot, UrlInfo } from "../jobs/types";
import type { AudioFormat } from "./useDownloadSettings";

interface Options {
  isOnline: boolean;
  notify: (type: ToastType, message: string) => void;
  /** Video and audio land on different shelves of the library, so the save
   *  folder tracks the toggle on the form. */
  mediaType: "video" | "audio";
  /** What the pasted link turned out to be, or null while the probe has not
   *  answered for the URL currently in the field. */
  link: UrlInfo | null;
}

export interface DownloadFormValues {
  url: string;
  mediaType: "video" | "audio";
  quality: string;
  /** What an audio download should end up as. Ignored for video, and for a
   *  direct file link, which is fetched as whatever it already is. */
  audioFormat: AudioFormat;
  /** Whether a link that names a playlist takes the one video or the whole
   *  list. `one` for every link that names no playlist at all. */
  playlist: PlaylistChoice;
  /** The browser to borrow cookies from, or empty for none. */
  cookiesFrom: string;
  /** The standing "download on several connections" setting, carried onto the
   *  request so a retry a week later runs the way this one did. */
  parallel: boolean;
  /** The probe for *this* URL, or null if it has not landed. Null is not a
   *  failure state: `start` fetches one itself rather than guessing. */
  link: UrlInfo | null;
  /** Every link, when more than one was pasted. Each becomes its own
   *  download, identified by the backend on its own -- no probe here, which
   *  for a list would be a yt-dlp spawn per line before anything started. */
  urls?: string[];
  /** When to start, as epoch ms; null or absent is now. */
  startAt?: number | null;
}

/**
 * Which shelf a link's result belongs on, or null while nothing knows.
 *
 * A direct link is filed by what it actually is, not by the fact that it was
 * direct: `Slot::Files` is documented as "anything fetched verbatim that is not
 * video or audio", and sending every direct link there put a `.mp4` URL
 * somewhere its own tool would never look for it.
 *
 * A link the probe has not identified has no shelf yet. It used to borrow the
 * toggle's -- the form showed the Video folder for an installer the probe had
 * merely timed out on -- when the backend decides once its engine has looked,
 * and checks again against the file that arrives.
 */
function slotFor(link: UrlInfo | null, mediaType: "video" | "audio"): LibrarySlot | null {
  if (!link) return null;
  if (link.kind === "file") {
    switch (fileKindOf(link.title, link.uploader)) {
      case "video":
        return "video";
      case "audio":
        return "audio";
      default:
        return "files";
    }
  }
  return mediaType === "audio" ? "audio" : "video";
}

/**
 * What the job card should say the download is, from what the probe found.
 *
 * Three answers, and the third is the point. A link the probe named as media
 * is whichever of the two the toggle asked for. A file is whatever its name and
 * type say -- an archive, an installer, or a video. A link the probe could not
 * answer for is `unknown`, not "video": it used to borrow the toggle's answer,
 * and a zip the probe had merely timed out on was drawn as a film and filed
 * under Video. The backend names it for certain once its engine has looked.
 */
function fileKindFor(link: UrlInfo | null, mediaType: "video" | "audio"): JobFileKind {
  if (!link) return "unknown";
  if (link.kind === "file") return fileKindOf(link.title, link.uploader);
  return mediaType;
}

/** The one-word format for a file's card: its extension, or -- for the rare
 *  link that has none -- what kind of thing it is. */
function detailFor(link: UrlInfo, t: TFunction): string {
  return (
    formatLabelOf(link.title) ??
    t(FILE_KIND_LABEL_KEY[fileKindOf(link.title, link.uploader)])
  );
}

/** The two answers to "this one, or all of them". */
export type PlaylistChoice = "one" | "all";

export function useDownloadForm({ isOnline, notify, mediaType, link }: Options) {
  const { t, i18n } = useTranslation();
  const { beginJob, discardJob, startDownload, scheduleDownload } = useJobs();
  const [savePath, setSavePath] = useState("");
  const [toolsReady, setToolsReady] = useState(true);
  /** True across the await in `start`, so a second Enter cannot queue the same
   *  link twice while the probe that decides its folder is in flight. The ref
   *  is what actually guards: the button reads the state, but Enter in the URL
   *  field does not go through the button, and two keystrokes can land inside
   *  one render. */
  const [starting, setStarting] = useState(false);
  const inFlight = useRef(false);
  /** Once the user has picked a folder, switching video/audio must not move it
   *  back under them. */
  const chosen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tools = await ipc.getToolStatus();
        if (cancelled) return;
        // Said once, inline, under the field it concerns. It was also a toast,
        // raised on every opening of the form -- and drawn under the form's own
        // scrim, where it could not be read.
        setToolsReady(tools.ytdlp);
      } catch (error) {
        if (!cancelled) notify("error", describeAppError(ipc.toAppError(error), t));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify, t]);

  // Separate from the tool check because it re-runs on the media toggle -- and
  // now on what the link turns out to be -- and re-probing yt-dlp for either
  // would be two seconds of nothing.
  const slot = slotFor(link, mediaType);

  useEffect(() => {
    if (chosen.current) return;
    let cancelled = false;
    void folderFor(slot)
      .then((folder) => {
        if (!cancelled && !chosen.current) setSavePath(folder);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slot]);

  const selectFolder = useCallback(async () => {
    try {
      const selected = await ipc.chooseFolder(savePath);
      if (selected) {
        chosen.current = true;
        setSavePath(selected);
      }
    } catch {
      notify("error", t("error_selecting_folder"));
    }
  }, [notify, savePath, t]);

  const start = useCallback(
    async (values: DownloadFormValues, onAccepted: () => void): Promise<boolean> => {
      const url = normalizeUrl(values.url);
      if (!url) {
        notify("error", t("invalid_url"));
        return false;
      }
      if (!isOnline) {
        notify("error", t("no_internet"));
        return false;
      }
      // What can be known before the form closes is checked before it closes:
      // a link already probed as a page with no yt-dlp to fetch it, or a folder
      // the user picked that is somehow empty. Closing first and reporting
      // after cost the user the link they had pasted.
      if (!toolsReady && values.link && values.link.kind !== "file") {
        notify("warning", t("ytdlp_not_found"));
        return false;
      }
      if (chosen.current && !savePath.trim()) {
        notify("error", t("select_location"));
        return false;
      }

      const startAt = values.startAt ?? null;

      /** What every download off this form carries, whether it is the one
       *  link that was pasted, one of several, or the fortieth video of a
       *  playlist. Only the URL and the name differ between them. */
      const requestFor = (target: string, dir: string, outputName: string | undefined) => ({
        url: target,
        outputDir: dir,
        outputName,
        mediaType: values.mediaType,
        quality: values.mediaType === "audio" ? undefined : values.quality,
        audioFormat: values.mediaType === "audio" ? values.audioFormat : undefined,
        // Always auto. The probe is a preview, not a decision: it can be stale
        // by the time the bytes are requested, and the backend is the one that
        // has to be right.
        mode: "auto" as const,
        parallel: values.parallel,
        // Empty means none. Sent as undefined rather than "" so a request
        // stored on a retry button reads the same as one from a build that had
        // no such setting.
        cookiesFrom: values.cookiesFrom || undefined,
        // The shelf is the backend's to choose unless the user chose a folder:
        // it decides once it knows what the link is, which is the only point at
        // which anyone does for certain. `outputDir` stays on the request as
        // the fallback, and as the folder the form showed.
        autoFolder: !chosen.current,
      });

      /** What was just done, said once for the whole press. */
      const announce = (count: number) =>
        notify(
          "info",
          startAt !== null
            ? t("scheduled_toast", { when: describeWhen(startAt, t) })
            : count > 1
              ? t("batch_queued", { queued: formatCount(count, i18n.language) })
              : t("job_started"),
        );

      // Several links: one download each, identified by the backend, which
      // since the file-type rework is where that has to happen anyway.
      if (values.urls && values.urls.length > 1) {
        onAccepted();
        const dir = chosen.current
          ? savePath
          : await folderFor(null).catch(() => savePath);
        if (!dir.trim()) {
          notify("error", t("select_location"));
          return false;
        }
        for (const target of values.urls) {
          const meta = { title: target, source: target, fileKind: "unknown" as const };
          if (startAt !== null) {
            scheduleDownload(requestFor(target, dir, undefined), meta, startAt);
          } else {
            void startDownload(requestFor(target, dir, undefined), meta).catch((error) =>
              notify("error", describeAppError(ipc.toAppError(error), t)),
            );
          }
        }
        announce(values.urls.length);
        return true;
      }

      // The form is done with. Everything below is a round trip to the backend
      // -- and one of them can be a yt-dlp spawn, which takes two seconds to
      // unpack itself before it says anything.
      //
      // Waiting for all of that before closing is what made the dialog sit
      // there after the button was pressed, looking like nothing had happened.
      // Nothing below can send the user back to this form: a link that turns
      // out to be bad is reported on the list behind it, which is where the
      // download would have been reported anyway.
      onAccepted();

      // The row, now, in the same beat as the dialog closing. Everything below
      // is between one and several seconds -- the probe alone can be a yt-dlp
      // spawn -- and a list that stays empty for that long after a button was
      // pressed reads as the press having been missed. What the row can say
      // this early is the title if the probe already landed, and the link
      // otherwise; the rest of it is drawn as a placeholder until the real job
      // takes its place. Every path out of here either hands this id to
      // `startDownload` or discards it.
      let placeholder: string | undefined = beginJob({
        kind: "download",
        title: values.link?.title.trim() || url,
        source: url,
        fileKind: fileKindFor(values.link, values.mediaType),
      });
      /** Frees the pending row for the paths that end without a download. */
      const abandon = () => {
        if (placeholder) discardJob(placeholder);
        placeholder = undefined;
        return false;
      };

      // The screen's probe is debounced by 600ms, so pasting a link and hitting
      // Enter straight away arrives here knowing nothing about it -- and the
      // folder, the title, the format and whether yt-dlp is even needed all
      // depend on the answer. One request now is cheaper than a zip filed under
      // Video under the name of its own URL.
      const resolved =
        values.link ??
        (await ipc.probeUrl(url, values.cookiesFrom || undefined).catch(() => null));

      // The folder is the one part the user can have already decided. Once they
      // have, nothing here may move it.
      let dir = savePath;
      if (!chosen.current) {
        dir = await folderFor(slotFor(resolved, values.mediaType)).catch(
          () => savePath,
        );
        if (dir !== savePath) setSavePath(dir);
      }

      if (!dir.trim()) {
        notify("error", t("select_location"));
        return abandon();
      }

      // Only for a link that needs the extractor. A direct file is fetched by
      // the app itself, so a missing yt-dlp has nothing to do with it.
      const isFile = resolved?.kind === "file";
      if (!toolsReady && !isFile) {
        notify("warning", t("ytdlp_not_found"));
        return abandon();
      }

      // The server's own name is kept for a file -- it is already the right
      // one, extension included. A video's title is not a file name until
      // yt-dlp has sanitized it, which is why it is passed for media only.
      const name = resolved?.title.trim();

      // What every download off this form carries, whether it is the one link
      // that was pasted or the fortieth video of a playlist. Only the URL and
      // the title differ between them.
      //
      // Nothing for a link the probe could not answer: a quality or "MP3" would
      // be a claim that it is media. The card writes the detail itself once the
      // backend has said what the link is.
      const fileKind = fileKindFor(resolved, values.mediaType);
      const detail = !resolved
        ? undefined
        : isFile
          ? detailFor(resolved, t)
          : values.mediaType === "audio"
            ? // Not the container: which one an `original` download lands in
              // depends on what the site turns out to serve, and the card is
              // written before a byte has been fetched. The word for the choice
              // is the honest thing to show, and it is the same word the setting
              // is labelled with.
              // A token, put into words when the row is drawn -- see
              // `renderDetail` -- so it follows the app's language.
              values.audioFormat === "original"
              ? detailKey("audio_format_original")
              : "MP3"
            : values.quality;
      // A playlist's entries are all media -- yt-dlp listed them -- whatever
      // the probe of the playlist page itself managed to say.
      const entryKind: JobFileKind = values.mediaType;

      /** Hands the pending row over to whoever queues first, and only once:
       *  every download after that draws its own, from `startDownload`. */
      const take = () => {
        const id = placeholder;
        placeholder = undefined;
        return id;
      };

      const queue = async (
        target: string,
        title: string,
        outputName: string | undefined,
        kind: JobFileKind,
      ) => {
        const request = requestFor(target, dir, outputName);
        // The URL is the last resort, not the default. It used to be what
        // every direct download was called, because the name was deliberately
        // left out of the request and the card read the same field.
        const meta = {
          title: title || target,
          source: target,
          detail: kind === "unknown" ? undefined : detail,
          fileKind: kind,
        };
        if (startAt !== null) {
          scheduleDownload(request, meta, startAt, take());
          return;
        }
        await startDownload(request, meta, take()).catch((error) =>
          notify("error", describeAppError(ipc.toAppError(error), t)),
        );
      };

      if (values.playlist === "all") {
        // The expensive call, made once and only here. Every entry becomes its
        // own job, so each gets its own row, its own progress and its own retry
        // button -- and the network semaphore already runs four at a time
        // rather than forty.
        const listing = await ipc
          .listPlaylist(url, values.cookiesFrom || undefined)
          .catch((error) => {
          notify("error", describeAppError(ipc.toAppError(error), t));
          return null;
        });
        if (!listing || listing.entries.length === 0) return abandon();

        // `outputName` is left undefined for every entry: the pasted link's
        // title belongs to the playlist, not to any video in it, and yt-dlp
        // names each file from its own page.
        for (const entry of listing.entries) {
          void queue(entry.url, entry.title, undefined, entryKind);
        }

        if (listing.truncated) {
          notify(
            "warning",
            t("playlist_queued_capped", {
              queued: formatCount(listing.entries.length, i18n.language),
              total: formatCount(listing.total, i18n.language),
            }),
          );
        } else if (startAt !== null) {
          announce(listing.entries.length);
        } else {
          notify(
            "info",
            t("playlist_queued", {
              queued: formatCount(listing.entries.length, i18n.language),
            }),
          );
        }
        return true;
      }

      void queue(url, name || url, isFile ? undefined : name || undefined, fileKind);

      announce(1);
      return true;
    },
    [
      beginJob,
      discardJob,
      i18n.language,
      isOnline,
      notify,
      savePath,
      scheduleDownload,
      startDownload,
      t,
      toolsReady,
    ],
  );

  /** Wraps `start` so the screen does not have to own the pending flag it
   *  needs to disable its own button. */
  const submit = useCallback(
    async (values: DownloadFormValues, onAccepted: () => void) => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setStarting(true);
      try {
        return await start(values, onAccepted);
      } finally {
        inFlight.current = false;
        setStarting(false);
      }
    },
    [start],
  );

  return {
    savePath,
    // Nothing chosen, and nothing known about the link: the shelf is the
    // backend's to pick once it has looked, so the form says that instead of
    // naming a folder it cannot promise.
    autoFolder: !chosen.current && slot === null,
    toolsReady,
    starting,
    selectFolder,
    start: submit,
  };
}

/** The shelf's folder, or the library root while the shelf is not known. */
function folderFor(slot: LibrarySlot | null): Promise<string> {
  return slot
    ? ipc.getLibraryFolder(slot)
    : ipc.getLibraryInfo().then((info) => info.root);
}
