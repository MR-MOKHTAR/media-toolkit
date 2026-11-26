import { cn } from "../../lib/cn";

/**
 * Shared row styling for the app sidebar, the Tasks filter rail,
 * and the Settings tab column.
 */
export const NAV_ROW_BASE = cn(
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-start",
  "transition-colors duration-(--duration-fast)",
  "focus:outline-none focus-visible:ring-1 focus-visible:ring-line-strong",
);

export type NavRowState = "active" | "busy" | "idle";

export const NAV_ROW_STATE: Record<NavRowState, string> = {
  active: "bg-accent-soft font-medium text-accent",
  busy: "text-accent hover:bg-accent-soft",
  idle: "text-fg-soft hover:bg-surface-hover hover:text-fg",
};

export function navRow(state: NavRowState, className?: string) {
  return cn(NAV_ROW_BASE, NAV_ROW_STATE[state], className);
}
