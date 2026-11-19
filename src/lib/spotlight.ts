/**
 * Feeds the pointer position to `.glass-spotlight` cards (theme.css), as
 * `--mx`/`--my` in the card's own pixels.
 *
 * One delegated listener for the whole document rather than a handler per
 * card: a job list can hold a hundred rows, and only the one under the
 * pointer needs to know where it is. Throttled to a frame.
 */
export function installSpotlight() {
  let frame = 0;
  let last: PointerEvent | null = null;

  const apply = () => {
    frame = 0;
    const event = last;
    if (!event || !(event.target instanceof Element)) return;
    const card = event.target.closest<HTMLElement>(".glass-spotlight");
    if (!card) return;
    const box = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - box.left}px`);
    card.style.setProperty("--my", `${event.clientY - box.top}px`);
  };

  document.addEventListener(
    "pointermove",
    (event) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(apply);
    },
    { passive: true },
  );
}
