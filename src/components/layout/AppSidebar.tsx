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
import { APP_VERSION } from "../../lib/appVersion";
import { cn } from "../../lib/cn";
import { formatCount } from "../../lib/format";
import { isActiveJob } from "../../features/jobs/types";
import { useJobs } from "../../features/jobs/useJobs";
import { IconButton } from "../ui/Button";
import { navRow } from "../ui/navRow";
import { Tooltip } from "../ui/Tooltip";
import { AppIdentity } from "./AppIdentity";

export function AppSidebar({
  isRtl,
  collapsed,
  onToggle,
  onOpenSettings,
}: {
  isRtl: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { route, settingsOpen, closeSettings, go } = useNavigation();
  const { jobs } = useJobs();

  const running = jobs.filter(isActiveJob).length;

  const CollapseIcon = collapsed
    ? isRtl
      ? ChevronsLeft
      : ChevronsRight
    : isRtl
      ? ChevronsRight
      : ChevronsLeft;

  const navigate = (next: Route, isCurrent: boolean) => {
    if (settingsOpen) {
      closeSettings();
    }
    if (!isCurrent) go(next);
  };

  return (
    <nav
      aria-label={t("nav_sidebar")}
      className={cn(
        "glass-chrome flex shrink-0 flex-col gap-1 border-e p-2 pt-0",
        "transition-[width] duration-(--duration-fast)",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div
        data-tauri-drag-region
        className={cn(
          "drag-region flex h-11 shrink-0 items-center",
          collapsed ? "justify-center" : "gap-2 ps-1.5",
        )}
      >
        {!collapsed && <AppIdentity className="flex-1" />}

        <IconButton
          label={collapsed ? t("sidebar_expand") : t("sidebar_collapse")}
          tooltipSide="end"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="no-drag"
        >
          <CollapseIcon size={16} />
        </IconButton>
      </div>

      <div className="-mx-0.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-0.5 py-0.5">
        {TOOLS.map(({ route: target, key, icon }) => {
          const isCurrent = route.name === target.name;
          return (
            <NavItem
              key={key}
              icon={icon}
              label={t(`tool_${key}`)}
              collapsed={collapsed}
              active={!settingsOpen && isCurrent}
              onSelect={() => navigate(target, isCurrent)}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <NavItem
          icon={ListChecks}
          label={t("nav_jobs")}
          collapsed={collapsed}
          active={!settingsOpen && route.name === "jobs"}
          busy={running > 0}
          badge={running > 0 ? formatCount(running, i18n.language) : undefined}
          onSelect={() => navigate({ name: "jobs" }, route.name === "jobs")}
        />
        <NavItem
          icon={Settings}
          label={t("settings")}
          collapsed={collapsed}
          active={settingsOpen}
          onSelect={onOpenSettings}
        />
      </div>

      {APP_VERSION && (
        <p
          title={t("app_version", { version: APP_VERSION })}
          className={cn(
            "shrink-0 truncate pb-1 text-[11px] leading-4 text-fg-muted select-text",
            collapsed ? "text-center" : "ps-2.5 text-start",
          )}
        >
          <span dir="ltr" className="tnum">
            v{APP_VERSION}
          </span>
        </p>
      )}
    </nav>
  );
}

function NavItem({
  icon: Icon,
  label,
  collapsed,
  active,
  busy,
  badge,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  active: boolean;
  busy?: boolean;
  badge?: string;
  onSelect: () => void;
}) {
  const state = active ? "active" : busy ? "busy" : "idle";

  const button = (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={cn(
        navRow(state),
        "relative",
        collapsed && "justify-center px-0",
      )}
    >
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        <Icon size={17} />
        {collapsed && busy && (
          <span className="absolute -inset-e-0.5 -top-0.5 size-1.5 rounded-full bg-accent" />
        )}
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && badge && (
        <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent tnum">
          {badge}
        </span>
      )}
    </button>
  );

  return collapsed ? <Tooltip label={label}>{button}</Tooltip> : button;
}
