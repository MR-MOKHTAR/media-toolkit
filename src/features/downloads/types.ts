export type DownloadMediaType = "audio" | "video";

export type DownloadStatus =
  | "preparing"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export type DownloadFilter = "all" | "active" | "completed" | DownloadMediaType;

export interface ProgressPayload {
  percent: number;
  size: string;
  speed: string;
  eta: string;
}

export interface DownloadResult {
  success: boolean;
  message: string;
  file_path?: string;
}

export interface DownloadItem {
  id: string;
  name: string;
  url: string;
  savePath: string;
  filePath?: string;
  type: DownloadMediaType;
  quality: string;
  status: DownloadStatus;
  progress: number;
  size: string;
  speed: string;
  eta: string;
  createdAt: number;
}

export interface DownloadRequest {
  url: string;
  filename: string;
  savePath: string;
  downloadType: DownloadMediaType;
  quality: string;
}

export interface DownloadCounts {
  all: number;
  active: number;
  completed: number;
  audio: number;
  video: number;
}
