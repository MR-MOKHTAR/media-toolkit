/**
 * Navigation.
 *
 * A state machine, not a router. There are seven screens, no deep links, no
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

export type ToolName = "compress" | "trim" | "convert" | "resize" | "gif";

export type Route =
  | { name: "home" }
  | { name: "download" }
  | { name: "jobs" }
  | { name: "settings" }
  /** `file` is what lets a drop on the home screen open a tool with the file
   *  already loaded, instead of dropping the user on an empty form. */
  | { name: ToolName; file?: string };

interface NavigationValue {
  route: Route;
  /** Where you have been, newest last. This is history -- it drives `back`,
   *  not the breadcrumb, which renders the route's ancestors instead. */
  stack: Route[];
  go: (route: Route) => void;
  back: () => void;
  /** Back to the root, clearing the trail rather than pushing another home
   *  onto it. Home is the parent of every screen, so arriving there means the
   *  history that led away from it is spent. */
  goToRoot: () => void;
  canGoBack: boolean;
}

const NavigationContext = createContext<NavigationValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: "home" }]);
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

  const back = useCallback(() => {
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  const goToRoot = useCallback(() => {
    setStack([{ name: "home" }]);
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
    () => ({ route, stack, go, back, goToRoot, canGoBack: stack.length > 1 }),
    [route, stack, go, back, goToRoot],
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
