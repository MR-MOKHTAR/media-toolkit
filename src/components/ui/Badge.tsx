import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "accent" | "success" | "danger";
type Variant = "solid" | "outline";

interface BadgeProps {
  children: ReactNode;
  /** Rendered before the label, inside the same pill. */
  icon?: ReactNode;
  tone?: Tone;
  /**
   * `outline` for a badge that sits on a tinted surface -- a filled pill on
   * the selected model card's own accent tint is a pill nobody can see.
   */
  variant?: Variant;
  className?: string;
}

const SOLID: Record<Tone, string> = {
  neutral: "bg-surface-soft text-fg-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
};

const OUTLINE: Record<Tone, string> = {
  neutral: "border border-line text-fg-muted",
  accent: "border border-accent-line text-accent",
  success: "border border-success text-success",
  danger: "border border-danger text-danger",
};

/**
 * The one badge.
 *
 * There were three, and they disagreed about every value that decides how a
 * badge looks: the job card's status chip was `rounded-full px-2 py-0.5`, the
 * stream-copy badge was `rounded-sm px-2 py-1 font-medium`, and the model
 * picker's was `rounded-full px-1.5 py-0.5 text-[11px]` -- the only arbitrary
 * font size in the codebase, and below the 13px floor the type scale exists to
 * enforce. Three of them appear within one screen of each other.
 *
 * `rounded-sm`, because that is what the radius scale documents for chips and
 * badges. `rounded-full` stays for the things that are actually round: the
 * progress track, the slider thumb, the busy dot.
 */
export function Badge({
  children,
  icon,
  tone = "neutral",
  variant = "solid",
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-sm px-2 py-0.5",
        "text-xs font-medium leading-normal",
        variant === "solid" ? SOLID[tone] : OUTLINE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
