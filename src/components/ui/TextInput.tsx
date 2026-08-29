import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/**
 * `dir="ltr"` is not a default here, but every caller that holds a URL, a
 * file path or a timecode passes it. Those are always read left to right,
 * even inside a Persian or Arabic interface, and mirroring them makes them
 * unreadable and impossible to edit.
 */
// `size` is omitted rather than widened: the DOM attribute of that name is a
// character count, which this app never sets and which would silently do
// nothing useful next to an explicit height.
interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /**
   * `sm` is for a field that sits *inside* another row rather than being the
   * row -- the compress form's target-size box, on a line with a checkbox and
   * a label. It exists so that case is a decision the system made once rather
   * than a `h-9 px-2.5` override written at one call site.
   */
  size?: "sm" | "md";
}

const SIZES = {
  sm: "h-9 px-2.5",
  // 44px. This was 36 on the theory that a field should not be as tall as the
  // button that submits it -- but the URL field is the first thing on the app's
  // first screen and the only place anything is typed, and at 36px with 14px
  // text it read as a search box bolted onto a form rather than as the form's
  // subject. 44 gives it the presence it earns and still sits a step below the
  // 48px run button.
  md: "h-11 px-3.5",
} as const;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ size = "md", className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-md border border-line bg-surface",
          SIZES[size],
          "text-base text-fg placeholder:text-fg-muted",
          "transition-[border-color,box-shadow] duration-(--duration-fast)",
          "hover:border-line-strong",
          "focus:border-accent focus:outline-none focus:shadow-(--shadow-focus)",
          "focus-visible:outline-none",
          // A disabled field had no treatment at all, so it looked identical
          // to one waiting to be typed in.
          "disabled:cursor-not-allowed disabled:bg-surface-soft disabled:opacity-disabled",
          className,
        )}
        {...props}
      />
    );
  },
);
