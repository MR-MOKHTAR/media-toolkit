import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shown under the label. Used for the "about 21 MB" hint on presets. */
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Why it is disabled, e.g. "already smaller". */
  disabledReason?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/**
 * The app's replacement for a dropdown.
 *
 * Every choice in this app is between three or four fixed options -- quality,
 * format, preset, resolution. Laying them out flat means the options are
 * visible without a click, which matters more than saving the horizontal
 * space a select would.
 *
 * Built on radios so keyboard arrows, screen reader grouping and form
 * semantics come for free rather than being reimplemented badly.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid gap-2", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            title={option.disabled ? option.disabledReason : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-md border px-3 py-2",
              "text-center transition-all duration-(--duration-fast)",
              "disabled:cursor-not-allowed disabled:opacity-disabled",
              selected
                ? "border-accent-line bg-accent-soft text-accent shadow-(--shadow-glow)"
                : "border-line bg-surface text-fg-soft hover:enabled:border-line-strong hover:enabled:bg-surface-hover hover:enabled:scale-[1.02]",
            )}
          >
            {option.icon}
            <span className={cn("text-sm", selected && "font-medium")}>
              {option.label}
            </span>
            {(option.hint || option.disabledReason) && (
              <span className="text-xs text-fg-muted tnum">
                {option.disabled ? option.disabledReason : option.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
