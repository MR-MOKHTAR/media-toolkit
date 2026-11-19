import { useEffect } from "react";
import { DirectionProvider } from "@radix-ui/react-direction";
import { MotionConfig, motion } from "framer-motion";
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";

import { NavigationProvider, useNavigation } from "./app/navigation";
import { AppBackground } from "./components/background/AppBackground";
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
  const { route } = useNavigation();
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
  // Read here rather than inside the sidebar, because the title bar needs the
  // same answer: it prints the app name only when the sidebar is too narrow to.
  const { collapsed, toggle: toggleSidebar } = useSidebarCollapsed();

  // The screen's tint on <html> as well as on the window below. Dialogs,
  // toasts and tooltips are portalled to the end of <body>, outside the
  // window's subtree, so a tint set only there would leave every dialog in
  // the default colours while the screen behind it wore its tool's.
  useEffect(() => {
    document.documentElement.dataset.tint = route.name;
  }, [route.name]);

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
        <div
          // `isolate` makes this the stacking context the background's
          // negative z-index stays inside: under the sidebar and the column,
          // above the document. `data-tint` leans the aurora towards the
          // screen's own hue (theme.css), and `aurora-host` fades between them.
          className="aurora-host relative isolate flex h-full overflow-hidden"
          data-tint={route.name}
        >
          <AppBackground effects={effects} />

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
              {/* All five tools are one ToolScreen at one position in the tree,
                  so moving between them keeps its toolbar mounted: the glass
                  bar stays exactly where it is and only what is inside it, and
                  the list under it, fades over (see ToolScreen). Two branches
                  -- Download and the media tools -- used to remount the whole
                  screen on the way across, and with the entrance animation on
                  top the toolbar visibly dropped and settled every time.

                  The list is the screen and the form is a dialog over it,
                  mounted only while the route says `composing`. What differs
                  between tools is which form. */}
              {(route.name === "download" || isMediaToolRoute(route)) && (
                <ToolScreen route={route} language={language}>
                  {(close) =>
                    route.name === "download" ? (
                      <DownloadForm
                        // Set only when the form recorded itself on the way to
                        // Settings, so coming back finds the link still there.
                        initialUrl={route.link}
                        isOnline={isOnline}
                        notify={notify}
                        onDone={close}
                      />
                    ) : (
                      // Four tools, one form. The config is the only thing
                      // that changes between them -- see features/media/tools.
                      <MediaToolForm
                        config={MEDIA_TOOLS[route.name]}
                        initialFile={route.file}
                        language={language}
                        notify={notify}
                        onDone={close}
                      />
                    )
                  }
                </ToolScreen>
              )}

              {/* The two screens that are not tools fade in -- opacity only.
                  A rise as well moved their glass rails along with them. */}
              {(route.name === "jobs" || route.name === "settings") && (
                <motion.div
                  key={route.name}
                  className="h-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  {route.name === "jobs" && <JobsScreen language={language} />}
                  {route.name === "settings" && (
                    <SettingsScreen
                      darkMode={darkMode}
                      onToggleTheme={toggleDarkMode}
                      language={language}
                      onLanguageChange={setLanguage}
                      effects={effects}
                      onEffectsChange={setEffects}
                      notify={notify}
                      // Set when a tool form sent the user here to change one
                      // of its own defaults, so they land on that panel.
                      initialSection={route.section}
                    />
                  )}
                </motion.div>
              )}
            </main>

            {/* Along the bottom of every screen; see the component for what
                goes in it. */}
            <StatusBar isOnline={isOnline} language={language} />
          </div>

          <Toast toasts={toasts} isRtl={isRtl} onDismiss={dismiss} onHold={hold} />

          {/* First launch only, and mounted here rather than on a screen: it is
              about the whole window -- its language and, for two of the three,
              its direction -- and it has to be the first thing shown whichever
              screen the app happens to open on. */}
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
  // The toast lives above JobsProvider so job actions can report into it.
  // Reveal and open are fired from buttons on a job card, which has no screen
  // to hand an error to; when it was created inside Shell the provider sat
  // above it and every failure was swallowed.
  const toast = useToast();

  return (
    // Honours the system's "reduce motion". The CSS animations already did,
    // through theme.css; the toasts, the job list and the offline banner are
    // animated by framer-motion and did not.
    <MotionConfig reducedMotion="user">
      <JobsProvider notify={toast.notify}>
        <NavigationProvider>
          <DragDropProvider>
            <Shell {...toast} />
          </DragDropProvider>
        </NavigationProvider>
      </JobsProvider>
    </MotionConfig>
  );
}
