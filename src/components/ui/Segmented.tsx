import type { ReactNode } from "react";
import { useRovingRadio } from "../../hooks/useRovingRadio";
import { cn } from "../../lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
  columns?: number;
}

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
              "text-center transition-colors duration-(--duration-fast)",
              "disabled:cursor-not-allowed disabled:opacity-disabled",
              selected
                ? "border-accent bg-accent-soft text-accent font-medium"
                : "border-line bg-surface text-fg-soft hover:enabled:border-line-strong hover:enabled:bg-surface-hover",
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
