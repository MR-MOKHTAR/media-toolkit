import { DirectionProvider } from "@radix-ui/react-direction";
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";

import { NavigationProvider, useNavigation } from "./app/navigation";
import { AppSidebar } from "./components/layout/AppSidebar";
import { AppTitleBar } from "./components/layout/AppTitleBar";
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
import { TranscribeForm } from "./features/transcribe/TranscribeForm";
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

  return (
    // Radix positions its popovers and maps their arrow keys off this, not off
    // the DOM's `dir` -- so without it a select would open its menu and step
    // through its options left-to-right inside a right-to-left window. It wraps
    // everything because the primitives are spread across every screen.
    //
    // The tooltip provider sits here for the same reason: it is what makes the
    // sidebar's bubbles share one timer, so sweeping down the rail does not
    // re-wait the open delay at every icon.
    <DirectionProvider dir={isRtl ? "rtl" : "ltr"}>
      <TooltipProvider
        // The bubble a collapsed rail icon carries is the only label it has, so
        // it opens on arrival rather than making the user hold still for it --
        // which is what the hand-rolled version did.
        delayDuration={0}
        // The bubble is a label, not a surface: nothing in it is clickable, and
        // letting the pointer rest on it only keeps it up over the interface.
        disableHoverableContent
      >
        {/* One row for the whole window, sidebar first. It is the outermost
            element rather than a row under the title bar, which is what gives
            the sidebar the full window height: the title bar is now inside the
            column beside it and starts where the sidebar ends. Having no `dir`
            of its own, the sidebar still takes the leading edge in both writing
            directions. */}
        <div className="flex h-full overflow-hidden bg-canvas">
          <AppSidebar isRtl={isRtl} collapsed={collapsed} onToggle={toggleSidebar} />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AppTitleBar
              showTitle={collapsed}
              isMaximized={isMaximized}
              onMinimize={minimize}
              onToggleMaximize={toggleMaximize}
              onClose={close}
            />

            <OfflineBanner isOnline={isOnline} />

            {/* The screens' scroll container. They size themselves inside it,
                so a document-level horizontal scrollbar cannot happen -- the
                old table had min-width: 785px inside an 800px window and
                scrolled at its own default size.

                The tool screens scroll their own list instead, so that their
                toolbar stays put: `h-full` inside here is what lets them. */}
            <main className="min-h-0 flex-1 overflow-y-auto">
              {/* Five of the six tools follow one shape: the list is the screen
                  and the form is a dialog over it, mounted only while the route
                  says `composing`. What differs is which form. */}
              {route.name === "download" && (
                <ToolScreen route={route} language={language}>
                  {(close) => (
                    <DownloadForm
                      // Set only when the form recorded itself on the way to
                      // Settings, so coming back finds the link still there.
                      initialUrl={route.link}
                      isOnline={isOnline}
                      notify={notify}
                      onDone={close}
                    />
                  )}
                </ToolScreen>
              )}
              {route.name === "jobs" && <JobsScreen language={language} />}
              {route.name === "settings" && (
                <SettingsScreen
                  darkMode={darkMode}
                  onToggleTheme={toggleDarkMode}
                  language={language}
                  onLanguageChange={setLanguage}
                  notify={notify}
                  // Set when a tool form sent the user here to change one of
                  // its own defaults, so they land on that panel.
                  initialSection={route.section}
                />
              )}
              {/* Four tools, one form. The config is the only thing that
                  changes between them -- see features/media/tools. */}
              {isMediaToolRoute(route) && (
                <ToolScreen route={route} language={language}>
                  {(close) => (
                    <MediaToolForm
                      config={MEDIA_TOOLS[route.name]}
                      initialFile={route.file}
                      language={language}
                      notify={notify}
                      onDone={close}
                    />
                  )}
                </ToolScreen>
              )}
              {route.name === "transcribe" && (
                <ToolScreen route={route} language={language}>
                  {(close) => (
                    <TranscribeForm
                      initialFile={route.file}
                      // The only media tool that can fail for being offline, so
                      // it is the only one that needs to know.
                      isOnline={isOnline}
                      notify={notify}
                      onDone={close}
                    />
                  )}
                </ToolScreen>
              )}
              {route.name === "transcript" && (
                <TranscriptScreen
                  // Keyed by job, so reopening a different transcript
                  // remounts rather than showing the previous one's text
                  // while the new file is still being read.
                  key={route.jobId}
                  jobId={route.jobId}
                  language={language}
                  notify={notify}
                />
              )}
            </main>
          </div>

          <Toast toasts={toasts} isRtl={isRtl} onDismiss={dismiss} />
        </div>
      </TooltipProvider>
    </DirectionProvider>
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
