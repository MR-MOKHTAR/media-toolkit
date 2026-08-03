import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Rendered before the label; flips side automatically under RTL because
   *  the row is a flex container using logical direction. */
  icon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent hover:bg-accent-hover disabled:hover:bg-accent",
  secondary:
    "bg-surface text-fg border border-line hover:bg-surface-hover hover:border-line-strong",
  ghost: "text-fg-soft hover:bg-surface-hover hover:text-fg",
  danger: "text-danger hover:bg-danger/10",
};

/** Three heights, 8px apart, and one type size across all of them.
 *
 *  `lg` used to be 44px with 15px text -- a touch target on a mouse-driven
 *  desktop window, and next to a 40px input it read as a banner rather than a
 *  button. 40/36/32 keeps the run button clearly the largest control in a form
 *  without it being the loudest thing on the screen. */
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-sm",
  md: "h-9 px-4 text-sm gap-2 rounded-md",
  lg: "h-10 px-5 text-sm gap-2 rounded-md font-medium",
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
        "transition-colors duration-[--duration-fast]",
        "disabled:opacity-45 disabled:cursor-not-allowed",
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
  /** Required: an icon alone tells a screen reader nothing. */
  label: string;
  variant?: Variant;
}

export function IconButton({
  label,
  variant = "ghost",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-sm",
        "transition-colors duration-[--duration-fast]",
        "disabled:opacity-45 disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
