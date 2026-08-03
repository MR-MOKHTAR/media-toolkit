import { Button, Field, FormCard, Segmented, TextInput } from "downloader";

/**
 * The surface every form in the app is drawn on: one card holding the whole set
 * of controls, rather than each control carrying its own border on the canvas.
 *
 * Sits on `bg-canvas` in both cells below, because that is the only place it is
 * ever used and the glass is only legible against it -- the card is a
 * translucent `bg-surface`, so on a white background there is nothing to see.
 */
export function Basic() {
  return (
    <div className="w-96 bg-canvas p-6">
      <FormCard>
        <Field label="Video URL" htmlFor="form-card-url">
          <TextInput
            id="form-card-url"
            dir="ltr"
            defaultValue="https://youtu.be/dQw4w9WgXcQ"
          />
        </Field>
        <Button variant="primary" size="lg">
          Start download
        </Button>
      </FormCard>
    </div>
  );
}

/** The shape a tool screen actually takes: a subtitle on the canvas, then every
 *  control inside the card, ending in the one button that runs the job. */
export function ToolForm() {
  return (
    <div className="flex w-96 flex-col gap-3 bg-canvas p-6">
      <p className="px-2 text-center text-sm text-fg-muted">
        Paste a link. Video is saved as MP4, audio as MP3.
      </p>
      <FormCard>
        <TextInput dir="ltr" placeholder="Paste a link here…" />
        <Segmented
          label="Quality"
          value="720"
          onChange={() => {}}
          options={[
            { value: "best", label: "Best" },
            { value: "1080", label: "1080p" },
            { value: "720", label: "720p" },
          ]}
        />
        <Button variant="primary" size="lg">
          Start download
        </Button>
      </FormCard>
    </div>
  );
}
