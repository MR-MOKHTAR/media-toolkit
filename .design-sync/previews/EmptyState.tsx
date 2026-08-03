import { Button, EmptyState } from "downloader";
import { FileVideo2, Inbox, WifiOff } from "lucide-react";

export function NoTasks() {
  return (
    <EmptyState
      icon={<Inbox size={22} />}
      title="Nothing running"
      description="Downloads and conversions you start will show up here, and keep going while you work in another tool."
    />
  );
}

export function WithAction() {
  return (
    <EmptyState
      icon={<FileVideo2 size={22} />}
      title="No file chosen"
      description="Drop a video anywhere in this window, or pick one from your computer."
      action={<Button variant="primary">Choose file</Button>}
    />
  );
}

export function TitleOnly() {
  return <EmptyState icon={<WifiOff size={22} />} title="No internet connection" />;
}
