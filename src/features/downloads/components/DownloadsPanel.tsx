import { useCallback, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { Download, Plus, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppLanguage } from "../../../hooks/useAppPreferences";
import type { DownloadFilter, DownloadItem } from "../types";
import { DownloadRow } from "./DownloadRow";

interface DownloadsPanelProps {
  downloads: DownloadItem[];
  visibleDownloads: DownloadItem[];
  filter: DownloadFilter;
  search: string;
  language: AppLanguage;
  activeIds: Set<string>;
  selectedId: string | null;
  cancellingIds: Set<string>;
  isDownloading: boolean;
  isOnline: boolean;
  onSearchChange: (value: string) => void;
  onOpenNewDownload: () => void;
  onReveal: (item: DownloadItem) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}

export function DownloadsPanel({
  downloads,
  visibleDownloads,
  filter,
  search,
  language,
  activeIds,
  selectedId,
  cancellingIds,
  isDownloading,
  isOnline,
  onSearchChange,
  onOpenNewDownload,
  onReveal,
  onCancel,
  onRemove,
}: DownloadsPanelProps) {
  const { t } = useTranslation();
  const selected = downloads.find((item) => item.id === selectedId);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(language, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    [language],
  );
  const formatDate = useCallback(
    (timestamp: number) => dateFormatter.format(timestamp),
    [dateFormatter],
  );

  return (
    <main className="downloads-panel">
      <div className="panel-header">
        <div><h2>{t(`filter_${filter}`)}</h2><p>{t("reveal_hint")}</p></div>
        <label className="search-box">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("search_placeholder")}
          />
          {search && (
            <button type="button" onClick={() => onSearchChange("")}><X size={15} /></button>
          )}
        </label>
      </div>

      <div className="downloads-table-wrap">
        <div className="downloads-table-header">
          <span>{t("file_column")}</span>
          <span>{t("status_column")}</span>
          <span>{t("size_column")}</span>
          <span>{t("speed_column")}</span>
          <span>{t("remaining_column")}</span>
          <span>{t("actions_column")}</span>
        </div>
        <div className="downloads-list">
          <AnimatePresence initial={false}>
            {visibleDownloads.map((item) => (
              <DownloadRow
                key={item.id}
                item={item}
                active={activeIds.has(item.id)}
                selected={selectedId === item.id}
                isCancelling={cancellingIds.has(item.id)}
                formatDate={formatDate}
                onReveal={onReveal}
                onCancel={onCancel}
                onRemove={onRemove}
              />
            ))}
          </AnimatePresence>

          {visibleDownloads.length === 0 && (
            <div className="empty-state">
              <span className="empty-illustration"><Download size={32} /></span>
              <h3>{t("no_downloads_title")}</h3>
              <p>{search ? t("no_search_results") : t("no_downloads_description")}</p>
              {!search && (
                <button
                  className="primary-button"
                  disabled={isDownloading}
                  onClick={onOpenNewDownload}
                >
                  <Plus size={18} />{t("new_download")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="statusbar">
        <span className={isOnline ? "connection-dot online" : "connection-dot"} />
        <span>{isOnline ? t("connection_online") : t("connection_offline")}</span>
        <span className="status-separator" />
        <span>{t("total_files", { count: downloads.length })}</span>
        <span className="statusbar-spacer" />
        <span>{selected ? selected.name : t("no_selected")}</span>
      </footer>
    </main>
  );
}
