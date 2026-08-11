import { useId } from "react";
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import * as RadixSwitch from "@radix-ui/react-switch";
import { Check } from "lucide-react";

import { cn } from "../../lib/cn";

interface CheckRowProps {
  label: string;
  /** The line under the label. Every one of these needs saying plainly, so it
   *  is required rather than optional. */
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /**
   * `check` for a form input read when the run button is pressed; `switch` for
   * a setting that takes effect the moment it is moved.
   *
   * The distinction is the whole reason both exist: a switch says the change
   * has already happened, and using one for a field that will not be read until
   * later is a small lie about what just took place.
   */
  control?: "check" | "switch";
}

/**
 * A toggle with a label and a line of explanation, which is the only shape a
 * toggle takes in this app.
 *
 * There were three copies of this -- one in the storage settings, one on the
 * trim tool, one behind transcribe's advanced disclosure -- and the storage one
 * carried a comment saying a setting should look like a setting wherever it
 * appears. It did not: the three had drifted to different gaps and different
 * border colours, and each was a raw `<input type="checkbox">`, which can be
 * styled no further than its accent colour and cannot show a focus ring that
 * matches anything else here.
 *
 * The whole row is the hit target, including the hint. That comes from Radix
 * putting a real input in the tree for the `<label>` to point at, so it is the
 * platform's behavior rather than an onClick on a div.
 */
export function CheckRow({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
  control = "check",
}: CheckRowProps) {
  const id = useId();

  return (
    <div
      className={cn(
        "flex items-start gap-2.5",
        disabled && "opacity-70",
        // The switch's label sits opposite it, because a switch reads as the
        // state of the thing named to its left rather than as a marker before
        // it. `flex-row-reverse` and not `order`, so the DOM keeps control
        // first and the tab order stays put.
        control === "switch" && "flex-row-reverse",
      )}
    >
      {control === "switch" ? (
        <RadixSwitch.Root
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
          className={cn(
            // flex, not just relative: the knob is 16px inside an 18px track
            // interior, so it needs centring rather than sitting against the
            // top border.
            "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border border-line bg-surface-hover",
            "transition-colors duration-[--duration-fast]",
            "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
            "disabled:cursor-not-allowed",
          )}
        >
          {/* start-0.5 with a logical translate: under RTL the knob has to
              travel the other way, and `translate-x` would send it off the
              track. */}
          <RadixSwitch.Thumb
            className={cn(
              "block size-4 rounded-full bg-surface shadow",
              "transition-[margin] duration-[--duration-fast] ease-out-quart",
              "ms-0.5 data-[state=checked]:ms-4",
            )}
          />
        </RadixSwitch.Root>
      ) : (
        <RadixCheckbox.Root
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(state) => onChange(state === true)}
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-line-strong bg-surface",
            "transition-colors duration-[--duration-fast]",
            "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
            "disabled:cursor-not-allowed",
          )}
        >
          <RadixCheckbox.Indicator className="text-on-accent">
            <Check size={12} strokeWidth={3} />
          </RadixCheckbox.Indicator>
        </RadixCheckbox.Root>
      )}

      <label
        htmlFor={id}
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          disabled ? "cursor-default" : "cursor-pointer",
        )}
      >
        <span className="text-sm text-fg">{label}</span>
        <span className="text-xs text-fg-muted">{hint}</span>
      </label>
    </div>
  );
}
