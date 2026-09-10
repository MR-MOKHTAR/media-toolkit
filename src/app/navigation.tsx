/**
 * Navigation.
 *
 * A state machine, not a router. There are seven screens -- five tools, the job
 * list and Settings -- no deep links, no address bar (the window is
 * undecorated), no SEO and a bundle small enough that code splitting would not
 * pay for itself. react-router would cost about 25 KB and a whole mental model
 * for none of what it is good at.
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
  | "extractAudio";

/** The panels in Settings. Named here rather than inside the screen because a
 *  route can point at one: the tool forms send you to the panel that holds the
 *  choice you were looking at, not to the top of Settings to find it yourself.
 *
 *  The order the rail lists them in is `SETTINGS_SECTIONS`, in
 *  features/settings/useSettingsSection -- a route is a name, not a position. */
export type SettingsSection =
  | "general"
  | "storage"
  | "downloads"
  | "tools";

/**
 * Whether the tool's form is open over its list.
 *
 * In the route rather than in the screen's own `useState`, and the reason is a
 * flow that already exists: the download form sends the user to Settings
 * mid-edit -- the quality hint links there -- and expects to be found as it was
 * left on the way back. Local state cannot survive that, because leaving
 * unmounts the screen. Recorded here, `replace` before the trip carries the open
 * form and its half-filled field across, and `back` restores both.
 *
 * It also means Escape closes the form and then, pressed again, leaves the
 * screen -- one key, two steps, in the order the user expects.
 */
interface Composing {
  /** True while the form dialog is open. */
  composing?: boolean;
}

/**
 * The five screens that are a tool: a list of what it has done, with its form
 * over the top when `composing`.
 *
 * Named as a type of its own because `ToolScreen` is written once for all five
 * and has to be able to say what it takes. `ToolRoute["name"]` is exactly
 * `JobKind` -- the same five strings -- which is what lets that screen read the
 * tool it is showing off the route rather than being told twice.
 */
export type ToolRoute =
  /** `link` is the half-filled field, kept across a trip to Settings and back:
   *  the quality row sends people there mid-paste, and coming back to an empty
   *  box is the price of a setting they went to look at. */
  | ({ name: "download"; link?: string } & Composing)
  /** `file` is what lets a drop on a tool's list open its form with the file
   *  already loaded, instead of dropping the user on an empty one. */
  | ({ name: ToolName; file?: string } & Composing);

export type Route =
  | ToolRoute
  | { name: "jobs" }
  | { name: "settings"; section?: SettingsSection };

interface NavigationValue {
  route: Route;
  /** Where you have been, newest last. Drives `back`. The sidebar shows where
   *  you *are*, which is a different question and answered by `route`. */
  stack: Route[];
  go: (route: Route) => void;
  /** Swaps the current entry without adding to history.
   *
   *  For a screen that wants what it is holding to survive being left and come
   *  back to: a tool form records the chosen file into its own route before
   *  leaving, so the entry `back` pops to already knows about it. Otherwise
   *  returning to a form always means an empty one. */
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
