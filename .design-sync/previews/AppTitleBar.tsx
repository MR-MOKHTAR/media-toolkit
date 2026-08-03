import { AppTitleBar } from "downloader";

const noop = () => {};

export function Default() {
  return (
    <div className="w-full">
      <AppTitleBar
        showTitle
        isMaximized={false}
        onMinimize={noop}
        onToggleMaximize={noop}
        onClose={noop}
      />
    </div>
  );
}

/* No `isMaximized` story: the prop swaps the middle control's label and tooltip
 * ("restore" for "maximize") but draws the same square glyph, so the cell would
 * be pixel-identical to Default and read as a duplicate. */

export function AboveContent() {
  return (
    <div className="flex w-full flex-col bg-canvas">
      <AppTitleBar
        showTitle
        isMaximized={false}
        onMinimize={noop}
        onToggleMaximize={noop}
        onClose={noop}
      />
      <div className="flex flex-col gap-1 p-4">
        <p className="text-xl font-medium text-fg">Download</p>
        <p className="text-sm text-fg-muted">
          The bar is identity, drag area and window controls — nothing else.
        </p>
      </div>
    </div>
  );
}
