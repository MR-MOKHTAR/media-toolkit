import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToolName =
  | "compress"
  | "trim"
  | "convert"
  | "extractAudio";

export type SettingsSection =
  | "general"
  | "storage"
  | "downloads"
  | "network"
  | "tools";

interface Composing {
  composing?: boolean;
}

export type ToolRoute =
  | ({ name: "download"; link?: string } & Composing)
  | ({ name: ToolName; file?: string } & Composing);

export type Route =
  | ToolRoute
  | { name: "jobs" }
  | { name: "settings"; section?: SettingsSection };

interface NavigationValue {
  route: Route;
  stack: Route[];
  settingsOpen: boolean;
  settingsSection?: SettingsSection;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  go: (route: Route) => void;
  replace: (route: Route) => void;
  back: () => void;
}

const NavigationContext = createContext<NavigationValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: "download" }]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);

  const route = stack[stack.length - 1];
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const openSettings = useCallback((section?: SettingsSection) => {
    if (section) setSettingsSection(section);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const go = useCallback((next: Route) => {
    if (next.name === "settings") {
      if (next.section) setSettingsSection(next.section);
      setSettingsOpen(true);
      return;
    }
    setSettingsOpen(false);
    setStack((current) => {
      const top = current[current.length - 1];
      if (top.name === next.name) return [...current.slice(0, -1), next];
      return [...current, next];
    });
  }, []);

  const replace = useCallback((next: Route) => {
    if (next.name === "settings") {
      if (next.section) setSettingsSection(next.section);
      setSettingsOpen(true);
      return;
    }
    setStack((current) => [...current.slice(0, -1), next]);
  }, []);

  const back = useCallback(() => {
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (typing) return;
      if (target?.closest("[role=dialog], [role=alertdialog]")) return;
      if (event.key === "Escape") {
        const top = stackRef.current[stackRef.current.length - 1];
        if ("composing" in top && top.composing) {
          setStack((current) => [
            ...current.slice(0, -1),
            { name: top.name, composing: false } as Route,
          ]);
          return;
        }
        back();
      }
      if (event.key === "ArrowLeft" && event.altKey) back();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [back]);

  const value = useMemo(
    () => ({
      route,
      stack,
      settingsOpen,
      settingsSection,
      openSettings,
      closeSettings,
      go,
      replace,
      back,
    }),
    [route, stack, settingsOpen, settingsSection, openSettings, closeSettings, go, replace, back],
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) throw new Error("useNavigation must be used inside <NavigationProvider>");
  return context;
}
