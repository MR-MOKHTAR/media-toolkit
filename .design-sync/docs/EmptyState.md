---
category: UI
---

What a screen shows when it has nothing yet. A centred icon tile, a title, an
optional line of explanation and an optional action.

```jsx
<EmptyState
  icon={<Inbox size={22} />}
  title="Nothing running"
  description="Downloads you start will show up here, and keep going while you work in another tool."
  action={<Button variant="secondary">Choose file</Button>}
/>
```

The `action` is `secondary`. An empty state sits under a screen header that
already carries the screen's one `primary` button; this is a second way to the
same thing for the eye that lands in the middle of the page, not a rival to it.

Write the `title` as a statement of fact ("Nothing running", "No file chosen"),
not an apology or an instruction. The `description` is where the instruction
goes, and it is the place to answer "so what do I do now" — it clamps to a
readable measure, so two short sentences at most.

`description` and `action` are both optional and the layout closes up cleanly
without them; a title-only empty state is fine for a transient condition.

The icon is a 22px glyph inside a 48px `surface-soft` tile with a `line` border,
drawn in `fg-muted` — pass the glyph, not the tile. It is neutral on purpose: an
accent-filled mark there reads as something to press. Choose one that describes
*the missing thing*, not the error.
