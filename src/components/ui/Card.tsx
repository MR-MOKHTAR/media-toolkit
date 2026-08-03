import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Card({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface p-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * The surface every form in the app is drawn on.
 *
 * One card, one border, one shadow, holding the whole set of controls -- which
 * is what a form looks like everywhere else, and what the screens here were
 * missing: each control carried its own border and they stacked loose down the
 * middle of the canvas, so a five-control form read as five unrelated boxes.
 *
 * Glass, not a flat panel: a translucent surface over the canvas with a blur
 * behind it. It sits lighter than the page instead of being a second, brighter
 * white, and anything sliding underneath -- the history panel, a toast --
 * shows through rather than stopping at a hard edge.
 */
export function FormCard({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3.5 rounded-xl border border-line p-5",
        "bg-surface/70 shadow-(--shadow-card) backdrop-blur-md",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface FieldProps {
  label: string;
  /** Marks the control optional without an extra line of explanation. */
  optional?: boolean;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  optional,
  hint,
  htmlFor,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-2 text-sm font-medium text-fg-soft">
        {label}
        {optional && <span className="text-xs font-normal text-fg-muted">•</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg bg-surface-soft text-fg-muted">
        {icon}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-lg font-medium text-fg">{title}</p>
        {description && (
          <p className="max-w-xs text-sm text-fg-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
