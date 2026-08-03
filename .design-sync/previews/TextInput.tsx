import { TextInput } from "downloader";

export function Placeholder() {
  return (
    <div className="w-96">
      <TextInput dir="ltr" placeholder="Paste a video link" />
    </div>
  );
}

export function WithValue() {
  return (
    <div className="flex w-96 flex-col gap-3">
      {/* dir="ltr" on every caller that holds a URL, a path or a timecode:
          those read left to right even inside a Persian or Arabic interface. */}
      <TextInput dir="ltr" defaultValue="https://youtu.be/dQw4w9WgXcQ" />
      <TextInput dir="ltr" defaultValue="/home/you/Videos" />
      <TextInput dir="ltr" defaultValue="00:01:24.500" />
    </div>
  );
}

/* No `disabled` story: TextInput declares no `disabled:` classes, so a disabled
 * input is pixel-identical to an enabled one and the cell would claim a state
 * the component does not actually express. Recorded as a gap in NOTES.md. */
