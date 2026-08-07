/**
 * Whether the per-tool history panel is open, and which tool it is for.
 *
 * This is a provider rather than state inside `Shell` because starting a job
 * has to be able to open it. A tool used to hand the user off to Tasks the
 * moment it started something -- the form they were on disappeared, along with
 * the file they had loaded and the settings they had picked, to show a list
 * that also contained every other tool's work. Now the screen stays put and the
 * history beside it opens, which answers the same question ("did it start?")
 * without taking the form away.
 *
 * `openPanel` therefore has to be reachable from `useMediaJob` and the download
 * form, neither of which is a child of anything that could hold the state.
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

import { useNavigation } from "../../app/navigation";
import type { JobKind } from "./types";

/** The six screens that run jobs. `JobKind` and these route names are the
 *  same six strings by construction, so this Set is the entire mapping. */
const HISTORY_ROUTES = new Set<string>([
  "download",
  "compress",
  "trim",
  "convert",
  "gif",
  "transcribe",
]);

interface HistoryPanelValue {
  /** The tool whose history the panel would show, or null on a screen that has
   *  none -- Tasks, Settings and the transcript view. */
  kind: JobKind | null;
  open: boolean;
  /** Idempotent: called when a job starts, and a panel already open should stay
   *  as it is rather than flicker. */
  openPanel: () => void;
  close: () => void;
  toggle: () => void;
}

const HistoryPanelContext = createContext<HistoryPanelValue | null>(null);

export function HistoryPanelProvider({ children }: { children: ReactNode }) {
  const { route } = useNavigation();
  const [open, setOpen] = useState(false);

  const kind = HISTORY_ROUTES.has(route.name) ? (route.name as JobKind) : null;

  const openPanel = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);

  // Arriving at a fresh tool with a panel already open would be a surprise, and
  // the history shown would be for a different tool entirely.
  useEffect(() => setOpen(false), [route.name]);

  const value = useMemo(
    () => ({ kind, open, openPanel, close, toggle }),
    [kind, open, openPanel, close, toggle],
  );

  return (
    <HistoryPanelContext.Provider value={value}>
      {children}
    </HistoryPanelContext.Provider>
  );
}

export function useHistoryPanel() {
  const context = useContext(HistoryPanelContext);
  if (!context)
    throw new Error("useHistoryPanel must be used inside <HistoryPanelProvider>");
  return context;
}
