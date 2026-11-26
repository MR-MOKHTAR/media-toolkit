import { useCallback, useEffect } from "react";
import { DirectionProvider } from "@radix-ui/react-direction";
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";

import { NavigationProvider, useNavigation } from "./app/navigation";
import { AppSidebar } from "./components/layout/AppSidebar";
import { AppTitleBar } from "./components/layout/AppTitleBar";
import { StatusBar } from "./components/layout/StatusBar";
import { OfflineBanner } from "./components/feedback/OfflineBanner";
import { Toast } from "./components/feedback/Toast";
import { DownloadForm } from "./features/downloads/DownloadForm";
import { JobsScreen } from "./features/jobs/JobsScreen";
import { JobsProvider } from "./features/jobs/useJobs";
import { MediaToolForm } from "./features/media/components/MediaToolForm";
import { isMediaToolRoute, MEDIA_TOOLS } from "./features/media/tools";
import { DragDropProvider } from "./features/media/useDragDrop";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { ToolScreen } from "./features/tools/ToolScreen";
import { WelcomeDialog } from "./features/welcome/WelcomeDialog";

import { useAppPreferences } from "./hooks/useAppPreferences";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { useSidebarCollapsed } from "./hooks/useSidebarCollapsed";
import { useToast } from "./hooks/useToast";
import { useWindowControls } from "./hooks/useWindowControls";

function Shell({ toasts, notify, dismiss, hold }: ReturnType<typeof useToast>) {
  const { route, settingsOpen, settingsSection, openSettings, closeSettings } = useNavigation();
  const {
    darkMode,
    toggleDarkMode,
    language,
    setLanguage,
    needsWelcome,
    completeWelcome,
    effects,
    setEffects,
  } = useAppPreferences();
  const isOnline = useNetworkStatus();
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
  const isRtl = language === "fa" || language === "ar";
  const { collapsed, toggle: toggleSidebar, collapse: collapseSidebar } = useSidebarCollapsed();

  // Whenever Settings opens (via sidebar or a deep link), auto-collapse the main sidebar.
  useEffect(() => {
    if (settingsOpen) {
      collapseSidebar();
    }
  }, [settingsOpen, collapseSidebar]);

  const handleOpenSettings = useCallback(() => {
    collapseSidebar();
    openSettings();
  }, [collapseSidebar, openSettings]);

  return (
    <DirectionProvider dir={isRtl ? "rtl" : "ltr"}>
      <TooltipProvider delayDuration={0} disableHoverableContent>
        <div className="relative flex h-full overflow-hidden bg-canvas">
          <AppSidebar
            isRtl={isRtl}
            collapsed={collapsed}
            onToggle={toggleSidebar}
            onOpenSettings={handleOpenSettings}
          />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AppTitleBar
              showTitle={collapsed}
              isMaximized={isMaximized}
              onMinimize={minimize}
              onToggleMaximize={toggleMaximize}
              onClose={close}
            />

            <OfflineBanner isOnline={isOnline} />

            <main className="min-h-0 flex-1 overflow-y-auto">
              {(route.name === "download" || isMediaToolRoute(route)) && (
                <ToolScreen route={route} language={language}>
                  {(closeModal) =>
                    route.name === "download" ? (
                      <DownloadForm
                        key={`download:${route.link ?? ""}`}
                        initialUrl={route.link}
                        isOnline={isOnline}
                        notify={notify}
                        onDone={closeModal}
                      />
                    ) : (
                      <MediaToolForm
                        key={`${route.name}:${route.file ?? ""}`}
                        config={MEDIA_TOOLS[route.name]}
                        initialFile={route.file}
                        language={language}
                        notify={notify}
                        onDone={closeModal}
                      />
                    )
                  }
                </ToolScreen>
              )}

              {route.name === "jobs" && <JobsScreen language={language} />}
            </main>

            <StatusBar isOnline={isOnline} language={language} />
          </div>

          <SettingsScreen
            open={settingsOpen}
            onClose={closeSettings}
            darkMode={darkMode}
            onToggleTheme={toggleDarkMode}
            language={language}
            onLanguageChange={setLanguage}
            effects={effects}
            onEffectsChange={setEffects}
            notify={notify}
            initialSection={settingsSection}
          />

          <Toast toasts={toasts} isRtl={isRtl} onDismiss={dismiss} onHold={hold} />

          {needsWelcome && (
            <WelcomeDialog
              language={language}
              onLanguageChange={setLanguage}
              onDone={completeWelcome}
            />
          )}
        </div>
      </TooltipProvider>
    </DirectionProvider>
  );
}

export default function App() {
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
