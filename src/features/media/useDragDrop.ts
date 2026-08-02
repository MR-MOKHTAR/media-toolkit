/**
 * Window-level file drops.
 *
 * IMPORTANT: Tauri v2 windows have `dragDropEnabled: true` by default, and
 * that setting BLOCKS HTML5 drag and drop inside the webview. React
 * `onDrop` / `onDragOver` handlers will silently never fire, no matter how
 * correct they look. The native `onDragDropEvent` below is the only thing
 * that works, and it is a window-level stream, not a per-element one -- which
 * is why the hook is mounted once in the shell and shares its state through
 * a context rather than being called per drop zone.
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

type DropHandler = (paths: string[]) => void;

interface DragDropValue {
  /** True while files are held over the window, for the drop-zone highlight. */
  isDragging: boolean;
  /** The most recent handler wins, so the visible screen receives the drop. */
  setHandler: (handler: DropHandler | null) => void;
}

const DragDropContext = createContext<DragDropValue | null>(null);

export function DragDropProvider({ children }: { children: ReactNode }) {
  const [isDragging, setIsDragging] = useState(false);
  const handlerRef = useRef<DropHandler | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        switch (event.payload.type) {
          case "over":
          case "enter":
            setIsDragging(true);
            break;
          case "drop":
            setIsDragging(false);
            handlerRef.current?.(event.payload.paths);
            break;
          default:
            setIsDragging(false);
        }
      })
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      // Not available outside a Tauri window (a plain browser during dev).
      // Click-to-browse still works, so this must not be fatal.
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const value = useMemo<DragDropValue>(
    () => ({
      isDragging,
      setHandler: (handler) => {
        handlerRef.current = handler;
      },
    }),
    [isDragging],
  );

  return createElement(DragDropContext.Provider, { value }, children);
}

/** Registers `onDrop` for as long as the calling screen is mounted. */
export function useFileDrop(onDrop: DropHandler) {
  const context = useContext(DragDropContext);
  const handlerRef = useRef(onDrop);
  handlerRef.current = onDrop;

  useEffect(() => {
    if (!context) return;
    const stable: DropHandler = (paths) => handlerRef.current(paths);
    context.setHandler(stable);
    return () => context.setHandler(null);
  }, [context]);

  return context?.isDragging ?? false;
}
