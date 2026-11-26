import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

interface CardProps extends HTMLAttributes<HTMLElement> {
  padding?: "none" | "sm" | "md";
  interactive?: boolean;
  surface?: "glass" | "inset";
  as?: "div" | "li" | "section";
}

const CARD_PADDING = {
  none: "",
  sm: "p-3",
  md: "p-4",
} as const;

export function Card({
  padding = "md",
  interactive = false,
  surface = "inset",
  as: Tag = "div",
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Tag
      className={cn(
        "relative rounded-lg border border-line",
        surface === "glass" ? "bg-surface shadow-(--shadow-card)" : "bg-surface-soft",
        CARD_PADDING[padding],
        interactive &&
          "transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface-hover",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function FormCard({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-5 rounded-xl border border-line bg-surface p-6 shadow-(--shadow-card)",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ControlGroup({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} {...props}>
      {children}
    </div>
  );
}

interface FieldProps {
  label: string;
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

export function SectionLabel({
  as: Tag = "h3",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "h2" | "h3" | "p" }) {
  return (
    <Tag
      className={cn("text-sm font-medium text-fg-soft", className)}
      {...props}
    >
      {children}
    </Tag>
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
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg border border-line bg-surface text-fg-muted">
        {icon}
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-lg font-medium text-fg">{title}</p>
        {description && (
          <p className="max-w-sm text-sm leading-relaxed text-balance text-fg-muted">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
