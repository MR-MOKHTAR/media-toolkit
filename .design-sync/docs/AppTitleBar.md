---
category: Layout
---

The 44px window chrome: app name, drag region, and the minimise / maximise /
close controls. It is the first child of the app column and appears on every
screen.

```jsx
<AppTitleBar
  isMaximized={isMaximized}
  onMinimize={minimize}
  onToggleMaximize={toggleMaximize}
  onClose={close}
/>
```

The title is the app name and never changes. Which screen you are on is
`AppSidebar`'s job, and it answers that by highlighting a row — do not pass a
screen title through here, and do not add navigation, settings or theme controls
to it. Everything that has tried to live in this bar has moved out.

`isMaximized` only swaps the middle control's label and tooltip between
"maximize" and "restore"; the glyph is the same either way.

Its `dir` is pinned to `ltr` on purpose and does **not** follow the language:
window controls are chrome, and every desktop puts them on the same side
regardless of text direction. The app name inside still shapes in its own
direction. `AppSidebar` below it deliberately does flip — that one is content.

The drag region is a dedicated element inside the bar. If you build custom
chrome, keep the draggable area separate from the controls — marking a container
that holds buttons swallows the clicks on them.
