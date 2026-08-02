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
