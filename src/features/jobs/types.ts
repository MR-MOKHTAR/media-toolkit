/** One unit of background work. Downloads and media operations are the same
 *  shape, so the queue, the job list and the progress UI are written once. */
export type JobKind =
  | "download"
  | "compress"
  | "trim"
  | "convert"
  | "extractAudio";

export type JobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** What the job is doing. `merging` and `finalizing` exist because those phases
 *  sit at 100% for a while, and a stuck bar needs an explanation. */
export type JobStage =
  | "queued"
  | "preparing"
  | "downloading"
  | "merging"
  | "encoding"
  | "finalizing";

/** Mirrors the Rust `AppError` tagged union, so failures can be translated
 *  rather than dumping Rust text into a toast. Every `kind` here is asserted
 *  against its serialized spelling in `error.rs`'s tests: a variant that drifts
 *  falls through `describeAppError` to a generic "something went wrong". */
export type AppError =
  | { kind: "toolMissing"; tool: string }
  | { kind: "invalidInput"; field: string; reason: string }
  | { kind: "spawn"; tool: string; message: string }
  | { kind: "tool"; tool: string; code: number | null; tail: string }
  | { kind: "io"; path: string; message: string }
  | { kind: "cancelled" }
  | { kind: "unknownJob"; id: string }
  | { kind: "network"; message: string };

export interface JobProgress {
  id: string;
  kind: JobKind;
  /** null means indeterminate; show a spinner, not a number. */
  percent: number | null;
  stage: JobStage;
  /** Bytes per second. A number, not a formatted string: both download engines
   *  report one and `formatSpeed` writes it, so they cannot disagree about
   *  units on two rows of the same list. */
  speed: number | null;
  /** ffmpeg's realtime multiplier -- 2 means "twice as fast as playback". A
   *  different quantity from `speed` and written differently ("2.0×"), which is
   *  why it is a separate field rather than more overloading of one. */
  encodeRate: number | null;
  etaSecs: number | null;
  bytes: number | null;
  totalBytes: number | null;
}

/** A job the backend is still running. Mirrors Rust's `JobSummary`; it is all
 *  the registry knows about a job, which is enough to draw a row for one the
 *  webview lost track of. */
export interface JobSummary {
  id: string;
  kind: JobKind;
  title: string;
}

export type JobStatusEvent = { id: string; kind: JobKind } & (
  | { state: "queued" }
  | { state: "running" }
  | { state: "completed"; outputPath: string }
  | { state: "failed"; error: AppError }
  | { state: "cancelled" }
);

export interface Job {
  id: string;
  kind: JobKind;
  /** File name or media title -- what the user recognises it by. */
  title: string;
  /** Input path or source URL. */
  source: string;
  outputPath?: string;
  /** Everything needed to run this download again, kept so a failed or
   *  interrupted one has a button rather than a note telling the user to paste
   *  the link a second time. Downloads only: a media job's input is a file on
   *  disk that may not be there any more, and re-running one silently is a
   *  worse offer than re-opening the tool. */
  request?: DownloadRequest;
  state: JobState;
  stage: JobStage;
  percent: number | null;
  /** Bytes per second, for downloads. */
  speed?: number;
  /** ffmpeg's realtime multiplier, for the encoding tools. */
  encodeRate?: number;
  etaSecs?: number;
  bytes?: number;
  totalBytes?: number;
  error?: AppError;
  createdAt: number;
  endedAt?: number;
  /** Kind-specific detail for the metadata line: "1080p", "Balanced", "MP3". */
  detail?: string;
}

export interface DownloadRequest {
  url: string;
  outputDir: string;
  outputName?: string;
  mediaType: "video" | "audio";
  quality?: string;
  /** Which engine to use. `auto` -- what every screen sends -- lets the backend
   *  decide from one HTTP request: a page goes to yt-dlp, a link that already
   *  points at the file goes to the direct downloader. */
  mode?: "auto" | "media" | "file";
  /** Whether a video page's streams may be fetched on many connections rather
   *  than by yt-dlp on one. Absent means yes. Stored with the download
   *  preferences and carried on the request so a retry runs the way the
   *  original did. */
  parallel?: boolean;
}

/** One shelf in the app's library folder. Mirrors `library::Slot` in Rust; a
 *  download splits by what it produced, which is why "video" and "audio" are
 *  here rather than a single "download". */
export type LibrarySlot =
  | "video"
  /** Audio the app produced: a download asked for as audio, and a track lifted
   *  out of a video. Both are audio files, and which tool made one is not what
   *  anybody looks for it under. */
  | "audio"
  /** Anything fetched verbatim that is not video or audio. */
  | "files"
  | "compressed"
  | "trimmed"
  | "converted";

/** Which shelf each tool writes to. Kept beside the type so adding a tool has
 *  exactly one place to answer "where does its output go". */
export const SLOT_FOR_KIND: Record<Exclude<JobKind, "download">, LibrarySlot> = {
  compress: "compressed",
  trim: "trimmed",
  convert: "converted",
  extractAudio: "audio",
};

export interface LibraryInfo {
  /** Where files are being written now. */
  root: string;
  /** `<Downloads>/Media Toolkit`, for the "reset" affordance. */
  defaultRoot: string;
  isDefault: boolean;
  /** One subfolder per tool inside the root. */
  organizeByTool: boolean;
  /** Media tools default to the source file's folder instead of the library. */
  saveNextToInput: boolean;
}

/** What a pasted link turned out to be. `media` is a page yt-dlp extracts
 *  from; `file` is a link that already points at the bytes. */
export type UrlKind = "media" | "file";

export interface UrlInfo {
  kind: UrlKind;
  /** The video's title, or the file's name. */
  title: string;
  /** The channel, or -- for a file -- its content type. */
  uploader: string | null;
  durationSecs: number | null;
  thumbnail: string | null;
  isPlaylist: boolean;
  entryCount: number | null;
  /** Known ahead of time only for a file. */
  sizeBytes: number | null;
  /** Whether an interrupted download of this link continues rather than
   *  restarts. */
  resumable: boolean;
}

export interface ToolStatus {
  ytdlp: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  /** The JavaScript runtime yt-dlp runs YouTube's player challenge in --
   *  `deno`, `node`, `bun` or `quickjs` -- or null if this machine has none.
   *
   *  Not bundled and not required: measured against a 4K YouTube video, the
   *  same formats came back either way. It is reported because it is the one
   *  thing a user can install themselves that removes yt-dlp's "some formats
   *  may be missing" warning outright. */
  jsRuntime: string | null;
  /** What yt-dlp reports, or null if it will not run. */
  ytdlpVersion: string | null;
}

export interface UpdateResult {
  previous: string | null;
  current: string;
  /** False when the download turned out to be the version already installed. */
  changed: boolean;
}


export const isActiveJob = (job: Job) =>
  job.state === "queued" || job.state === "running";
