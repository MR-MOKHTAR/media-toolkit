import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/**
 * `dir="ltr"` is not a default here, but every caller that holds a URL, a
 * file path or a timecode passes it. Those are always read left to right,
 * even inside a Persian or Arabic interface, and mirroring them makes them
 * unreadable and impossible to edit.
 */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          // 44px. This was 36 on the theory that a field should not be as tall
          // as the button that submits it -- but the URL field is the first
          // thing on the app's first screen and the only place anything is
          // typed, and at 36px with 14px text it read as a search box bolted
          // onto a form rather than as the form's subject. 44 gives it the
          // presence it earns and still sits a step below the 48px run button.
          "h-11 w-full rounded-md border border-line bg-surface px-3.5",
          "text-base text-fg placeholder:text-fg-muted",
          "transition-colors duration-[--duration-fast]",
          "hover:border-line-strong focus:border-accent focus:outline-none",
          "focus-visible:outline-none",
          className,
        )}
        {...props}
      />
    );
  },
);
