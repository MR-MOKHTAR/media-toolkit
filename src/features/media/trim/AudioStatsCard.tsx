import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { Activity, AudioWaveform, Clock, Gauge, PauseCircle, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatCount, formatPercent, formatTimecode } from "../../../lib/format";

interface Props {
  durationSecs: number;
  silenceSecs: number;
  silenceCount: number;
  peakDb: number;
  meanDb: number;
}

/**
 * The file's sound at a glance: how long, how much of it is sound and how
 * much silence, how many silences, how loud at its peak and on average --
 * and a bar that shows the split.
 *
 * Numbers count up when they change, so moving the sensitivity reads as the
 * figures responding to it rather than as a flicker.
 */
export function AudioStatsCard({ durationSecs, silenceSecs, silenceCount, peakDb, meanDb }: Props) {
  const { t, i18n } = useTranslation();
  const soundRatio = durationSecs > 0 ? Math.max(0, 1 - silenceSecs / durationSecs) : 1;
  const percent = useCounted(soundRatio * 100);
  const silence = useCounted(silenceSecs);
  const count = useCounted(silenceCount);

  const stats = [
    { icon: Clock, label: t("trim_stat_duration"), value: formatTimecode(durationSecs), ltr: true },
    { icon: AudioWaveform, label: t("trim_stat_sound"), value: formatPercent(percent, i18n.language) },
    { icon: PauseCircle, label: t("trim_stat_silence"), value: formatTimecode(silence), ltr: true },
    { icon: Activity, label: t("trim_stat_silences"), value: formatCount(Math.round(count), i18n.language) },
    { icon: Gauge, label: t("trim_stat_peak"), value: `${peakDb.toFixed(1)} dB`, ltr: true },
    { icon: Volume2, label: t("trim_stat_loudness"), value: `${meanDb.toFixed(1)} dB`, ltr: true },
  ];

  return (
    <div className="glass-inset flex flex-col gap-3 rounded-lg border p-3.5">
      <div className="grid grid-cols-3 gap-x-3 gap-y-2.5 sm:grid-cols-6">
        {stats.map(({ icon: Icon, label, value, ltr }) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1 truncate text-xs text-fg-muted">
              <Icon size={12} className="shrink-0" />
              {label}
            </span>
            {/* The figure is isolated left-to-right, but the cell keeps the
                interface's direction, so it lines up under its label. */}
            <span className="text-start text-base font-semibold text-fg tnum">
              {ltr ? <bdi dir="ltr">{value}</bdi> : value}
            </span>
          </div>
        ))}
      </div>

      {/* Sound against silence, as one bar. */}
      <div dir="ltr" className="flex h-2 w-full overflow-hidden rounded-full bg-warning/25" aria-hidden>
        <div
          className="h-full rounded-full bg-(image:--gradient-accent) transition-[width] duration-500 ease-out-quart"
          style={{ width: `${soundRatio * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-accent" />
          {t("trim_legend_sound")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-warning/70" />
          {t("trim_legend_silence")}
        </span>
      </div>
    </div>
  );
}

/** A number that eases to each new value. */
function useCounted(target: number) {
  const [value, setValue] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    const controls = animate(current.current, target, {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (next) => {
        current.current = next;
        setValue(next);
      },
    });
    return () => controls.stop();
  }, [target]);
  return value;
}
