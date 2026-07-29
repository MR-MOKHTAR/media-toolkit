import { useTranslation } from "react-i18next";

import { NavigationProvider, useNavigation } from "./app/navigation";
import { AppTitleBar } from "./components/layout/AppTitleBar";
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

function Shell() {
  const { t } = useTranslation();
  const { route } = useNavigation();
  const { darkMode, toggleDarkMode, language, setLanguage } = useAppPreferences();
  const isOnline = useNetworkStatus();
  const { toast, notify, dismiss } = useToast();
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
  const isRtl = language === "fa" || language === "ar";

  const titles: Record<string, string> = {
    home: t("app_name"),
    download: t("tool_download"),
    jobs: t("nav_jobs"),
    settings: t("settings"),
    compress: t("tool_compress"),
    trim: t("tool_trim"),
    convert: t("tool_convert"),
    resize: t("tool_resize"),
    gif: t("tool_gif"),
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      <AppTitleBar
        title={titles[route.name] ?? t("app_name")}
        isMaximized={isMaximized}
        isRtl={isRtl}
        onMinimize={minimize}
        onToggleMaximize={toggleMaximize}
        onClose={close}
      />

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
  return (
    <JobsProvider>
      <NavigationProvider>
        <DragDropProvider>
          <Shell />
        </DragDropProvider>
      </NavigationProvider>
    </JobsProvider>
  );
}
