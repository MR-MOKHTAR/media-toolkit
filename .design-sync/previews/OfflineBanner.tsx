import { OfflineBanner } from "downloader";

/**
 * The banner renders nothing while `isOnline` is true -- that is the whole
 * component, so there is no "online" story worth a cell. It animates its own
 * height open, which is why the wrapper is full-width rather than padded.
 */
export function Offline() {
  return (
    <div className="w-full">
      <OfflineBanner isOnline={false} />
    </div>
  );
}

export function AboveContent() {
  return (
    <div className="flex w-full flex-col bg-canvas">
      <OfflineBanner isOnline={false} />
      <div className="flex flex-col gap-2 p-4">
        <p className="text-base font-medium text-fg">Download</p>
        <p className="text-sm text-fg-muted">
          Links cannot be checked until the connection is back.
        </p>
      </div>
    </div>
  );
}
