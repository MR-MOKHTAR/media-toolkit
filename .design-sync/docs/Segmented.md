---
category: UI
---

This app's replacement for a dropdown, and the default way to present a choice.

Every choice here is between three or four fixed options — quality, format,
preset, resolution — and laying them out flat means they are all visible without
a click. Reach for a `<select>` only when the list is genuinely long or unknown
at build time.

```jsx
const [preset, setPreset] = useState("balanced");

<Segmented
  label="Compression preset"
  value={preset}
  onChange={setPreset}
  options={[
    { value: "smallest", label: "Smallest", hint: "about 12 MB" },
    { value: "balanced", label: "Balanced", hint: "about 21 MB" },
    { value: "quality", label: "Best quality", hint: "about 48 MB" },
  ]}
/>
```

Controlled only — it holds no state. `label` names the group for screen readers
and is not rendered; when the choice needs a visible label, wrap it in `Field`.

`hint` is the second line under an option, for the consequence of picking it
(an estimated size, a resolution). Keep hints parallel across options — if one
has a size, they all should.

Disable an option with `disabled` **and** `disabledReason`; the reason replaces
the hint in the cell, so the option explains itself instead of just being dead.

It builds one equal column per option, so it stays readable to about four.
Beyond that the labels start truncating — split the choice or use a select.
Built on radios, so keyboard arrows and screen-reader grouping work already.
