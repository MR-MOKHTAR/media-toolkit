---
category: UI
---

A 6px track with an accent fill, for work that is already running. It reports
progress; it is not a control and has no busy/idle state of its own — render it
only while there is something to report.

```jsx
<ProgressBar percent={62} label="Downloading" />
```

Pass `percent={null}` when the duration genuinely cannot be known — some ffmpeg
operations never report one — and it renders a sweeping indeterminate bar. Do
**not** invent a number to avoid this; the sweep is the honest answer and users
read a fake percentage as a lie when it jumps.

`label` is the accessible name (the bar carries `role="progressbar"` and the
value). It is not rendered. When you want a visible caption, put it in a row
above the bar and use `tnum` on the number so it does not jitter as it counts:

```jsx
<div className="flex items-baseline gap-2">
  <span className="flex-1 truncate text-sm text-fg">Compressing clip.mp4</span>
  <span className="shrink-0 text-xs text-fg-muted tnum">37%</span>
</div>
<ProgressBar percent={37} label="Compressing" />
```

The fill is sized with `inline-size`, so it grows from the leading edge in both
directions. Never re-implement it with `transform: scaleX()` or a positioned
`left` — both fill backwards under RTL.
