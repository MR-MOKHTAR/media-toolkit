import { Segmented } from "downloader";
import { useState } from "react";

export function Quality() {
  const [value, setValue] = useState("1080p");
  return (
    <Segmented
      label="Quality"
      value={value}
      onChange={setValue}
      options={[
        { value: "2160p", label: "4K" },
        { value: "1080p", label: "1080p" },
        { value: "720p", label: "720p" },
        { value: "480p", label: "480p" },
      ]}
    />
  );
}

export function PresetsWithHints() {
  const [value, setValue] = useState("balanced");
  return (
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
  );
}

export function WithDisabledOption() {
  const [value, setValue] = useState("mp4");
  return (
    <Segmented
      label="Output format"
      value={value}
      onChange={setValue}
      options={[
        { value: "mp4", label: "MP4" },
        { value: "webm", label: "WebM" },
        { value: "mov", label: "MOV", disabled: true, disabledReason: "no audio track" },
      ]}
    />
  );
}

export function TwoOptions() {
  const [value, setValue] = useState("video");
  return (
    <Segmented
      label="Media kind"
      value={value}
      onChange={setValue}
      options={[
        { value: "video", label: "Video" },
        { value: "audio", label: "Audio only" },
      ]}
    />
  );
}
