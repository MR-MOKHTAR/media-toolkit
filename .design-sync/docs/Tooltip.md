---
category: UI
---

A styled bubble naming a control that is an icon and nothing else. Wraps the
trigger; it is not positioned by the caller.

`IconButton` already carries one, labelled with its own `label` — so this is
wrapped by hand only around an icon-only control that is not an `IconButton`,
such as a row of the collapsed sidebar.

```jsx
<Tooltip label="Tasks">
  <button aria-label="Tasks">
    <ListChecks size={17} />
  </button>
</Tooltip>
```

Built on Radix: it portals to `document.body`, so no scroll container clips it,
and it opens on hover **and** on focus, so keyboard users get the name too.

- **`side`** picks where it opens — `right` by default, beside a rail icon and
  toward the middle of the window in both writing directions; `bottom` under
  the title bar. With no room there it slides or flips rather than running off
  the window.
- **It is solid and high-contrast on purpose** — dark in the light theme, a
  lifted surface with a bright edge in the dark one — because it opens over
  every other surface in the app and must not blend into any of them.

The trigger must carry its own `aria-label`; the bubble is `aria-hidden` so a
screen reader is not told the same thing twice. It must **not** also set
`title`, or the OS tooltip draws on top of this one.

Do not use it for prose or anything the user must read: it is a name for an
unlabelled control, not a help popover.
