import { useCallback, useMemo, useState } from "react";
import { AppTitleBar } from "./components/layout/AppTitleBar";
import { DownloadSidebar } from "./components/layout/DownloadSidebar";
import { OfflineBanner } from "./components/feedback/OfflineBanner";
import { Toast } from "./components/feedback/Toast";
import {
  NewDownloadModal,
  type NewDownloadValues,
} from "./features/downloads/components/NewDownloadModal";
import { DownloadsPanel } from "./features/downloads/components/DownloadsPanel";
import { filterDownloads, getDownloadCounts } from "./features/downloads/selectors";
import type { DownloadFilter } from "./features/downloads/types";
import { useDownloadManager } from "./features/downloads/useDownloadManager";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { useToast } from "./hooks/useToast";
import { useWindowControls } from "./hooks/useWindowControls";

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filter, setFilter] = useState<DownloadFilter>("all");
  const [search, setSearch] = useState("");

  const {
    darkMode,
    toggleDarkMode,
    language,
    setLanguage,
  } = useAppPreferences();
  const isOnline = useNetworkStatus();
  const { toast, notify, dismiss } = useToast();
  const {
    isMaximized,
    minimize,
    toggleMaximize,
    close,
  } = useWindowControls();
  const {
    downloads,
    activeId,
    selectedId,
    isCancelling,
    isDownloading,
    savePath,
    ytdlpReady,
    selectFolder,
    revealDownload,
    startDownload,
    cancelDownload,
    removeDownload,
  } = useDownloadManager({ isOnline, notify });

  const counts = useMemo(() => getDownloadCounts(downloads), [downloads]);
  const visibleDownloads = useMemo(
    () => filterDownloads(downloads, filter, search, language),
    [downloads, filter, language, search],
  );

  const openNewDownload = useCallback(() => setIsModalOpen(true), []);
  const closeNewDownload = useCallback(() => setIsModalOpen(false), []);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => !current);
  }, []);
  const handleStartDownload = useCallback((
    values: NewDownloadValues,
    onSuccess: () => void,
  ) => startDownload({ ...values, savePath }, onSuccess), [savePath, startDownload]);

  return (
    <div className="app-shell">
      <AppTitleBar
        language={language}
        onLanguageChange={setLanguage}
        darkMode={darkMode}
        onToggleTheme={toggleDarkMode}
        isDownloading={isDownloading}
        isMaximized={isMaximized}
        onNewDownload={openNewDownload}
        onMinimize={minimize}
        onToggleMaximize={toggleMaximize}
        onClose={close}
      />

      <OfflineBanner isOnline={isOnline} />

      <div className="manager-layout">
        <DownloadSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebar}
          filter={filter}
          onFilterChange={setFilter}
          counts={counts}
          savePath={savePath}
        />
        <DownloadsPanel
          downloads={downloads}
          visibleDownloads={visibleDownloads}
          filter={filter}
          search={search}
          language={language}
          activeId={activeId}
          selectedId={selectedId}
          isCancelling={isCancelling}
          isDownloading={isDownloading}
          isOnline={isOnline}
          onSearchChange={setSearch}
          onOpenNewDownload={openNewDownload}
          onReveal={revealDownload}
          onCancel={cancelDownload}
          onRemove={removeDownload}
        />
      </div>

      <NewDownloadModal
        isOpen={isModalOpen}
        savePath={savePath}
        isDownloading={isDownloading}
        ytdlpReady={ytdlpReady}
        isOnline={isOnline}
        onSelectFolder={selectFolder}
        onStart={handleStartDownload}
        onClose={closeNewDownload}
      />

      <Toast toast={toast} language={language} onClose={dismiss} />
    </div>
  );
}

export default App;
