import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useDirection } from "@radix-ui/react-direction";

import { cn } from "../../lib/cn";
import { Tooltip, type TooltipSide } from "./Tooltip";

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

interface ActionMenuProps {
  label: string;
  items: ActionMenuItem[];
  icon: ReactNode;
  tooltipSide?: TooltipSide;
  className?: string;
}

const GAP = 6;
const VIEWPORT_PADDING = 8;

export function ActionMenu({
  label,
  items,
  icon,
  tooltipSide = "bottom",
  className,
}: ActionMenuProps) {
  const dir = useDirection();
  const isRtl = dir === "rtl";
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    // Align trailing edge of the menu with the trailing edge of the trigger.
    const rawLeft = isRtl ? rect.left : rect.right - menuRect.width;
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(rawLeft, window.innerWidth - menuRect.width - VIEWPORT_PADDING),
    );

    const below = rect.bottom + GAP;
    const above = rect.top - GAP - menuRect.height;
    const top =
      below + menuRect.height > window.innerHeight - VIEWPORT_PADDING &&
      above >= VIEWPORT_PADDING
        ? above
        : Math.max(
            VIEWPORT_PADDING,
            Math.min(below, window.innerHeight - menuRect.height - VIEWPORT_PADDING),
          );

    setCoords({ top, left });
  }, [isRtl]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updatePosition();
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus({ preventScroll: true });
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (menuRef.current?.contains(target) || triggerRef.current?.contains(target))
      ) {
        return;
      }
      close(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    };

    const onScrollOrResize = () => close(false);

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("blur", onScrollOrResize);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("blur", onScrollOrResize);
    };
  }, [open, close]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (nodes.length === 0) return;
    const current = nodes.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      nodes[(current + 1) % nodes.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      nodes[(current - 1 + nodes.length) % nodes.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      nodes[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  if (items.length === 0) return null;

  const triggerButton = (
    <button
      ref={triggerRef}
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen((prev) => !prev)}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-sm",
        "transition-colors duration-(--duration-fast)",
        "text-fg-muted hover:bg-accent-soft hover:text-accent",
        open && "bg-accent-soft text-accent",
        className,
      )}
    >
      {icon}
    </button>
  );

  return (
    <>
      {open ? (
        triggerButton
      ) : (
        <Tooltip label={label} side={tooltipSide}>
          {triggerButton}
        </Tooltip>
      )}

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            dir={dir}
            onKeyDown={onMenuKeyDown}
            style={
              coords
                ? { top: coords.top, left: coords.left }
                : { top: -9999, left: -9999, visibility: "hidden" }
            }
            className={cn(
              "fixed z-50 min-w-44 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-(--shadow-panel)",
              "animate-[scale-in_var(--duration-fast)_var(--ease-out-quart)]",
            )}
          >
            <div className="px-2.5 py-1 text-[11px] font-medium text-fg-muted select-none">
              {label}
            </div>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
                className={cn(
                  "group flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-start",
                  "text-sm text-fg-soft outline-none select-none",
                  "transition-colors duration-(--duration-fast)",
                  "hover:bg-surface-hover hover:text-fg focus:bg-surface-hover focus:text-fg",
                )}
              >
                {item.icon && (
                  <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted transition-colors group-hover:text-accent group-focus:text-accent">
                    {item.icon}
                  </span>
                )}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
