import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/**
 * `TextInput`'s multi-line sibling: the same border, focus ring and disabled
 * treatment, for the one field that can hold a list -- the download form, when
 * more than one link is pasted into it.
 */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-y rounded-md border border-line bg-surface px-3.5 py-2.5",
        "text-sm leading-6 text-fg placeholder:text-fg-muted",
        "transition-[border-color,box-shadow] duration-(--duration-fast)",
        "hover:border-line-strong",
        "focus:border-accent focus:outline-none focus:shadow-(--shadow-focus)",
        "focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:bg-surface-soft disabled:opacity-disabled",
        className,
      )}
      {...props}
    />
  );
});
