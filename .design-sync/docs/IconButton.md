---
category: UI
---

A square 32px control carrying one glyph and no text. Used for the repeated
actions on a row or in a toolbar, where a labelled `Button` each time would be
more text than content.

`label` is **required** and is not decoration: it becomes both `aria-label` and
`title`, because an icon on its own tells a screen reader nothing. Write it as
the action ("Show in folder"), not the icon's name ("folder").

```jsx
<IconButton label="Cancel" variant="danger">
  <X size={16} />
</IconButton>
```

Defaults to `ghost`, which is right for the usual case — a cluster of these at
the end of a row should recede until pointed at. Use `danger` for the
destructive one so the cluster still reads at a glance.

Icons run 15–17px inside it; the button itself does not scale.

Because it already sets `title`, do **not** wrap it in `Tooltip` unless you also
need the styled bubble — the two together draw the OS tooltip on top of the
styled one. The sidebar wraps them only when collapsed, where there is no label
on screen at all.
