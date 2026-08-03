import { ProgressBar } from "downloader";

export function Determinate() {
  return (
    <div className="flex w-96 flex-col gap-4">
      <ProgressBar percent={12} label="Downloading" />
      <ProgressBar percent={48} label="Downloading" />
      <ProgressBar percent={91} label="Downloading" />
      <ProgressBar percent={100} label="Finished" />
    </div>
  );
}

export function Indeterminate() {
  return (
    <div className="w-96">
      {/* null when ffmpeg cannot know the duration -- an honest sweep rather
          than an invented percentage. */}
      <ProgressBar percent={null} label="Converting" />
    </div>
  );
}

export function WithLabelRow() {
  return (
    <div className="flex w-96 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="flex-1 truncate text-sm text-fg">Compressing clip.mp4</span>
        <span className="shrink-0 text-xs text-fg-muted tnum">37%</span>
      </div>
      <ProgressBar percent={37} label="Compressing" />
    </div>
  );
}
