import type { LucideIcon } from "lucide-react";
import {
  ChevronsLeft,
  ChevronsRight,
  ListChecks,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation, type Route } from "../../app/navigation";
import { TOOLS } from "../../app/tools";
import { cn } from "../../lib/cn";
import { isActiveJob } from "../../features/jobs/types";
import { useJobs } from "../../features/jobs/useJobs";
import { IconButton } from "../ui/Button";
import { NAV_ROW_MARKER, navRow } from "../ui/navRow";
import { Tooltip } from "../ui/Tooltip";
import { AppIdentity } from "./AppIdentity";

/**
 * Every screen, always reachable.
 *
 * This replaces a breadcrumb bar and a home screen that between them did one
 * job: get you to a tool. The breadcrumb spent 36px on every screen telling you
 * where you were, and the home screen was a grid of the same tools listed
 * here -- so switching from one tool to another meant going back to a menu
 * first. A sidebar says where you are by highlighting it and gets you anywhere
 * in one click, in the space the breadcrumb was already taking.
 *
 * No `dir` anywhere in here. The sidebar is the first child of a flex row, so
 * it lands on the leading edge -- left in English, right in Persian and Arabic
 * -- and `border-e`, `border-s-2` and `text-start` follow it across.
 */
export function AppSidebar({
  isRtl,
  collapsed,
  onToggle,
}: {
  isRtl: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { route, go } = useNavigation();
  const { jobs } = useJobs();

  const running = jobs.filter(isActiveJob).length;

  // lucide ships no mirroring, so the direction the chevrons point has to be
  // picked: collapsing always moves the panel toward its own edge, which is the
  // left in English and the right in Persian and Arabic.
  const CollapseIcon = collapsed
    ? isRtl
      ? ChevronsLeft
      : ChevronsRight
    : isRtl
      ? ChevronsRight
      : ChevronsLeft;

  const navigate = (next: Route, active: boolean) => {
    // Re-entering the screen you are on replaces the top of the stack, which
    // for a tool means handing it `file: undefined` and dropping the file it
    // had loaded. Clicking the highlighted item should do nothing at all.
    if (!active) go(next);
  };

  return (
    <nav
      aria-label={t("nav_sidebar")}
      className={cn(
        "flex shrink-0 flex-col gap-1 border-e border-line bg-surface-soft p-2 pt-0",
        "transition-[width] duration-(--duration-fast)",
        collapsed ? "w-14" : "w-60",
      )}
    >
      {/* h-11 with no top padding: the sidebar now runs the full window height,
          so this row sits alongside the title bar and matching its height is
          what lines the collapse button up with the window buttons and puts the
          rows below it level with the title bar's bottom rule.

          Expanded, it carries the app's name and icon. That is not decoration
          to fill a gap: the row is 240px wide and level with the title bar, so
          leaving it to one chevron read as a mistake, and the name has to be
          somewhere. It moved here rather than being repeated -- the title bar
          shows it only while this sidebar is collapsed and has no room for it.

          Draggable, like the title bar it sits beside: a window with no chrome
          should move from anywhere along its top edge. The button inside opts
          back out with `no-drag`, and the icon takes no pointer events at all
          so the drag region under it stays the event target. */}
      <div
        data-tauri-drag-region
        className={cn(
          "drag-region flex h-11 shrink-0 items-center",
          collapsed ? "justify-center" : "gap-2 ps-1.5",
        )}
      >
        {!collapsed && <AppIdentity className="flex-1" />}

        <Tooltip
          label={collapsed ? t("sidebar_expand") : t("sidebar_collapse")}
        >
          <IconButton
            label={collapsed ? t("sidebar_expand") : t("sidebar_collapse")}
            onClick={onToggle}
            aria-expanded={!collapsed}
            className="no-drag"
          >
            <CollapseIcon size={16} />
          </IconButton>
        </Tooltip>
      </div>

      {/* Scrolls rather than pushing the bottom group off: nine rows plus the
          toggle just fit the 500px minimum window height, and nothing here
          should depend on that staying true. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {TOOLS.map(({ route: target, key, icon }) => (
          <NavItem
            key={key}
            icon={icon}
            label={t(`tool_${key}`)}
            collapsed={collapsed}
            active={route.name === target.name}
            onSelect={() => navigate(target, route.name === target.name)}
          />
        ))}
      </div>

      {/* Tasks and Settings are not tools, so they sit apart from them --
          the same split the Tasks screen's own rail makes with its clear
          button, and the one VS Code makes at the bottom of its activity bar.

          A plain rule. This was an inline `border-image` gradient fading
          `to right` -- a physical direction, so the fade ran backwards in
          Persian and Arabic, in the one file whose header insists that
          everything in it be logical. */}
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <NavItem
          icon={ListChecks}
          label={t("nav_jobs")}
          collapsed={collapsed}
          active={route.name === "jobs"}
          // The only place the app reports that work is happening once you have
          // left the screen that started it -- and it reports it as a state, not
          // a number. A tally beside the row counted finished jobs too, so it
          // sat there reading "12" for days after anything was actually running.
          busy={running > 0}
          onSelect={() => navigate({ name: "jobs" }, route.name === "jobs")}
        />
        <NavItem
          icon={Settings}
          label={t("settings")}
          collapsed={collapsed}
          active={route.name === "settings"}
          onSelect={() =>
            navigate({ name: "settings" }, route.name === "settings")
          }
        />
      </div>
    </nav>
  );
}

function NavItem({
  icon: Icon,
  label,
  collapsed,
  active,
  busy,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  active: boolean;
  /** Tints the row while a job is running, wherever the user happens to be. */
  busy?: boolean;
  onSelect: () => void;
}) {
  const state = active ? "active" : busy ? "busy" : "idle";

  const button = (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      // The label is the accessible name in both states; collapsed there is no
      // text to read. No `title` beside it, or the OS tooltip draws on top of
      // the styled one.
      aria-label={label}
      className={cn(
        navRow(state),
        // The bar sits on the sidebar's own leading edge, which is the window
        // edge it is docked against.
        "border-s-2",
        NAV_ROW_MARKER[state],
        collapsed && "justify-center px-0",
        state === "idle" &&
          !collapsed &&
          "hover:translate-x-0.5 rtl:hover:-translate-x-0.5",
      )}
    >
      <span className="relative flex shrink-0 items-center">
        <Icon size={17} />
        {/* Collapsed there is no room for a number, but "something is
            happening" is the part worth keeping. */}
        {collapsed && busy && (
          <span className="absolute -inset-e-1 -top-0.5 size-1.5 rounded-full bg-accent" />
        )}
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
    </button>
  );

  // Only collapsed: expanded, the label is already on screen and a bubble
  // repeating it is noise.
  return collapsed ? <Tooltip label={label}>{button}</Tooltip> : button;
}
