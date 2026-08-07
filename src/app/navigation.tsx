/**
 * Navigation.
 *
 * A state machine, not a router. There are six screens, no deep links, no
 * address bar (the window is undecorated), no SEO and a bundle small enough
 * that code splitting would not pay for itself. react-router would cost about
 * 25 KB and a whole mental model for none of what it is good at.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ToolName =
  | "compress"
  | "trim"
  | "convert"
  | "gif"
  | "transcribe";

export type Route =
  | { name: "download" }
  | { name: "jobs" }
  | { name: "settings" }
  /** One finished or running transcription. The only screen that is about a
   *  single job rather than about a tool, which is why it carries an id: it is
   *  reached both by starting a transcription and by reopening one from the
   *  job list days later. */
  | { name: "transcript"; jobId: string }
  /** `file` is what lets a drop on the home screen open a tool with the file
   *  already loaded, instead of dropping the user on an empty form. */
  | { name: ToolName; file?: string };

interface NavigationValue {
  route: Route;
  /** Where you have been, newest last. Drives `back`. The sidebar shows where
   *  you *are*, which is a different question and answered by `route`. */
  stack: Route[];
  go: (route: Route) => void;
  /** Swaps the current entry without adding to history.
   *
   *  For a screen that wants what it is holding to survive being left and come
   *  back to: the transcribe form records the chosen file into its own route
   *  before pushing the result screen, so the entry `back` pops to already
   *  knows about it. Otherwise returning to a form always means an empty one. */
  replace: (route: Route) => void;
  back: () => void;
}

const NavigationContext = createContext<NavigationValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  // Download, not a landing screen. Every tool is one click away in the
  // sidebar, so a screen whose only content was a list of those same tools was
  // a stop on the way to the thing people opened the app to do.
  const [stack, setStack] = useState<Route[]>([{ name: "download" }]);
  const route = stack[stack.length - 1];

  const go = useCallback((next: Route) => {
    setStack((current) => {
      const top = current[current.length - 1];
      // Re-entering the screen you are on replaces rather than stacks, so
      // dropping a second file into a tool does not need two Escapes to leave.
      if (top.name === next.name) return [...current.slice(0, -1), next];
      return [...current, next];
    });
  }, []);

  const replace = useCallback((next: Route) => {
    setStack((current) => [...current.slice(0, -1), next]);
  }, []);

  const back = useCallback(() => {
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  // Escape and Alt+Left go back, which is what people try first in a window
  // with no browser chrome. Ignored while typing, or Escape would throw away
  // a half-filled form.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (event.key === "Escape" && !typing) back();
      if (event.key === "ArrowLeft" && event.altKey) back();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [back]);

  const value = useMemo(
    () => ({ route, stack, go, replace, back }),
    [route, stack, go, replace, back],
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
