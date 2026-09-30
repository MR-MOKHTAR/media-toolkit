import { useCallback, useRef, type KeyboardEvent } from "react";

/**
 * Arrow keys for a group of `role="radio"` buttons.
 *
 * The groups in this app are buttons wearing the radio role -- styled cards and
 * rail rows rather than native inputs -- and the role promises behaviour the
 * buttons did not have: every option was its own Tab stop, and the arrow keys
 * did nothing at all. A screen reader announced a radio group that a keyboard
 * could not operate the way one is operated.
 *
 * This is that behaviour: the group is one Tab stop (the selected option), the
 * arrows move the selection and the focus together, Home and End jump to the
 * ends, and disabled options are stepped over. Left and right follow the
 * reading direction, so "next" is to the left in Persian and Arabic.
 */
export function useRovingRadio<T extends string>({
  values,
  value,
  onChange,
  isDisabled,
}: {
  values: readonly T[];
  value: T;
  onChange: (next: T) => void;
  isDisabled?: (candidate: T) => boolean;
}) {
  const nodes = useRef(new Map<T, HTMLElement>());
  const enabled = values.filter((candidate) => !isDisabled?.(candidate));
  // The Tab stop: the selected option when it can take focus, else the first
  // one that can -- a group with no reachable stop cannot be tabbed into.
  const stop = enabled.includes(value) ? value : enabled[0];

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (enabled.length === 0) return;
      const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
      const index = Math.max(0, enabled.indexOf(stop));

      let next: number;
      switch (event.key) {
        case "ArrowDown":
          next = index + 1;
          break;
        case "ArrowUp":
          next = index - 1;
          break;
        case "ArrowRight":
          next = rtl ? index - 1 : index + 1;
          break;
        case "ArrowLeft":
          next = rtl ? index + 1 : index - 1;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = enabled.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      const target = enabled[(next + enabled.length) % enabled.length];
      onChange(target);
      nodes.current.get(target)?.focus();
    },
    [enabled, onChange, stop],
  );

  const itemProps = (candidate: T) => ({
    ref: (node: HTMLElement | null) => {
      if (node) nodes.current.set(candidate, node);
      else nodes.current.delete(candidate);
    },
    tabIndex: candidate === stop ? 0 : -1,
  });

  return { onKeyDown, itemProps };
}
