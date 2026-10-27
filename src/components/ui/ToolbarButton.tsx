import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

/**
 * A button the size of the text beside it.
 *
 * For the places `Button`'s 32px minimum is a different order of thing from the
 * row it sits in -- the status bar, where everything is 11px. No border and no
 * fill at rest; it lights up on hover like the rest of the app's quiet actions.
 */
export function ToolbarButton({
  icon,
  className,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  return (
    <button
      type={type}
      className={cn(
        "flex h-4 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] text-fg-muted transition-colors",
        "hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
