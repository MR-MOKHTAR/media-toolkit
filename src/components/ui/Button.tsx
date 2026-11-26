import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Tooltip, type TooltipSide } from "./Tooltip";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "accent"
  | "accentGhost"
  | "dangerGhost";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent hover:enabled:bg-accent-hover active:enabled:opacity-95",
  secondary:
    "border border-line bg-surface text-fg hover:enabled:border-line-strong hover:enabled:bg-surface-hover",
  ghost: "text-fg-soft hover:enabled:bg-surface-hover hover:enabled:text-fg",
  danger: "bg-danger text-white hover:enabled:opacity-90",
  accent: "text-accent hover:enabled:bg-accent-soft",
  accentGhost: "text-fg-muted hover:enabled:bg-accent-soft hover:enabled:text-accent",
  dangerGhost: "text-fg-muted hover:enabled:bg-danger/10 hover:enabled:text-danger-text",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-sm",
  md: "h-9 px-4 text-sm gap-2 rounded-md font-medium",
  lg: "h-11 px-5 text-base gap-2 rounded-md font-medium",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap",
        "transition-colors duration-(--duration-fast)",
        "disabled:opacity-disabled disabled:cursor-not-allowed",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: Variant;
  tooltipSide?: TooltipSide;
}

export function IconButton({
  label,
  variant = "ghost",
  tooltipSide = "bottom",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip label={label} side={tooltipSide}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-sm",
          "transition-colors duration-(--duration-fast)",
          "disabled:opacity-disabled disabled:cursor-not-allowed",
          VARIANTS[variant],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
}
