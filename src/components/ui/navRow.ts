import { cn } from "../../lib/cn";

/**
 * The look of a row in a rail.
 *
 * There are three rails in this app -- the app sidebar, the Tasks filter rail,
 * and the Settings tab column -- and they had three hand-written copies of one
 * recipe that had already drifted apart: 15px text in two of them and 14px in
 * the third, `px-2.5` in two and `px-3` in the third, and three slightly
 * different ways of saying "this is the one you are on". They sit within one
 * click of each other, so the drift was visible.
 *
 * Shared as a class recipe rather than as a component, because the three rows
 * are genuinely different controls underneath: one is a link with a collapsed
 * icon-only mode, one is a radio in a group, one is a tab with a roving
 * tabindex. Forcing them into one component would mean a prop for every one of
 * those differences. What they should share is how they *look*, and that is
 * exactly what this is.
 *
 * The accent bar's edge is deliberately not set here. It sits on the rail's own
 * outer edge, which is the leading edge for the sidebar (`border-s-2`) and the
 * trailing edge for the Tasks rail (`border-e-2`) -- and on the Settings rail
 * it only appears once that rail is a column at all. Each call site adds it.
 */
export const NAV_ROW_BASE = cn(
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-base text-start",
  "transition-all duration-(--duration-fast)",
);

export type NavRowState = "active" | "busy" | "idle";

export const NAV_ROW_STATE: Record<NavRowState, string> = {
  active: "bg-accent-soft font-medium text-accent shadow-(--shadow-glow)",
  /* Work is running somewhere else. Tinted but not filled, so it reads as
     "something is happening here" rather than as "you are here". */
  busy: "text-accent hover:bg-accent-soft",
  idle: "text-fg-soft hover:bg-surface-hover hover:text-fg",
};

/** The accent bar itself, transparent when the row is not the current one, so
 *  selecting a row moves nothing sideways. */
export const NAV_ROW_MARKER: Record<NavRowState, string> = {
  active: "border-accent",
  busy: "border-transparent",
  idle: "border-transparent",
};

export function navRow(state: NavRowState, className?: string) {
  return cn(NAV_ROW_BASE, NAV_ROW_STATE[state], className);
}
