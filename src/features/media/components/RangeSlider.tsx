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
 * Two handles over a timeline.
 *
 * The direction rule here is not cosmetic. A native `<input type="range">`
 * REVERSES under `dir="rtl"` in both WebKit and Chromium: the minimum moves to
 * the right and the value grows leftward. That is correct for an abstract
 * quantity and wrong for a media timeline, which must always run left to right
 * because the video preview and every timecode do. So the track is pinned to
 * `dir="ltr"` here, once, where no individual tool can get it wrong -- only
 * the labels around it mirror.
 */
export function RangeSlider({
  durationSecs,
  start,
  end,
  onChange,
  maxSpanSecs,
}: RangeSliderProps) {
  const { t } = useTranslation();
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
    <div className="flex flex-col gap-3">
      {/* dir="ltr" on the track and everything inside it. */}
      <div dir="ltr" className="relative h-9 select-none">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
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

      <div className="flex items-center gap-2">
        <TimeField label={t("trim_start")} value={start} onCommit={setStart} />
        <span className="text-fg-muted">–</span>
        <TimeField label={t("trim_end")} value={end} onCommit={setEnd} />
        <span className="ms-auto text-sm text-fg-muted tnum" dir="ltr">
          {formatTimecode(Math.max(0, end - start))}
        </span>
      </div>
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

function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (seconds: number) => void;
}) {
  return (
    <TextInput
      aria-label={label}
      // ASCII digits, left to right, tabular: Persian digits in an mm:ss field
      // are hard to read and awkward to edit.
      dir="ltr"
      className="h-9 w-24 text-center tnum"
      defaultValue={formatTimecode(value)}
      key={formatTimecode(value)}
      onBlur={(event) => {
        const parsed = parseTimecode(event.target.value);
        if (parsed !== null) onCommit(parsed);
        else event.target.value = formatTimecode(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
