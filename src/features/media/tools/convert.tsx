import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolForm";
import { FormatGroup, InstantBadge } from "../components/ToolFormParts";
import { defaultOutputName } from "../useMediaJob";

const VIDEO_FORMATS = ["mp4", "mkv", "mov", "webm"];
const AUDIO_FORMATS = ["mp3", "m4a", "wav"];

/**
 * One control: the target format.
 *
 * Picking an audio format IS "extract audio". There is no separate mode, no
 * checkbox and no second tool -- collapsing those two ideas into one grid is
 * the single biggest simplification in this app.
 */
function ConvertControls({ path, info, state: format, setState: setFormat }: MediaToolContext<string>) {
  const { t } = useTranslation();
  const [instant, setInstant] = useState(false);

  // Whether this particular conversion is a plain container swap, so the
  // promise of "instant, no quality loss" is only made when it is true.
  useEffect(() => {
    if (!path || !info) {
      setInstant(false);
      return;
    }
    let cancelled = false;
    void invoke<boolean>("can_copy_streams", { path, format })
      .then((value) => !cancelled && setInstant(value))
      .catch(() => !cancelled && setInstant(false));
    return () => {
      cancelled = true;
    };
  }, [path, info, format]);

  if (!info) return null;

  return (
    <div className="flex flex-col gap-4">
      <FormatGroup
        title={t("format_video")}
        formats={VIDEO_FORMATS}
        value={format}
        onChange={setFormat}
        disabled={!info.video}
        disabledHint={t("no_video_track")}
      />
      <FormatGroup
        title={t("format_audio")}
        formats={AUDIO_FORMATS}
        value={format}
        onChange={setFormat}
      />
      {instant && <InstantBadge text={t("instant_copy")} />}
    </div>
  );
}

export const convertTool: MediaToolConfig<string> = {
  kind: "convert",
  command: "start_convert",
  requires: "media",
  initialState: "mp4",
  Controls: ConvertControls,
  toRequest: ({ path, state: format }) => {
    const stem = defaultOutputName(path);
    return {
      args: { input: path, outputName: stem, format },
      title: `${stem}.${format}`,
      detail: format.toUpperCase(),
    };
  },
};
