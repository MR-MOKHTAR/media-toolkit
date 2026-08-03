---
category: UI
---

The label-and-control pairing used by every form in the app. It supplies the
label, the optional marker and the hint line, and stacks them with the right
spacing — it does not supply the control, which is passed as children.

```jsx
<Field label="Save to" htmlFor="dest" hint="Everything runs on this machine.">
  <TextInput id="dest" dir="ltr" defaultValue="/home/you/Videos" />
</Field>
```

It wraps **any** control, not just inputs — a `Segmented` inside a `Field` is
how the tool screens present their preset choices.

Pass `htmlFor` and give the child the matching `id` whenever the child is a
single focusable element; that is what makes the label clickable. Skip it when
the child is a group (a `Segmented` carries its own `aria-label`).

`optional` marks a control as skippable with a subtle dot rather than a
sentence. Never use the inverse — do not mark required fields; in this app most
fields are required and the marker would be noise.

`hint` is for a standing explanation. It is not an error slot: this component
has no error state.
