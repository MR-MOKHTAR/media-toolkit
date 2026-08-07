import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../../lib/cn";
import { extensionOf } from "../../../lib/mediaKind";
import type {
  MediaToolConfig,
  MediaToolContext,
} from "../components/MediaToolScreen";
import { RangeSlider } from "../components/RangeSlider";
import { defaultOutputName } from "../useMediaJob";

interface TrimState {
  start: number;
  end: number;
  /** Re-encode to land on the exact frame asked for, instead of the nearest
   *  preceding keyframe. */
  exact: boolean;
}

function TrimControls({ info, state, setState }: MediaToolContext<TrimState>) {
  const { t } = useTranslation();
  const duration = info?.durationSecs ?? 0;

  useEffect(() => {
    if (duration > 0) setState((current) => ({ ...current, start: 0, end: duration }));
  }, [duration, setState]);

  if (duration <= 0) return null;

  return (
    <>
      <RangeSlider
        durationSecs={duration}
        start={state.start}
        end={state.end}
        onChange={(start, end) => setState((current) => ({ ...current, start, end }))}
      />

      {/* One checkbox, off by default. A stream copy is instant and lossless
          but snaps to the nearest preceding keyframe, so the clip can begin a
          moment early -- said plainly rather than hidden. */}
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={state.exact}
          onChange={(event) => {
            const exact = event.target.checked;
            setState((current) => ({ ...current, exact }));
          }}
          className={cn("mt-0.5 size-4 shrink-0 rounded-sm border-line accent-accent")}
        />
        <span className="flex flex-col">
          <span className="text-sm text-fg">{t("trim_exact")}</span>
          <span className="text-xs text-fg-muted">
            {state.exact ? t("trim_exact_hint") : t("trim_fast_hint")}
          </span>
        </span>
      </label>
    </>
  );
}

export const trimTool: MediaToolConfig<TrimState> = {
  kind: "trim",
  command: "start_trim",
  requires: "media",
  initialState: { start: 0, end: 0, exact: false },
  Controls: TrimControls,
  isReady: ({ state }) => state.end > state.start,
  toRequest: ({ path, state, t }) => {
    const stem = defaultOutputName(path);
    // Mirrors what the backend picks (media/ops.rs): a stream copy keeps the
    // source container, an exact cut has to re-encode and lands as MP4.
    const ext = state.exact ? "mp4" : (extensionOf(path ?? "") ?? "mp4");
    return {
      args: {
        input: path,
        outputName: `${stem}-clip`,
        startSecs: state.start,
        endSecs: state.end,
        exact: state.exact,
      },
      title: `${stem}-clip.${ext}`,
      detail: state.exact ? t("trim_exact") : t("trim_fast"),
    };
  },
};
