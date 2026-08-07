import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ControlGroup } from "../../../components/ui/Card";
import { Segmented } from "../../../components/ui/Segmented";
import { formatBytes } from "../../../lib/format";
import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolScreen";
import { RangeSlider } from "../components/RangeSlider";
import { defaultOutputName } from "../useMediaJob";

/** The backend enforces this too; here it also bounds the slider so the limit
 *  is visible rather than a surprise at run time. */
const MAX_SECONDS = 15;

interface GifState {
  start: number;
  end: number;
  smooth: boolean;
}

/** Rough, but enough to keep someone from producing a 200 MB GIF by accident. */
function estimateBytes({ start, end, smooth }: GifState) {
  const seconds = Math.max(0, end - start);
  const width = smooth ? 480 : 360;
  const fps = smooth ? 15 : 10;
  return seconds * fps * width * (width * 0.5625) * 0.09;
}

function GifControls({
  info,
  state,
  setState,
  language,
}: MediaToolContext<GifState>) {
  const { t } = useTranslation();
  const duration = info?.durationSecs ?? 0;

  useEffect(() => {
    if (duration > 0) {
      setState((current) => ({
        ...current,
        start: 0,
        end: Math.min(MAX_SECONDS, duration),
      }));
    }
  }, [duration, setState]);

  if (duration <= 0) return null;

  return (
    <>
      <RangeSlider
        durationSecs={duration}
        start={state.start}
        end={state.end}
        onChange={(start, end) => setState((current) => ({ ...current, start, end }))}
        maxSpanSecs={MAX_SECONDS}
      />
      <ControlGroup>
        <Segmented
          label={t("tool_gif")}
          value={state.smooth ? "smooth" : "small"}
          onChange={(value) => {
            const smooth = value === "smooth";
            setState((current) => ({ ...current, smooth }));
          }}
          options={[
            { value: "small", label: t("gif_small"), hint: "360p · 10fps" },
            { value: "smooth", label: t("gif_smooth"), hint: "480p · 15fps" },
          ]}
        />
        <p className="text-xs text-fg-muted tnum">
          ≈ {formatBytes(estimateBytes(state), language)}
        </p>
      </ControlGroup>
    </>
  );
}

export const gifTool: MediaToolConfig<GifState> = {
  kind: "gif",
  command: "start_gif",
  requires: "video",
  initialState: { start: 0, end: 0, smooth: false },
  Controls: GifControls,
  isReady: ({ state }) => state.end > state.start,
  toRequest: ({ path, state, t }) => {
    const stem = defaultOutputName(path);
    return {
      args: {
        input: path,
        outputName: stem,
        startSecs: state.start,
        endSecs: state.end,
        smooth: state.smooth,
      },
      title: `${stem}.gif`,
      detail: state.smooth ? t("gif_smooth") : t("gif_small"),
    };
  },
};
