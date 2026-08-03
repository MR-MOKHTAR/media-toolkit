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
          // 36px, not 40. A single-line field in a form card does not need to
          // be as tall as the button that submits it, and at 40px with 15px
          // text every form in the app read as an oversized dialog.
          "h-9 w-full rounded-md border border-line bg-surface px-3",
          "text-sm text-fg placeholder:text-fg-muted",
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
