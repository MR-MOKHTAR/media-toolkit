/** One unit of background work. Downloads and media operations are the same
 *  shape, so the queue, the job list and the progress UI are written once. */
export type JobKind =
  | "download"
  | "compress"
  | "trim"
  | "convert"
  | "resize"
  | "gif";

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
 *  rather than dumping Rust text into a toast. */
export type AppError =
  | { kind: "toolMissing"; tool: string }
  | { kind: "invalidInput"; field: string; reason: string }
  | { kind: "spawn"; tool: string; message: string }
  | { kind: "tool"; tool: string; code: number | null; tail: string }
  | { kind: "io"; path: string; message: string }
  | { kind: "cancelled" }
  | { kind: "unknownJob"; id: string };

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
}

export interface UrlInfo {
  title: string;
  uploader: string | null;
  durationSecs: number | null;
  thumbnail: string | null;
  isPlaylist: boolean;
  entryCount: number | null;
}

export interface ToolStatus {
  ytdlp: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
}

export const isActiveJob = (job: Job) =>
  job.state === "queued" || job.state === "running";
