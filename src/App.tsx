import { NavigationProvider, useNavigation } from "./app/navigation";
import { AppTitleBar } from "./components/layout/AppTitleBar";
import { BreadcrumbBar } from "./components/layout/BreadcrumbBar";
import { OfflineBanner } from "./components/feedback/OfflineBanner";
import { Toast } from "./components/feedback/Toast";
import { DownloadScreen } from "./features/downloads/DownloadScreen";
import { HomeScreen } from "./features/home/HomeScreen";
import { JobsScreen } from "./features/jobs/JobsScreen";
import { JobsProvider } from "./features/jobs/useJobs";
import { CompressScreen } from "./features/media/screens/CompressScreen";
import { ConvertScreen } from "./features/media/screens/ConvertScreen";
import { GifScreen } from "./features/media/screens/GifScreen";
import { ResizeScreen } from "./features/media/screens/ResizeScreen";
import { TrimScreen } from "./features/media/screens/TrimScreen";
import { DragDropProvider } from "./features/media/useDragDrop";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { useToast } from "./hooks/useToast";
import { useWindowControls } from "./hooks/useWindowControls";

function Shell({ toast, notify, dismiss }: ReturnType<typeof useToast>) {
  const { route } = useNavigation();
  const { darkMode, toggleDarkMode, language, setLanguage } = useAppPreferences();
  const isOnline = useNetworkStatus();
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
  const isRtl = language === "fa" || language === "ar";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      <AppTitleBar
        isMaximized={isMaximized}
        onMinimize={minimize}
        onToggleMaximize={toggleMaximize}
        onClose={close}
      />

      <BreadcrumbBar isRtl={isRtl} />

      <OfflineBanner isOnline={isOnline} />

      {/* The only scroll container in the app. Screens size themselves inside
          it, so a document-level horizontal scrollbar cannot happen -- the old
          table had min-width: 785px inside an 800px window and scrolled at its
          own default size. */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {route.name === "home" && <HomeScreen language={language} />}
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
      </main>

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
