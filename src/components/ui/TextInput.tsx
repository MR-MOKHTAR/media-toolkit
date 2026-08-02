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
          "h-10 w-full rounded-md border border-line bg-surface px-3",
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
