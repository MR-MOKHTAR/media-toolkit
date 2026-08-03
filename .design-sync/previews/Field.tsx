import { Field, Segmented, TextInput } from "downloader";
import { useState } from "react";

export function WithInput() {
  return (
    <div className="w-96">
      <Field label="Video URL" htmlFor="field-url">
        <TextInput id="field-url" dir="ltr" placeholder="https://…" />
      </Field>
    </div>
  );
}

export function WithHint() {
  return (
    <div className="w-96">
      <Field
        label="Save to"
        htmlFor="field-dest"
        hint="Everything runs on this machine — nothing is uploaded."
      >
        <TextInput id="field-dest" dir="ltr" defaultValue="/home/you/Videos" />
      </Field>
    </div>
  );
}

export function Optional() {
  return (
    <div className="w-96">
      <Field label="Subtitle language" optional htmlFor="field-subs">
        <TextInput id="field-subs" dir="ltr" placeholder="en" />
      </Field>
    </div>
  );
}

export function WrappingAChoice() {
  const [value, setValue] = useState("balanced");
  return (
    <div className="w-96">
      <Field label="Compression preset" hint="Estimates assume a 4-minute clip.">
        <Segmented
          label="Compression preset"
          value={value}
          onChange={setValue}
          options={[
            { value: "smallest", label: "Smallest", hint: "about 12 MB" },
            { value: "balanced", label: "Balanced", hint: "about 21 MB" },
            { value: "quality", label: "Best quality", hint: "about 48 MB" },
          ]}
        />
      </Field>
    </div>
  );
}
