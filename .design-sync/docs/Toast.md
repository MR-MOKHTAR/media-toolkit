---
category: Feedback
---

The toast stack — the app's only transient notification surface. Mount it **once**,
at the app root, and feed it the whole list. It positions itself `fixed` against
the bottom inline-end corner; it is not placed by the caller.

```jsx
<Toast
  toasts={toasts}
  isRtl={i18n.dir() === "rtl"}
  onDismiss={(id) => dismiss(id)}
/>
```

A stack rather than a single slot because several jobs run at once — two
finishing in the same second must not replace each other. Oldest first, so new
ones arrive at the bottom and older ones ride up.

Each toast is `{ id, type, message, expiresAt, action? }`:

- `id` must be unique and stable (a uuid, not `Date.now()` — two jobs finishing
  in the same millisecond used to collide, and this is a React key).
- `type` picks the icon and its colour: `success`, `error`, `warning`, `info`.
  `error` also makes it an assertive `role="alert"`; the rest are polite
  `status`. Use `error` only for things worth interrupting a screen reader for.
- `expiresAt` is an absolute timestamp, so each toast expires independently.
  The component does not run the timer — the owner drops expired entries.
- `action` is **one** button, not a list. A notification needing two decisions is
  a dialog. Acting on a toast dismisses it.

`message` clamps to three lines, so a full video title is safe to pass whole.

`isRtl` only decides which edge toasts slide in from; the anchor corner already
follows writing direction on its own.
