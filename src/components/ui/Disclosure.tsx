import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "../../lib/cn";

interface Props {
  label: string;
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

export function Disclosure({ label, summary, open, onOpenChange, children, className }: Props) {
  const id = useId();

  return (
    <div className={cn("rounded-lg border border-line bg-surface-soft", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-start transition-colors duration-(--duration-fast) hover:bg-surface-hover"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-fg">{label}</span>
          {summary && !open && (
            <span className="truncate text-xs text-fg-muted">{summary}</span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={cn(
            "shrink-0 text-fg-muted transition-transform duration-(--duration-fast)",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div id={id} className="flex flex-col gap-3.5 border-t border-line px-3.5 pb-3.5 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}
