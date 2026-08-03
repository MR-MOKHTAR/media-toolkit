---
category: Feedback
---

A full-width strip that announces a lost connection and animates its own height
open and shut.

```jsx
<div className="flex h-full flex-col">
  <AppTitleBar {...windowControls} />
  <OfflineBanner isOnline={isOnline} />
  <main className="flex-1 overflow-y-auto">{screen}</main>
</div>
```

Renders **nothing** while `isOnline` is true — that is the whole component, so
mount it unconditionally and let the prop decide. Do not wrap it in your own
`{!isOnline && …}`; you would lose the exit animation.

It belongs directly under `AppTitleBar` and above the scrolling content, as a
sibling in the same column — it is app-level chrome, not part of any screen.
Never place it inside a scroll container, where it would scroll away from the
thing it is warning about.

It carries its own translated copy and the `WifiOff` glyph, so there is nothing
to pass but the flag. It is informational only: no dismiss, no retry. The
condition clears itself when the connection returns.
