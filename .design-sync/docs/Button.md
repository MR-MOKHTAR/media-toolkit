---
category: UI
---

The standard action control. `secondary` is the default, and that is deliberate:
most buttons in this app are not the primary action on their screen.

Pick the variant by what the click does, not by how much you want it noticed:

- **primary** — the one action the screen exists for. At most one per screen.
  Starting a download, running a conversion.
- **secondary** — everything else that is a real action. Choosing a folder,
  opening a picker.
- **ghost** — dismissals and retreats. Cancel, Close, Back.
- **danger** — destructive and irreversible. Remove, Clear finished.

Sizes track density rather than importance: `sm` inside rows and cards, `md`
everywhere by default, `lg` only for a lone primary action on an otherwise
empty screen.

```jsx
<Button variant="primary" icon={<Download size={16} />}>
  Start download
</Button>
```

The `icon` slot sits before the label and flips to the correct side under RTL on
its own — the row is a flex container using logical direction, so never branch on
language to reorder it. Use a 16px icon at `md`, 15px at `sm`.

For a control that is *only* an icon, use `IconButton` instead — it is not a
`Button` with the label removed, and it requires an accessible name.
