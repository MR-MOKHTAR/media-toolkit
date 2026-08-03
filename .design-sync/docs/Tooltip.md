---
category: UI
---

A styled bubble for controls that are an icon and nothing else. Wraps the
trigger; it is not positioned by the caller.

```jsx
<Tooltip label="Tasks">
  <IconButton label="Tasks">
    <ListChecks size={17} />
  </IconButton>
</Tooltip>
```

CSS-only by design — no positioning library, no portal, no state. It opens on
hover **and** on focus-within, so keyboard users get the name too.

Two consequences worth knowing:

- **It opens inward**, on the inline-end side of the trigger (right of a
  left-hand rail in English, left of a right-hand one in Persian), so it grows
  toward the middle of the window and never off the edge. Leave room on that
  side.
- **It is clipped by any scrolling ancestor.** Inside a scroll container the
  bubble is cut off. That is the trade for having no portal — if a tooltip must
  escape, rethink the layout rather than reaching for one.

The trigger inside must carry its own `aria-label`; the bubble is `aria-hidden`
so a screen reader is not told the same thing twice. The trigger must **not**
also set `title`, or the OS tooltip draws on top of this one — which means
wrapping an `IconButton` is only correct when its label is otherwise invisible,
as in the collapsed sidebar.

Do not use it for prose or anything the user must read: it is a name for an
unlabelled control, not a help popover.
