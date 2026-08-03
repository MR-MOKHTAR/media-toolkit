import { AppSidebar } from "downloader";

/**
 * The sidebar is the first child of a flex row, so it lands on the leading edge
 * -- left in English, right in Persian and Arabic. These cells reproduce that
 * row rather than mounting it bare, because "which edge" is the thing worth
 * seeing.
 *
 * Expanded/collapsed is not a prop: it is remembered in localStorage and
 * toggled from the chevron, so only the resting expanded state renders here.
 */
export function InAppShell() {
  return (
    <div className="flex h-96 w-full bg-canvas">
      <AppSidebar isRtl={false} />
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-xl font-medium text-fg">Download</p>
        <p className="text-sm text-fg-muted">
          Every screen is one click away, and the current one is highlighted.
        </p>
      </div>
    </div>
  );
}

export function Rtl() {
  return (
    <div dir="rtl" className="flex h-96 w-full bg-canvas">
      <AppSidebar isRtl />
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-xl font-medium text-fg">دانلود</p>
        <p className="text-sm text-fg-muted">
          نوار کناری به لبه‌ی آغازین می‌رود و جهت آن با زبان عوض می‌شود.
        </p>
      </div>
    </div>
  );
}
