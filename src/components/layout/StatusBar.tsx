import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { animate } from "framer-motion";
import { Activity, AlertCircle, ArrowDownToLine, Gauge, Loader2, Radar, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { bitRateParts, formatCount, speedParts } from "../../lib/format";
import { useSpeedMonitor } from "../../features/downloads/useSpeedMonitor";
import { jobsOfKind } from "../../features/jobs/selectors";
import { useJobs } from "../../features/jobs/useJobs";
import { ToolbarButton } from "../ui/ToolbarButton";

/**
 * The thin bar along the bottom of the window.
 *
 * Two zones: what is happening now at the start (live speed, its trace, the
 * peak, how many downloads are moving), and what is known about the line at the
 * end (the last measurement, its ping, and the button that measures again).
 * Both are laid out with logical alignment, so Persian and Arabic mirror it
 * without a branch on the language.
 *
 * Every figure sits in a slot of fixed width with its unit beside it, so a rate
 * going from 9.9 to 10.2 or from KB/s to MB/s never shoves its neighbours along.
 *
 * On every screen: downloads keep running while the user is elsewhere, and the
 * bar is the one place that says so. The automatic test still only runs from
 * the download screen -- see `useSpeedMonitor`.
 */
export function StatusBar({
  isOnline,
  language,
}: {
  isOnline: boolean;
  language: string;
}) {
  const { route } = useNavigation();
  const { jobs } = useJobs();
  const downloads = jobsOfKind(jobs, "download");

  // Here rather than in the download screen: a test that is running when the
  // user steps over to Settings should still finish, and a measurement should
  // survive the trip.
  const monitor = useSpeedMonitor({
    jobs: downloads,
    isOnline,
    enabled: route.name === "download",
  });

  return (
    <footer className="glass-chrome grid h-7 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t px-3 text-xs leading-none text-fg-muted">
      <Now monitor={monitor} language={language} />
      <Line monitor={monitor} isOnline={isOnline} language={language} />
    </footer>
  );
}

type Monitor = ReturnType<typeof useSpeedMonitor>;

/** The start zone: the transfer happening right now, if any. */
function Now({ monitor, language }: { monitor: Monitor; language: string }) {
  const { t } = useTranslation();
  const { shown, peak, downloading, active, history, testing, measuring, failed } = monitor;

  return (
    <div className="flex min-w-0 items-center gap-x-4 overflow-hidden">
      {downloading ? (
        <>
          <Rate
            icon={<Activity size={13} className="text-accent" />}
            label={t("speed_now")}
            bytesPerSecond={shown}
            language={language}
            strong
            withMegabits
          />
          <Sparkline values={history} />
          {/* Present from the first moment of the run, as a dash until there
              is a figure: appearing half a second in moved everything after it. */}
          <Rate
            icon={<Gauge size={13} />}
            label={t("speed_peak")}
            bytesPerSecond={peak}
            language={language}
          />
          <Stat icon={<ArrowDownToLine size={13} />} label={t("speed_active")}>
            <Figure value={formatCount(active, language)} width="2ch" />
          </Stat>
        </>
      ) : testing ? (
        <>
          <Rate
            icon={<Loader2 size={13} className="animate-spin text-accent" />}
            label={t("speed_testing")}
            bytesPerSecond={measuring}
            language={language}
            strong
            withMegabits
          />
          <Sparkline values={history} />
        </>
      ) : failed ? (
        <span className="flex items-center gap-1.5 text-danger-text" role="status">
          <AlertCircle size={13} className="shrink-0" />
          {t("error_network")}
        </span>
      ) : null}
    </div>
  );
}

/** The end zone: the last measurement of the line, and the way to take one. */
function Line({
  monitor,
  isOnline,
  language,
}: {
  monitor: Monitor;
  isOnline: boolean;
  language: string;
}) {
  const { t } = useTranslation();
  const { result, downloading, testing, run } = monitor;

  return (
    <div className="flex items-center gap-x-4">
      {result && (
        <>
          <Stat icon={<Zap size={13} />} label={t("speed_line")}>
            <BitRate bytesPerSecond={result.bytesPerSecond} language={language} />
          </Stat>
          {result.latencyMs > 0 && (
            // Its own item, label and number apart. It was a translated phrase
            // inside the same left-to-right span as "Mbps", which put the
            // Persian word on the wrong side of its number.
            <Stat icon={<Radar size={13} />} label={t("speed_ping_label")}>
              <Figure value={formatCount(result.latencyMs, language)} width="3ch" />
              <Unit>ms</Unit>
            </Stat>
          )}
        </>
      )}

      {/* Not while a download runs: the test would take its share of the line
          and both figures would be wrong. Disabled rather than hidden, so the
          end of the bar does not change length when a download starts. */}
      <ToolbarButton
        onClick={() => void run()}
        disabled={!isOnline || downloading || testing}
        icon={<Zap size={13} />}
      >
        {t(result ? "speed_test_again" : "speed_test")}
      </ToolbarButton>
    </div>
  );
}

/** Icon, label, then the figure in the writing direction's natural order. */
function Stat({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span className="flex shrink-0">{icon}</span>
      <span>{label}</span>
      {/* `bdi` + `ltr`: "12.4 MB/s" is a Latin unit after a number in every
          language, and letting the bidi algorithm reorder it would split the
          number from its unit. */}
      <bdi dir="ltr" className="flex items-baseline gap-1">
        {children}
      </bdi>
    </span>
  );
}

/** A number in a fixed-width slot, aligned to its unit. */
function Figure({
  value,
  width = "4.5ch",
  strong,
}: {
  value: string;
  width?: string;
  strong?: boolean;
}) {
  return (
    <span
      className={strong ? "tnum text-end font-medium text-fg" : "tnum text-end text-fg-soft"}
      style={{ minWidth: width }}
    >
      {value}
    </span>
  );
}

function BitRate({ bytesPerSecond, language }: { bytesPerSecond: number; language: string }) {
  const { value, unit } = bitRateParts(bytesPerSecond, language);
  return (
    <>
      <Figure value={value} />
      <Unit>{unit}</Unit>
    </>
  );
}

function Unit({ children }: { children: ReactNode }) {
  return <span className="min-w-[2.6ch] text-start">{children}</span>;
}

/**
 * A transfer rate, eased between samples so the digits roll rather than jump,
 * with its unit held steady across the KB/MB boundary.
 */
function Rate({
  icon,
  label,
  bytesPerSecond,
  language,
  strong,
  withMegabits,
}: {
  icon: ReactNode;
  label: string;
  bytesPerSecond: number;
  language: string;
  strong?: boolean;
  withMegabits?: boolean;
}) {
  const eased = useEased(bytesPerSecond);
  const step = useRef<number | undefined>(undefined);

  if (bytesPerSecond <= 0 && eased <= 0) {
    return (
      <Stat icon={icon} label={label}>
        <Figure value="—" strong={strong} />
        <Unit>{" "}</Unit>
      </Stat>
    );
  }

  const parts = speedParts(eased, language, step.current);
  step.current = parts.step;

  return (
    <Stat icon={icon} label={label}>
      <Figure value={parts.value} strong={strong} />
      <Unit>{parts.unit}</Unit>
      {withMegabits && (
        <span className="ms-1 flex items-baseline gap-1 opacity-80">
          <BitRate bytesPerSecond={eased} language={language} />
        </span>
      )}
    </Stat>
  );
}

/** A number that glides to each new target over a few hundred milliseconds. */
function useEased(target: number) {
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const controls = animate(current.current, target, {
      duration: 0.35,
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

/**
 * The last half minute of the rate as a small filled line. Scaled to its own
 * peak, because what it shows is the shape -- steady, climbing, stalling --
 * and the figure beside it already says the number.
 */
function Sparkline({ values }: { values: number[] }) {
  const id = useId().replace(/:/g, "");
  const width = 64;
  const height = 14;

  if (values.length < 2) {
    return <span className="shrink-0" style={{ width }} aria-hidden />;
  }

  const max = Math.max(...values, 1);
  const stepX = width / (values.length - 1);
  const points = values.map((value, index) => [
    index * stepX,
    height - 1 - (value / max) * (height - 2),
  ]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const area = `${line}L${width},${height}L0,${height}Z`;

  return (
    // Time runs left to right in every language, like every chart in the app;
    // SVG coordinates do not mirror, so nothing has to be pinned for that.
    <svg width={width} height={height} className="shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--color-accent)", stopOpacity: 0.35 }} />
          <stop offset="100%" style={{ stopColor: "var(--color-accent)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={area} style={{ fill: `url(#spark-${id})` }} />
      <path
        d={line}
        style={{ fill: "none", stroke: "var(--color-accent)", strokeWidth: 1.25 }}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
