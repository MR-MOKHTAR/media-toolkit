---
category: UI
---

The single-line text control. A plain `<input>` underneath — it forwards its ref
and every input attribute, so `type`, `value`, `onChange`, `placeholder` and the
rest behave exactly as you expect.

```jsx
<Field label="Video URL" htmlFor="url">
  <TextInput id="url" dir="ltr" placeholder="https://…" />
</Field>
```

**Pass `dir="ltr"` whenever the value is a URL, a file path or a timecode.** It
is not the default, but nearly every caller in this app sets it: those values
read left to right even inside a Persian or Arabic interface, and mirroring them
makes them unreadable and impossible to edit. Leave `dir` alone for anything
that is real prose in the user's language.

It fills its container — give the width to a wrapper, not to the input.

Two things it does not do, so do not assume them:

- **No disabled styling.** The `disabled` attribute works, but the control looks
  identical to an enabled one. If a disabled input has to *read* as disabled,
  say so in the surrounding UI or hide the control instead.
- **No error state.** There is no invalid variant and no message slot. Report
  validation failures through a `Toast`, or as a `hint` on the wrapping `Field`.
