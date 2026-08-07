/** One unit of background work. Downloads and media operations are the same
 *  shape, so the queue, the job list and the progress UI are written once. */
export type JobKind =
  | "download"
  | "compress"
  | "trim"
  | "convert"
  | "gif"
  | "transcribe";

export type JobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** What the job is doing. `merging` and `finalizing` exist because those phases
 *  sit at 100% for a while, and a stuck bar needs an explanation.
 *  `transcribing` is its own stage because the work is happening on Groq's
 *  machines, not this one, and "Processing" would claim otherwise. */
export type JobStage =
  | "queued"
  | "preparing"
  | "downloading"
  | "merging"
  | "encoding"
  | "transcribing"
  | "finalizing";

/** Which budget ran out. The hour recovers in minutes and the day does not, so
 *  this is the only part of a rate limit anyone can act on. */
export type RateScope = "hour" | "day" | "request";

/** Mirrors the Rust `AppError` tagged union, so failures can be translated
 *  rather than dumping Rust text into a toast. */
export type AppError =
  | { kind: "toolMissing"; tool: string }
  | { kind: "invalidInput"; field: string; reason: string }
  | { kind: "spawn"; tool: string; message: string }
  | { kind: "tool"; tool: string; code: number | null; tail: string }
  | { kind: "io"; path: string; message: string }
  | { kind: "cancelled" }
  | { kind: "unknownJob"; id: string }
  | { kind: "missingApiKey"; service: string }
  | { kind: "rateLimited"; scope: RateScope; retryAfterSecs: number | null }
  | { kind: "api"; service: string; status: number; message: string }
  | { kind: "network"; message: string };

export interface JobProgress {
  id: string;
  kind: JobKind;
  /** null means indeterminate; show a spinner, not a number. */
  percent: number | null;
  stage: JobStage;
  speed: string | null;
  etaSecs: number | null;
  bytes: number | null;
  totalBytes: number | null;
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
  speed?: string;
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
}

/** One shelf in the app's library folder. Mirrors `library::Slot` in Rust; a
 *  download splits by what it produced, which is why "video" and "audio" are
 *  here rather than a single "download". */
export type LibrarySlot =
  | "video"
  | "audio"
  /** Anything fetched verbatim that is not video or audio. */
  | "files"
  | "compressed"
  | "trimmed"
  | "converted"
  | "gif"
  | "transcripts";

/** Which shelf each tool writes to. Kept beside the type so adding a tool has
 *  exactly one place to answer "where does its output go". */
export const SLOT_FOR_KIND: Record<Exclude<JobKind, "download">, LibrarySlot> = {
  compress: "compressed",
  trim: "trimmed",
  convert: "converted",
  gif: "gif",
  transcribe: "transcripts",
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
  /** What yt-dlp reports, or null if it will not run. */
  ytdlpVersion: string | null;
}

export interface UpdateResult {
  previous: string | null;
  current: string;
  /** False when the download turned out to be the version already installed. */
  changed: boolean;
}

/** The two Groq Whisper models. Each has its own audio-seconds budget, which is
 *  why switching model is real advice when one of them runs out. */
export type TranscribeModel = "whisperLargeV3" | "whisperLargeV3Turbo";

export type TranscriptFormat = "txt" | "srt" | "vtt";

export interface TranscribeRequest {
  input: string;
  outputDir: string;
  outputName?: string;
  model: TranscribeModel;
  /** ISO-639-1, or omitted to let Whisper detect it. */
  language?: string;
  translate: boolean;
  format: TranscriptFormat;
  prompt?: string;
}

/** Groq meters audio-seconds in two rolling windows, per model. `hourUsed` is
 *  an estimate kept on this machine -- see the note in the Rust `ledger`. */
export interface Quota {
  hourUsed: number;
  hourLimit: number;
  dayUsed: number;
  dayLimit: number;
  /** When the oldest charge falls out of its window. Nothing "resets" in a
   *  rolling window; capacity dribbles back. */
  hourFreesInSecs: number;
  dayFreesInSecs: number;
  /** Set only when Groq itself told us to stop. */
  blockedForSecs: number | null;
}

export interface ApiKeyStatus {
  present: boolean;
  /** The last four characters, so two keys can be told apart. The key itself
   *  never crosses into the webview. */
  hint: string | null;
}

export interface TranscriptText {
  text: string;
  truncated: boolean;
}

export const isActiveJob = (job: Job) =>
  job.state === "queued" || job.state === "running";
