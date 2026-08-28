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
  /**
   * Registers a handler and returns the function that removes it again.
   *
   * A stack, not a slot. The topmost handler receives the drop, so a form
   * opening over a list takes the drop from it and hands it back on close --
   * which is exactly the shape of a tool screen now, and is what a single slot
   * could not express: its cleanup cleared the slot unconditionally, so closing
   * the form removed the *list's* handler along with its own and dropping a
   * file on the screen quietly stopped working from then on.
   */
  register: (handler: DropHandler) => () => void;
}

const DragDropContext = createContext<DragDropValue | null>(null);

export function DragDropProvider({ children }: { children: ReactNode }) {
  const [isDragging, setIsDragging] = useState(false);
  const handlersRef = useRef<DropHandler[]>([]);

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
          case "drop": {
            setIsDragging(false);
            const handlers = handlersRef.current;
            handlers[handlers.length - 1]?.(event.payload.paths);
            break;
          }
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
      register: (handler) => {
        handlersRef.current.push(handler);
        return () => {
          // By identity, not by position: React does not promise that two
          // components unmount in the order they mounted.
          const index = handlersRef.current.indexOf(handler);
          if (index !== -1) handlersRef.current.splice(index, 1);
        };
      },
    }),
    [isDragging],
  );

  return createElement(DragDropContext.Provider, { value }, children);
}

/**
 * Registers `onDrop` for as long as the calling component is mounted and
 * `enabled`. The newest registration receives the drop.
 *
 * `enabled` is what keeps a tool screen and the form open over it from both
 * wanting the same drop, and it does it without depending on the order the two
 * register in -- which is not something a component may assume: React runs
 * effects child-first, so the form's registration lands *under* its own
 * screen's, and any re-run of both (the provider's value changes on every
 * drag) reshuffles them again. A screen that switches itself off while its form
 * is open leaves exactly one handler standing, whatever the order.
 */
export function useFileDrop(onDrop: DropHandler, enabled = true) {
  const context = useContext(DragDropContext);
  const handlerRef = useRef(onDrop);
  handlerRef.current = onDrop;

  useEffect(() => {
    if (!context || !enabled) return;
    // Registered once and read through the ref, so a handler that closes over
    // fresh state does not re-register on every render.
    return context.register((paths) => handlerRef.current(paths));
  }, [context, enabled]);

  return context?.isDragging ?? false;
}
