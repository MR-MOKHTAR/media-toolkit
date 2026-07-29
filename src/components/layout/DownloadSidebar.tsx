import {
  CheckCircle2,
  Download,
  Folder,
  Gauge,
  HardDriveDownload,
  ListFilter,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DownloadCounts, DownloadFilter } from "../../features/downloads/types";

interface DownloadSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  filter: DownloadFilter;
  onFilterChange: (filter: DownloadFilter) => void;
  counts: DownloadCounts;
  savePath: string;
}

export function DownloadSidebar({
  collapsed,
  onToggleCollapsed,
  filter,
  onFilterChange,
  counts,
  savePath,
}: DownloadSidebarProps) {
  const { t } = useTranslation();
  const filters: { id: DownloadFilter; icon: typeof Download; count: number }[] = [
    { id: "all", icon: HardDriveDownload, count: counts.all },
    { id: "active", icon: Gauge, count: counts.active },
    { id: "completed", icon: CheckCircle2, count: counts.completed },
    { id: "video", icon: Video, count: counts.video },
    { id: "audio", icon: Music2, count: counts.audio },
  ];

  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
      <div className="sidebar-heading">
        <div className="sidebar-label"><ListFilter size={15} /><span>{t("categories")}</span></div>
        <button
          className="sidebar-toggle"
          onClick={onToggleCollapsed}
          title={collapsed ? t("expand_sidebar") : t("collapse_sidebar")}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
      <nav className="filter-list">
        {filters.map(({ id, icon: Icon, count }) => (
          <button className={filter === id ? "filter-button active" : "filter-button"} key={id} onClick={() => onFilterChange(id)}>
            <Icon size={17} /><span>{t(`filter_${id}`)}</span><b>{count}</b>
          </button>
        ))}
      </nav>
      <div className="storage-card">
        <span className="storage-icon"><Folder size={18} /></span>
        <div><strong>{t("download_folder")}</strong><span title={savePath}>{savePath || "—"}</span></div>
      </div>
    </aside>
  );
}

export default DownloadSidebar;
