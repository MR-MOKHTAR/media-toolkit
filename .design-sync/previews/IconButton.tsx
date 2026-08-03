import { IconButton } from "downloader";
import { Copy, FolderOpen, Pause, Play, RotateCcw, Trash2, X } from "lucide-react";

export function Variants() {
  return (
    <div className="flex items-center gap-2">
      <IconButton label="Pause" variant="ghost">
        <Pause size={16} />
      </IconButton>
      <IconButton label="Show in folder" variant="secondary">
        <FolderOpen size={16} />
      </IconButton>
      <IconButton label="Remove" variant="danger">
        <Trash2 size={16} />
      </IconButton>
      <IconButton label="Start" variant="primary">
        <Play size={16} />
      </IconButton>
    </div>
  );
}

export function JobRowControls() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
      <span className="flex-1 truncate text-sm text-fg">
        Blade Runner 2049 — official trailer.mp4
      </span>
      <IconButton label="Copy source URL">
        <Copy size={15} />
      </IconButton>
      <IconButton label="Retry">
        <RotateCcw size={15} />
      </IconButton>
      <IconButton label="Cancel" variant="danger">
        <X size={16} />
      </IconButton>
    </div>
  );
}

/** Paired against the enabled control, because 45% opacity on a bare icon is
 *  only legible next to the thing it is dimmed from. */
export function Disabled() {
  return (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-2">
        <IconButton label="Pause">
          <Pause size={16} />
        </IconButton>
        <IconButton label="Show in folder" variant="secondary">
          <FolderOpen size={16} />
        </IconButton>
        <IconButton label="Remove" variant="danger">
          <Trash2 size={16} />
        </IconButton>
      </div>
      <div className="flex items-center gap-2">
        <IconButton label="Pause" disabled>
          <Pause size={16} />
        </IconButton>
        <IconButton label="Show in folder" variant="secondary" disabled>
          <FolderOpen size={16} />
        </IconButton>
        <IconButton label="Remove" variant="danger" disabled>
          <Trash2 size={16} />
        </IconButton>
      </div>
    </div>
  );
}
