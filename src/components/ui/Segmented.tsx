import type { ReactNode } from "react";
import { useRovingRadio } from "../../hooks/useRovingRadio";
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
  /**
   * How many across. Defaults to all of them on one row, which is what a
   * three- or four-way choice wants.
   *
   * It exists for the one control that outgrew a row: the quality picker offers
   * six heights, and six equal columns inside the settings panel of a 600px
   * window leaves about 48px each -- narrower than the word "2160p" they have
   * to hold. Two rows of three is the same control, legible.
   */
  columns?: number;
}

/**
 * The app's replacement for a dropdown.
 *
 * Every choice in this app is between three or four fixed options -- quality,
 * format, preset, resolution. Laying them out flat means the options are
 * visible without a click, which matters more than saving the horizontal
 * space a select would.
 *
 * Radio semantics, and -- since these are buttons wearing the role, not
 * native inputs -- the radio keyboard to go with them: one Tab stop, arrows
 * to move. The comment here used to say the arrows came for free. They did
 * not; every option was its own Tab stop and the arrows did nothing.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  columns,
}: SegmentedProps<T>) {
  const radio = useRovingRadio({
    values: options.map((option) => option.value),
    value,
    onChange,
    isDisabled: (candidate) =>
      Boolean(options.find((option) => option.value === candidate)?.disabled),
  });

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={radio.onKeyDown}
      className={cn("grid gap-2", className)}
      style={{
        gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            {...radio.itemProps(option.value)}
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
