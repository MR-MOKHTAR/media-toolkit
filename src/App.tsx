import { NavigationProvider, useNavigation } from "./app/navigation";
import { AppSidebar } from "./components/layout/AppSidebar";
import { AppTitleBar } from "./components/layout/AppTitleBar";
import { OfflineBanner } from "./components/feedback/OfflineBanner";
import { Toast } from "./components/feedback/Toast";
import { DownloadScreen } from "./features/downloads/DownloadScreen";
import { JobsScreen } from "./features/jobs/JobsScreen";
import {
  HistoryPanel,
  HistoryToggle,
} from "./features/jobs/components/HistoryPanel";
import {
  HistoryPanelProvider,
  useHistoryPanel,
} from "./features/jobs/useHistoryPanel";
import { JobsProvider } from "./features/jobs/useJobs";
import { CompressScreen } from "./features/media/screens/CompressScreen";
import { ConvertScreen } from "./features/media/screens/ConvertScreen";
import { GifScreen } from "./features/media/screens/GifScreen";
import { ResizeScreen } from "./features/media/screens/ResizeScreen";
import { TrimScreen } from "./features/media/screens/TrimScreen";
import { DragDropProvider } from "./features/media/useDragDrop";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { TranscribeScreen } from "./features/transcribe/TranscribeScreen";
import { TranscriptScreen } from "./features/transcribe/TranscriptScreen";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { useSidebarCollapsed } from "./hooks/useSidebarCollapsed";
import { useToast } from "./hooks/useToast";
import { useWindowControls } from "./hooks/useWindowControls";

function Shell({ toasts, notify, dismiss }: ReturnType<typeof useToast>) {
  const { route } = useNavigation();
  const { darkMode, toggleDarkMode, language, setLanguage } =
    useAppPreferences();
  const isOnline = useNetworkStatus();
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
  const isRtl = language === "fa" || language === "ar";
  // Read here rather than inside the sidebar, because the title bar needs the
  // same answer: it prints the app name only when the sidebar is too narrow to.
  const { collapsed, toggle: toggleSidebar } = useSidebarCollapsed();

  const {
    kind: historyKind,
    open: historyOpen,
    close: closeHistory,
    toggle: toggleHistory,
  } = useHistoryPanel();

  return (
    // One row for the whole window, sidebar first. It is the outermost element
    // rather than a row under the title bar, which is what gives the sidebar
    // the full window height: the title bar is now inside the column beside it
    // and starts where the sidebar ends. Having no `dir` of its own, the
    // sidebar still takes the leading edge in both writing directions.
    <div className="flex h-full overflow-hidden bg-canvas">
      <AppSidebar isRtl={isRtl} collapsed={collapsed} onToggle={toggleSidebar} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppTitleBar
          showTitle={collapsed}
          isMaximized={isMaximized}
          onMinimize={minimize}
          onToggleMaximize={toggleMaximize}
          onClose={close}
          // History sits with the window controls now instead of on a rail of
          // its own: it is one button per screen that has one, and the rail
          // spent 44px of every tool's width saying so.
          actions={
            historyKind && (
              <HistoryToggle
                kind={historyKind}
                open={historyOpen}
                onToggle={toggleHistory}
              />
            )
          }
        />

        <OfflineBanner isOnline={isOnline} />

        {/* `relative` belongs to this row, not the column: it is what the
            history panel's overlay mode positions against, and anchoring it
            here keeps the overlay off the title bar. */}
        <div className="relative flex min-h-0 flex-1">
          {/* The screens' scroll container. They size themselves inside it, so a
              document-level horizontal scrollbar cannot happen -- the old table had
              min-width: 785px inside an 800px window and scrolled at its own
              default size. */}
          <main className="min-h-0 flex-1 overflow-y-auto">
            {route.name === "download" && (
              <DownloadScreen isOnline={isOnline} notify={notify} />
            )}
            {route.name === "jobs" && <JobsScreen language={language} />}
            {route.name === "settings" && (
              <SettingsScreen
                darkMode={darkMode}
                onToggleTheme={toggleDarkMode}
                language={language}
                onLanguageChange={setLanguage}
                notify={notify}
              />
            )}
            {route.name === "compress" && (
              <CompressScreen
                initialFile={route.file}
                language={language}
                notify={notify}
              />
            )}
            {route.name === "trim" && (
              <TrimScreen initialFile={route.file} notify={notify} />
            )}
            {route.name === "convert" && (
              <ConvertScreen initialFile={route.file} notify={notify} />
            )}
            {route.name === "resize" && (
              <ResizeScreen initialFile={route.file} notify={notify} />
            )}
            {route.name === "gif" && (
              <GifScreen
                initialFile={route.file}
                language={language}
                notify={notify}
              />
            )}
            {route.name === "transcribe" && (
              <TranscribeScreen
                initialFile={route.file}
                language={language}
                // The only media tool that can fail for being offline, so it is
                // the only one that needs to know.
                isOnline={isOnline}
                notify={notify}
              />
            )}
            {route.name === "transcript" && (
              <TranscriptScreen
                // Keyed by job, so reopening a different transcript remounts
                // rather than showing the previous one's text while the new file
                // is still being read.
                key={route.jobId}
                jobId={route.jobId}
                language={language}
                notify={notify}
              />
            )}
          </main>

          {/* Last in the row, so docked at xl it takes the edge opposite the
              sidebar -- the same side it slides in from below that width. */}
          {historyKind && (
            <HistoryPanel
              kind={historyKind}
              open={historyOpen}
              onClose={closeHistory}
              isRtl={isRtl}
            />
          )}
        </div>
      </div>

      <Toast toasts={toasts} isRtl={isRtl} onDismiss={dismiss} />
    </div>
  );
}

export default function App() {
  // The toast lives above JobsProvider so job actions can report into it.
  // Reveal and open are fired from buttons on a job card, which has no screen
  // to hand an error to; when it was created inside Shell the provider sat
  // above it and every failure was swallowed.
  const toast = useToast();

  return (
    <JobsProvider notify={toast.notify}>
      <NavigationProvider>
        {/* Inside NavigationProvider: the panel belongs to whichever tool the
            route is on, and closes itself when that changes. Above the screens,
            because starting a job is what opens it. */}
        <HistoryPanelProvider>
          <DragDropProvider>
            <Shell {...toast} />
          </DragDropProvider>
        </HistoryPanelProvider>
      </NavigationProvider>
    </JobsProvider>
  );
}
