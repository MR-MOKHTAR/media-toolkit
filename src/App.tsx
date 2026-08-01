import { useCallback, useEffect, useState } from "react";

import { NavigationProvider, useNavigation } from "./app/navigation";
import { AppTitleBar } from "./components/layout/AppTitleBar";
import { BreadcrumbBar } from "./components/layout/BreadcrumbBar";
import { OfflineBanner } from "./components/feedback/OfflineBanner";
import { Toast } from "./components/feedback/Toast";
import { DownloadScreen } from "./features/downloads/DownloadScreen";
import { HomeScreen } from "./features/home/HomeScreen";
import { JobsScreen } from "./features/jobs/JobsScreen";
import { HistoryPanel, HistoryToggle } from "./features/jobs/components/HistoryPanel";
import { TasksButton } from "./features/jobs/components/TasksButton";
import type { JobKind } from "./features/jobs/types";
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
import { useToast } from "./hooks/useToast";
import { useWindowControls } from "./hooks/useWindowControls";

/** The seven screens that run jobs. `JobKind` and these route names are the
 *  same seven strings by construction, so this Set is the entire mapping. */
const HISTORY_ROUTES = new Set<string>([
  "download",
  "compress",
  "trim",
  "convert",
  "resize",
  "gif",
  "transcribe",
]);

function Shell({ toast, notify, dismiss }: ReturnType<typeof useToast>) {
  const { route, go } = useNavigation();
  const { darkMode, toggleDarkMode, language, setLanguage } = useAppPreferences();
  const isOnline = useNetworkStatus();
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
  const isRtl = language === "fa" || language === "ar";

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyKind = HISTORY_ROUTES.has(route.name) ? (route.name as JobKind) : null;
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  // Arriving at a fresh tool with a panel already open would be a surprise, and
  // the history shown would be for a different tool entirely.
  useEffect(() => setHistoryOpen(false), [route.name]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      <AppTitleBar
        isMaximized={isMaximized}
        onMinimize={minimize}
        onToggleMaximize={toggleMaximize}
        onClose={close}
      />

      <BreadcrumbBar
        isRtl={isRtl}
        trailing={
          <div className="flex items-center gap-1">
            {/* Tasks first, then the tool's own history: the global
                destination anchors the group, and the screen-specific one
                comes and goes beside it without moving it. Not shown on Tasks
                itself, where it would link to the page you are on. */}
            {route.name !== "jobs" && (
              <TasksButton onOpen={() => go({ name: "jobs" })} />
            )}
            {historyKind && (
              <HistoryToggle
                kind={historyKind}
                open={historyOpen}
                onToggle={() => setHistoryOpen((current) => !current)}
              />
            )}
          </div>
        }
      />

      <OfflineBanner isOnline={isOnline} />

      {/* A row, so the history panel can dock beside the screen rather than
          extend it. `relative` is what the panel's overlay mode positions
          against, which keeps it below the title bar and breadcrumb instead of
          covering the window chrome. */}
      <div className="relative flex min-h-0 flex-1">
        {/* The screens' scroll container. They size themselves inside it, so a
            document-level horizontal scrollbar cannot happen -- the old table had
            min-width: 785px inside an 800px window and scrolled at its own
            default size. */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {route.name === "home" && <HomeScreen />}
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
            <CompressScreen initialFile={route.file} language={language} notify={notify} />
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
            <GifScreen initialFile={route.file} language={language} notify={notify} />
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

        {historyKind && (
          <HistoryPanel
            kind={historyKind}
            open={historyOpen}
            onClose={closeHistory}
            isRtl={isRtl}
          />
        )}
      </div>

      <Toast toast={toast} isRtl={isRtl} onClose={dismiss} />
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
        <DragDropProvider>
          <Shell {...toast} />
        </DragDropProvider>
      </NavigationProvider>
    </JobsProvider>
  );
}
