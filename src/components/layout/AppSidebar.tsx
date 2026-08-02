import type { LucideIcon } from "lucide-react";
import { ChevronsLeft, ChevronsRight, ListChecks, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation, type Route } from "../../app/navigation";
import { TOOLS } from "../../app/tools";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import { isActiveJob } from "../../features/jobs/types";
import { useJobs } from "../../features/jobs/useJobs";
import { useSidebarCollapsed } from "../../hooks/useSidebarCollapsed";
import { Tooltip } from "../ui/Tooltip";

/**
 * Every screen, always reachable.
 *
 * This replaces a breadcrumb bar and a home screen that between them did one
 * job: get you to a tool. The breadcrumb spent 36px on every screen telling you
 * where you were, and the home screen was a grid of the same seven tools listed
 * here -- so switching from one tool to another meant going back to a menu
 * first. A sidebar says where you are by highlighting it and gets you anywhere
 * in one click, in the space the breadcrumb was already taking.
 *
 * No `dir` anywhere in here. The sidebar is the first child of a flex row, so
 * it lands on the leading edge -- left in English, right in Persian and Arabic
 * -- and `border-e`, `border-s-2` and `text-start` follow it across.
 */
export function AppSidebar({ isRtl }: { isRtl: boolean }) {
  const { t } = useTranslation();
  const { route, go } = useNavigation();
  const { jobs } = useJobs();
  const { collapsed, toggle } = useSidebarCollapsed();

  const running = jobs.filter(isActiveJob).length;

  // lucide ships no mirroring, so the direction the chevrons point has to be
  // picked: collapsing always moves the panel toward its own edge, which is the
  // left in English and the right in Persian and Arabic.
  const CollapseIcon = collapsed ? (isRtl ? ChevronsLeft : ChevronsRight) : isRtl ? ChevronsRight : ChevronsLeft;

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
        "flex shrink-0 flex-col gap-1 border-e border-line bg-surface-soft p-2",
        "transition-[width] duration-[--duration-fast]",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div className={cn("flex", collapsed ? "justify-center" : "justify-end")}>
        <Tooltip label={collapsed ? t("sidebar_expand") : t("sidebar_collapse")}>
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? t("sidebar_expand") : t("sidebar_collapse")}
            aria-expanded={!collapsed}
            className={cn(
              "flex size-8 items-center justify-center rounded-sm text-fg-muted",
              "transition-colors duration-[--duration-fast]",
              "hover:bg-surface-hover hover:text-fg",
            )}
          >
            <CollapseIcon size={16} />
          </button>
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
          button, and the one VS Code makes at the bottom of its activity bar. */}
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <NavItem
          icon={ListChecks}
          label={t("nav_jobs")}
          collapsed={collapsed}
          active={route.name === "jobs"}
          // The only place the app reports that work is happening once you have
          // left the screen that started it. No "0" on a fresh install: a count
          // of nothing is not information, and a zero badge reads as broken.
          count={jobs.length > 0 ? (running > 0 ? running : jobs.length) : undefined}
          busy={running > 0}
          onSelect={() => navigate({ name: "jobs" }, route.name === "jobs")}
        />
        <NavItem
          icon={Settings}
          label={t("settings")}
          collapsed={collapsed}
          active={route.name === "settings"}
          onSelect={() => navigate({ name: "settings" }, route.name === "settings")}
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
  count,
  busy,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  active: boolean;
  /** Undefined means no badge at all, which is not the same as zero. */
  count?: number;
  /** Tints the row while a job is running, wherever the user happens to be. */
  busy?: boolean;
  onSelect: () => void;
}) {
  const { i18n } = useTranslation();

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
        "flex w-full items-center gap-2.5 rounded-md border-s-2 py-2 text-base",
        "transition-colors duration-[--duration-fast]",
        collapsed ? "justify-center px-0" : "px-2.5 text-start",
        // Transparent rather than absent when inactive, so selecting a row
        // moves nothing sideways.
        active
          ? "border-accent bg-accent-soft font-medium text-accent"
          : busy
            ? "border-transparent text-accent hover:bg-accent-soft"
            : "border-transparent text-fg-soft hover:bg-surface-hover hover:text-fg",
      )}
    >
      <span className="relative flex shrink-0 items-center">
        <Icon size={17} />
        {/* Collapsed there is no room for a number, but "something is
            happening" is the part worth keeping. */}
        {collapsed && busy && (
          <span className="absolute -end-1 -top-0.5 size-1.5 rounded-full bg-accent" />
        )}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count !== undefined && (
            <span className="shrink-0 text-xs text-fg-muted tnum">
              {formatCount(count, i18n.language)}
            </span>
          )}
        </>
      )}
    </button>
  );

  // Only collapsed: expanded, the label is already on screen and a bubble
  // repeating it is noise.
  return collapsed ? <Tooltip label={label}>{button}</Tooltip> : button;
}
