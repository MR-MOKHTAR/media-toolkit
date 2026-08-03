import { Button } from "downloader";
import { Download, FolderOpen, Trash2, X } from "lucide-react";

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Start download</Button>
      <Button variant="secondary">Choose folder</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Remove</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" size="sm">
        Small
      </Button>
      <Button variant="primary" size="md">
        Medium
      </Button>
      <Button variant="primary" size="lg">
        Large
      </Button>
    </div>
  );
}

export function WithIcon() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" icon={<Download size={16} />}>
        Download
      </Button>
      <Button variant="secondary" icon={<FolderOpen size={16} />}>
        Show in folder
      </Button>
      <Button variant="danger" icon={<Trash2 size={16} />}>
        Clear finished
      </Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled icon={<Download size={16} />}>
        Start download
      </Button>
      <Button variant="secondary" disabled>
        Choose folder
      </Button>
      <Button variant="ghost" disabled icon={<X size={16} />}>
        Cancel
      </Button>
    </div>
  );
}
