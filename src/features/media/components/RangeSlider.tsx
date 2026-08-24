import { useState } from "react";
import * as Slider from "@radix-ui/react-slider";
import { useTranslation } from "react-i18next";

import { TextInput } from "../../../components/ui/TextInput";
import { cn } from "../../../lib/cn";
import { formatTimecode, parseTimecode } from "../../../lib/format";

interface RangeSliderProps {
  durationSecs: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}

/**
 * Two handles over a timeline, with the field that edits each handle sitting on
 * that handle's own side of the track.
 *
 * The whole control mirrors with the interface language: under `fa`/`ar` zero is
 * on the right, the clip grows leftward, and the start field leads on the right.
 * That is `dir` on the slider root -- Radix reverses both the geometry and the
 * arrow keys from it, so under RTL, ArrowLeft advances the time.
 *
 * This was two `<input type="range">` stacked on top of each other with
 * `pointer-events` disabled on everything but their thumbs, because a native
 * range has one handle and a trim needs two. That trick worked until the handles
 * met: with both at the same position the upper input's thumb sat over the
 * lower one, and the handle underneath could not be picked up again. One root
 * with two thumbs has no upper and lower -- Radix moves whichever thumb is
 * nearest the press, so the pair can close completely and still come apart.
 *
 * The timecode *text* does not mirror. Digits stay ASCII and left to right
 * inside their boxes, because a mm:ss field written right to left is unreadable
 * and impossible to edit.
 */
export function RangeSlider({
  durationSecs,
  start,
  end,
  onChange,
}: RangeSliderProps) {
  const { t, i18n } = useTranslation();
  const step = durationSecs > 600 ? 1 : 0.1;

  const setStart = (value: number) => {
    onChange(Math.min(Math.max(0, value), end - step), end);
  };

  const setEnd = (value: number) => {
    onChange(start, Math.max(Math.min(durationSecs, value), start + step));
  };

  return (
    <div className="flex flex-col gap-2">
      {/* No dir on this row: it inherits the page direction, so the DOM order
          start -> track -> end lands start-left under English and start-right
          under Persian and Arabic without any conditional ordering. */}
      <div className="flex items-center gap-3">
        <TimeField label={t("trim_start")} value={start} onCommit={setStart} />

        <Slider.Root
          // Read off i18n rather than inherited, to match the fields either
          // side of it: those are pinned to ltr, and an inherited direction
          // would be taken from the nearer of the two.
          dir={i18n.dir()}
          // `|| 1`: a zero-length range makes every position NaN. The caller
          // already refuses to render below a known duration, so this only
          // covers the frame before one arrives.
          max={durationSecs || 1}
          min={0}
          step={step}
          value={[start, end]}
          // The clamps stay here rather than leaning on `minStepsBetweenThumbs`,
          // because they are also what the typed timecode fields commit
          // through -- one rule for both ways in.
          onValueChange={([nextStart, nextEnd]) => {
            if (nextStart !== start) setStart(nextStart);
            else if (nextEnd !== end) setEnd(nextEnd);
          }}
          className="relative flex h-11 min-w-0 flex-1 touch-none items-center select-none"
        >
          <Slider.Track className="relative h-1.5 w-full rounded-full bg-line">
            <Slider.Range className="absolute h-full rounded-full bg-accent" />
          </Slider.Track>
          <SliderThumb label={t("trim_start")} />
          <SliderThumb label={t("trim_end")} />
        </Slider.Root>

        <TimeField label={t("trim_end")} value={end} onCommit={setEnd} />
      </div>

      <span className="text-center text-sm text-fg-muted tnum" dir="ltr">
        {formatTimecode(Math.max(0, end - start))}
      </span>
    </div>
  );
}

/** Ringed in the surface colour so the two stay told apart where they overlap,
 *  which is exactly where the old stacked-input version lost one of them. */
function SliderThumb({ label }: { label: string }) {
  return (
    <Slider.Thumb
      aria-label={label}
      className={cn(
        "block size-4 rounded-full border-2 border-surface bg-accent shadow-(--shadow-raise)",
        "transition-[transform,box-shadow] duration-(--duration-fast) ease-out-quart",
        // The glow was an arbitrary shadow ending in a slash-opacity applied
        // around a var() -- which is not a colour, so the whole box-shadow was
        // invalid and the thumb grew with no glow behind it. No focus-visible
        // variant either: the global outline already marks focus, and drawing
        // both put two rings on one 16px handle.
        "hover:scale-110 hover:shadow-(--shadow-glow-accent)",
      )}
    />
  );
}

/**
 * The number half of the two-way binding. While nothing is being typed the
 * field has no state of its own and simply renders the live value, so dragging
 * a handle counts it up frame by frame. Typing parks a draft so a half-written
 * "1:" is not reformatted mid-keystroke -- and so moving the *other* handle
 * cannot wipe out an edit in progress.
 */
function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? formatTimecode(value);

  const commit = () => {
    const parsed = parseTimecode(text);
    if (parsed !== null) onCommit(parsed);
    // Dropping the draft either way: on success the clamped value flows back
    // down as the new text, on failure the last good one does.
    setDraft(null);
  };

  return (
    <TextInput
      aria-label={label}
      // ASCII digits, left to right, tabular: Persian digits in an mm:ss field
      // are hard to read and awkward to edit.
      dir="ltr"
      className="w-24 shrink-0 text-center tnum"
      value={text}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
