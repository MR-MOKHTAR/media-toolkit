import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TextInput } from "../../../components/ui/TextInput";
import { cn } from "../../../lib/cn";
import { formatTimecode, parseTimecode } from "../../../lib/format";

interface RangeSliderProps {
  durationSecs: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  /** GIF caps the selection; trim does not. */
  maxSpanSecs?: number;
}

/**
 * Two handles over a timeline, with the field that edits each handle sitting on
 * that handle's own side of the track.
 *
 * The whole control mirrors with the interface language: under `fa`/`ar` zero is
 * on the right, the clip grows leftward, and the start field leads on the right.
 * A native `<input type="range">` already reverses under `dir="rtl"` in WebKit
 * and Chromium -- the two engines this ships on -- so that reversal is leaned on
 * rather than fought, which also keeps the arrow keys honest: under RTL,
 * ArrowLeft advances the time.
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
  maxSpanSecs,
}: RangeSliderProps) {
  const { t, i18n } = useTranslation();
  const step = durationSecs > 600 ? 1 : 0.1;

  const setStart = (value: number) => {
    const next = Math.min(Math.max(0, value), end - step);
    const span = maxSpanSecs ? Math.min(end, next + maxSpanSecs) : end;
    onChange(next, span);
  };

  const setEnd = (value: number) => {
    const next = Math.max(Math.min(durationSecs, value), start + step);
    const clamped = maxSpanSecs ? Math.min(next, start + maxSpanSecs) : next;
    onChange(start, clamped);
  };

  const startPct = durationSecs > 0 ? (start / durationSecs) * 100 : 0;
  const endPct = durationSecs > 0 ? (end / durationSecs) * 100 : 100;

  return (
    <div className="flex flex-col gap-2">
      {/* No dir on this row: it inherits the page direction, so the DOM order
          start -> track -> end lands start-left under English and start-right
          under Persian and Arabic without any conditional ordering. */}
      <div className="flex items-center gap-3">
        <TimeField label={t("trim_start")} value={start} onCommit={setStart} />

        <div dir={i18n.dir()} className="relative h-9 min-w-0 flex-1 select-none">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" />
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent"
            style={{
              insetInlineStart: `${startPct}%`,
              width: `${Math.max(0, endPct - startPct)}%`,
            }}
          />
          <RangeInput
            label={t("trim_start")}
            value={start}
            max={durationSecs}
            step={step}
            onChange={setStart}
          />
          <RangeInput
            label={t("trim_end")}
            value={end}
            max={durationSecs}
            step={step}
            onChange={setEnd}
          />
        </div>

        <TimeField label={t("trim_end")} value={end} onCommit={setEnd} />
      </div>

      <span className="text-center text-sm text-fg-muted tnum" dir="ltr">
        {formatTimecode(Math.max(0, end - start))}
      </span>
    </div>
  );
}

function RangeInput({
  label,
  value,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="range"
      aria-label={label}
      min={0}
      max={max || 1}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      // The two inputs are stacked, so only the thumbs may receive pointer
      // events -- otherwise the upper track swallows clicks meant for the
      // lower thumb and one handle becomes unreachable.
      className={cn(
        "absolute inset-x-0 top-1/2 h-9 w-full -translate-y-1/2 appearance-none bg-transparent",
        "pointer-events-none focus:outline-none",
        "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none",
        "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full",
        "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface",
        "[&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow",
        "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4",
        "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2",
        "[&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:bg-accent",
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
      className="h-9 w-24 shrink-0 text-center tnum"
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
