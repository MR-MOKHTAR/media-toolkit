import { useId, useRef, type ReactNode } from "react";
import { Activity, AlertCircle, ArrowDownToLine, Gauge, Loader2, Radar, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { bitRateParts, formatCount, speedParts } from "../../lib/format";
import { useSpeedMonitor } from "../../features/downloads/useSpeedMonitor";
import { jobsOfKind } from "../../features/jobs/selectors";
import { useJobs } from "../../features/jobs/useJobs";
import { ToolbarButton } from "../ui/ToolbarButton";

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
            <Stat icon={<Radar size={13} />} label={t("speed_ping_label")}>
              <Figure value={formatCount(result.latencyMs, language)} width="3ch" />
              <Unit>ms</Unit>
            </Stat>
          )}
        </>
      )}

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
      <bdi dir="ltr" className="flex items-baseline gap-1">
        {children}
      </bdi>
    </span>
  );
}

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
  const step = useRef<number | undefined>(undefined);

  if (bytesPerSecond <= 0) {
    return (
      <Stat icon={icon} label={label}>
        <Figure value="—" strong={strong} />
        <Unit>{"\u00a0"}</Unit>
      </Stat>
    );
  }

  const parts = speedParts(bytesPerSecond, language, step.current);
  step.current = parts.step;

  return (
    <Stat icon={icon} label={label}>
      <Figure value={parts.value} strong={strong} />
      <Unit>{parts.unit}</Unit>
      {withMegabits && (
        <span className="ms-1 flex items-baseline gap-1 opacity-80">
          <BitRate bytesPerSecond={bytesPerSecond} language={language} />
        </span>
      )}
    </Stat>
  );
}

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
    <svg width={width} height={height} className="shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--color-accent)", stopOpacity: 0.25 }} />
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
