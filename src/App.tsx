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
import {
  activeJobIds,
  jobsToDownloadItems,
} from "./features/downloads/legacyAdapter";
import { filterDownloads, getDownloadCounts } from "./features/downloads/selectors";
import type { DownloadFilter } from "./features/downloads/types";
import { useDownloadForm } from "./features/downloads/useDownloadForm";
import { JobsProvider, useJobs } from "./features/jobs/useJobs";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { useToast } from "./hooks/useToast";
import { useWindowControls } from "./hooks/useWindowControls";

function Manager() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filter, setFilter] = useState<DownloadFilter>("all");
  const [search, setSearch] = useState("");

  const { darkMode, toggleDarkMode, language, setLanguage } = useAppPreferences();
  const isOnline = useNetworkStatus();
  const { toast, notify, dismiss } = useToast();
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();

  const { jobs, state, cancel, remove, reveal } = useJobs();
  const { savePath, toolsReady, selectFolder, start } = useDownloadForm({
    isOnline,
    notify,
  });

  // The old table speaks DownloadItem. The adapter and this whole screen go
  // away in phase 5, when job cards replace the seven-column grid.
  const downloads = useMemo(() => jobsToDownloadItems(jobs), [jobs]);
  const activeIds = useMemo(() => activeJobIds(jobs), [jobs]);
  const cancellingIds = useMemo(
    () => new Set(state.cancelling),
    [state.cancelling],
  );
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

  const handleStart = useCallback(
    (values: NewDownloadValues, onSuccess: () => void) =>
      start(
        {
          url: values.url,
          filename: values.filename,
          mediaType: values.downloadType,
          quality: values.quality,
        },
        onSuccess,
      ),
    [start],
  );

  const handleReveal = useCallback(
    (item: { filePath?: string }) => {
      if (item.filePath) void reveal(item.filePath);
    },
    [reveal],
  );

  return (
    <div className="app-shell">
      <AppTitleBar
        language={language}
        onLanguageChange={setLanguage}
        darkMode={darkMode}
        onToggleTheme={toggleDarkMode}
        isDownloading={false}
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
          activeIds={activeIds}
          selectedId={state.selectedId}
          cancellingIds={cancellingIds}
          isDownloading={activeIds.size > 0}
          isOnline={isOnline}
          onSearchChange={setSearch}
          onOpenNewDownload={openNewDownload}
          onReveal={handleReveal}
          onCancel={(id) => void cancel(id)}
          onRemove={remove}
        />
      </div>

      <NewDownloadModal
        isOpen={isModalOpen}
        savePath={savePath}
        isDownloading={false}
        ytdlpReady={toolsReady}
        isOnline={isOnline}
        onSelectFolder={selectFolder}
        onStart={handleStart}
        onClose={closeNewDownload}
      />

      <Toast toast={toast} language={language} onClose={dismiss} />
    </div>
  );
}

export default function App() {
  return (
    <JobsProvider>
      <Manager />
    </JobsProvider>
  );
}
