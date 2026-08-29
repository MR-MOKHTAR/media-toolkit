import { cn } from "../../lib/cn";

interface ProgressBarProps {
  /** null renders an indeterminate bar. Used when ffmpeg cannot know the
   *  duration -- an honest sweep beats an invented number. */
  percent: number | null;
  className?: string;
  label?: string;
}

/**
 * The fill is a flow-relative child, sized with `inline-size`.
 *
 * Not `transform: scaleX()` and not an absolutely positioned `left`: both
 * grow from the physical left edge, so under RTL the bar would fill backwards.
 * `inline-size` follows the writing direction for free. The old toast timer
 * had exactly this bug -- `transform-origin: left` always drained leftwards.
 */
export function ProgressBar({ percent, className, label }: ProgressBarProps) {
  const indeterminate = percent === null;
  const clamped = indeterminate ? 100 : Math.min(100, Math.max(0, percent));

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
          "bg-(image:--gradient-accent)",
          "shadow-(--shadow-glow)",
          indeterminate
            ? "animate-[indeterminate_1.4s_var(--ease-out-quart)_infinite]"
            : [
                "transition-[inline-size] duration-(--duration-base) ease-out-quart",
                "bg-size-[200%_100%] animate-[shimmer_2.5s_ease-in-out_infinite]",
              ],
        )}
        style={{ inlineSize: indeterminate ? "40%" : `${clamped}%` }}
      />
    </div>
  );
}
