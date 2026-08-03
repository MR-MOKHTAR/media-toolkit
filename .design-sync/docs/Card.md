---
category: UI
---

A surface panel: `bg-surface`, a `line` border and the `lg` radius. It is a
plain container — it takes any div props and adds no layout of its own, so give
it its own `flex flex-col gap-*` when it holds more than one thing.

```jsx
<Card className="w-96">
  <div className="flex flex-col gap-4">
    <Field label="Video URL" htmlFor="url">
      <TextInput id="url" dir="ltr" placeholder="https://…" />
    </Field>
    <Button variant="primary">Start download</Button>
  </div>
</Card>
```

Cards are how this app separates one job, one form or one result from the next
against the `canvas` background. Do not nest them: a card inside a card reads as
a mistake, and the border doubles up. Group instead with spacing, or with a
divider (`border-t border-line pt-*`).

Width belongs to the caller. The component fills whatever it is given.
