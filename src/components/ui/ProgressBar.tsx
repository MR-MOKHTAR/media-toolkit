import { cn } from "../../lib/cn";

interface ProgressBarProps {
  percent: number | null;
  paused?: boolean;
  className?: string;
  label?: string;
}

export function ProgressBar({ percent, paused = false, className, label }: ProgressBarProps) {
  const indeterminate = percent === null && !paused;
  const clamped = percent === null ? 0 : Math.min(100, Math.max(0, percent));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-line",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full",
          paused ? "bg-fg-muted/60" : "bg-accent",
          indeterminate
            ? "animate-[indeterminate_1.4s_var(--ease-out-quart)_infinite]"
            : "transition-[inline-size] duration-(--duration-base) ease-out-quart",
        )}
        style={{ inlineSize: indeterminate ? "40%" : `${clamped}%` }}
      />
    </div>
  );
}
