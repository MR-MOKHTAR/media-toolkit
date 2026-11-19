import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** How close to the end still counts as "at the end": a progress line growing
 *  by a few pixels must not knock the thread off the bottom. */
const THRESHOLD = 120;

/**
 * Keeps a chat thread pinned to its newest message -- but only while the user
 * is there. Scrolled up to read something older, the thread stays put and
 * `atBottom` turns false, which is what shows the "jump to latest" button.
 *
 * Content growth is watched rather than inferred from data: a progress bar
 * appearing, an error line expanding, the draft's preview arriving -- all of
 * them change the height, none of them change the job count.
 */
export function useStickToBottom(
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
) {
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  const scrollToBottom = useCallback(
    (smooth = true) => {
      const element = scrollRef.current;
      if (!element) return;
      atBottomRef.current = true;
      setAtBottom(true);
      element.scrollTo({
        top: element.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [scrollRef],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      const near =
        element.scrollHeight - element.scrollTop - element.clientHeight < THRESHOLD;
      atBottomRef.current = near;
      setAtBottom(near);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
        return;
      }
      // Content that shrank -- a draft closed, a row removed -- can bring the
      // end back into view without a scroll event to say so.
      const near =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < THRESHOLD;
      if (near) {
        atBottomRef.current = true;
        setAtBottom(true);
      }
    });
    observer.observe(content);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollRef, contentRef]);

  return { atBottom, scrollToBottom };
}
