import { Check, ChevronDown, ChevronUp } from "lucide-react";
import * as RadixSelect from "@radix-ui/react-select";

import { cn } from "../../lib/cn";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Wired to the trigger, so the visible <label> still names the control. */
  id?: string;
  className?: string;
}

/**
 * The dropdown, for the one choice in this app too long to lie flat.
 *
 * `Segmented` is the house style and handles every other choice here, because
 * they are all between three or four fixed options. Spoken language is not: it
 * is about a hundred, and cutting it down to the three the interface speaks
 * would make the tool worse at the job it exists to do.
 *
 * This replaces a native `<select>`, for the reason `Tooltip` gives about the
 * native `title` attribute: the OS draws it, so it cannot be themed and it looks
 * like a different program inside a window with no chrome. It also could not be
 * made to open the right way round -- the menu a native select drops is placed
 * by the platform, which in a right-to-left window is the one thing it gets
 * wrong most often.
 *
 * Direction comes from the `DirectionProvider` in App, not from the DOM, so the
 * menu aligns and its typeahead steps the way the rest of the window reads.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  id,
  className,
}: SelectProps<T>) {
  return (
    <RadixSelect.Root
      value={toItemValue(value)}
      onValueChange={(next) => onChange(fromItemValue(next) as T)}
    >
      <RadixSelect.Trigger
        id={id}
        className={cn(
          // The size of the controls it shares a row with, not of `TextInput`:
          // this sits beside a format group, and the row reads as one band only
          // while both halves are the same height.
          "group flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-3",
          "text-sm text-fg transition-colors duration-[--duration-fast]",
          "hover:border-line-strong focus:border-accent focus:outline-none",
          "data-[state=open]:border-accent",
          className,
        )}
      >
        {/* min-w-0 and truncate on the value alone: a long language name has to
            shorten rather than push the chevron off the end of the field. */}
        <span className="min-w-0 truncate">
          <RadixSelect.Value />
        </span>
        <RadixSelect.Icon asChild>
          <ChevronDown
            size={16}
            className="shrink-0 text-fg-muted transition-transform duration-[--duration-fast] group-data-[state=open]:rotate-180"
          />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          // popper, not the default item-aligned placement: with a hundred
          // entries the item-aligned mode tries to open the list centred on the
          // current one and ends up covering the field that opened it. popper
          // hangs it off the trigger and flips it when the window runs out.
          position="popper"
          sideOffset={4}
          className={cn(
            "z-50 overflow-hidden rounded-lg border border-line bg-surface shadow-(--shadow-panel)",
            // Matched to the trigger so the menu reads as the field opening
            // rather than as a panel arriving over it, and capped at whatever
            // room the window actually has left below it.
            "w-(--radix-select-trigger-width)",
            "max-h-(--radix-select-content-available-height)",
          )}
        >
          <RadixSelect.ScrollUpButton className="flex h-6 items-center justify-center bg-surface text-fg-muted">
            <ChevronUp size={14} />
          </RadixSelect.ScrollUpButton>

          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={toItemValue(option.value)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5",
                  "text-sm text-fg-soft outline-none select-none",
                  // Highlight follows the keyboard as well as the pointer --
                  // Radix sets it for both, which is the half a `:hover` rule
                  // would have missed.
                  "data-highlighted:bg-surface-hover data-highlighted:text-fg",
                  "data-[state=checked]:font-medium data-[state=checked]:text-accent",
                )}
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                {/* Last, and in a fixed-width box, so the labels stay flush on
                    the leading edge instead of the checked one sitting out of
                    line with the rest. */}
                <RadixSelect.ItemIndicator className="ms-auto shrink-0">
                  <Check size={14} />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>

          <RadixSelect.ScrollDownButton className="flex h-6 items-center justify-center bg-surface text-fg-muted">
            <ChevronDown size={14} />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

/**
 * Radix reserves the empty string: an item may not use it, because that is what
 * it clears a selection to.
 *
 * "No preference" is a real answer in this app rather than the absence of one --
 * auto-detect is what the transcriber does best -- and it is stored as `""`
 * because that is what the backend wants. So the two meet here: callers keep
 * passing `""` and reading `""` back, and only the markup in between sees the
 * placeholder. Keeping it in this file means no screen has to know the rule.
 */
const EMPTY = "__empty__";

const toItemValue = (value: string) => (value === "" ? EMPTY : value);
const fromItemValue = (value: string) => (value === EMPTY ? "" : value);
