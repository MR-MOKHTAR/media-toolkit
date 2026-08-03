import { Button, Card, Field, ProgressBar, TextInput } from "downloader";

export function Basic() {
  return (
    <Card>
      <p className="text-lg font-medium text-fg">Download</p>
      <p className="mt-1 text-sm text-fg-muted">
        Paste a link and pick where the file should go.
      </p>
    </Card>
  );
}

export function WithForm() {
  return (
    <Card className="w-96">
      <div className="flex flex-col gap-4">
        <Field label="Video URL" htmlFor="card-url">
          <TextInput id="card-url" dir="ltr" defaultValue="https://youtu.be/dQw4w9WgXcQ" />
        </Field>
        <Field label="Save to" htmlFor="card-dest" hint="Files are never uploaded anywhere.">
          <TextInput id="card-dest" dir="ltr" defaultValue="/home/you/Videos" />
        </Field>
        <Button variant="primary">Start download</Button>
      </div>
    </Card>
  );
}

export function JobCard() {
  return (
    <Card className="w-96">
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <span className="flex-1 truncate text-base font-medium text-fg">
            Interstellar — docking scene.mp4
          </span>
          <span className="shrink-0 text-xs text-fg-muted tnum">62%</span>
        </div>
        <ProgressBar percent={62} label="Downloading" />
        <p className="text-xs text-fg-muted tnum">148 MB of 240 MB · 4.1 MB/s</p>
      </div>
    </Card>
  );
}
