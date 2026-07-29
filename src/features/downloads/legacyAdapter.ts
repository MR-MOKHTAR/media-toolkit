/**
 * TEMPORARY. Delete with the download-manager UI in phase 5.
 *
 * The sidebar, table and row components still speak `DownloadItem`. Rather
 * than rewrite screens that are about to be replaced by the job cards, this
 * projects a `Job` onto the old shape so the existing UI keeps working while
 * the backend underneath it becomes concurrent.
 */
import type { Job } from "../jobs/types";
import { isActiveJob } from "../jobs/types";
import type { DownloadItem, DownloadStatus } from "./types";

const DASH = "—";

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes <= 0) return DASH;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatEta(seconds?: number): string {
  if (seconds === undefined || seconds < 0) return DASH;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function toStatus(job: Job): DownloadStatus {
  switch (job.state) {
    case "queued":
      return "preparing";
    case "running":
      return job.stage === "preparing" ? "preparing" : "downloading";
    default:
      return job.state;
  }
}

export function jobToDownloadItem(job: Job): DownloadItem {
  const audio = job.detail === "MP3" || job.detail === "audio";
  return {
    id: job.id,
    name: job.outputPath ? job.outputPath.split(/[/\\]/).pop() ?? job.title : job.title,
    url: job.source,
    savePath: "",
    filePath: job.outputPath,
    type: audio ? "audio" : "video",
    quality: job.detail ?? "",
    status: toStatus(job),
    progress: job.percent ?? 0,
    size: formatBytes(job.totalBytes ?? job.bytes),
    speed: job.speed ?? DASH,
    eta: formatEta(job.etaSecs),
    createdAt: job.createdAt,
  };
}

export const jobsToDownloadItems = (jobs: Job[]) => jobs.map(jobToDownloadItem);

export const activeJobIds = (jobs: Job[]) =>
  new Set(jobs.filter(isActiveJob).map((job) => job.id));
