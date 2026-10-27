import type { ReactNode } from "react";
import { Activity, AlertCircle, Gauge, Loader2, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { formatCount, formatMegabits, formatSpeed } from "../../lib/format";
import { useSpeedMonitor } from "../../features/downloads/useSpeedMonitor";
import { jobsOfKind } from "../../features/jobs/selectors";
import { useJobs } from "../../features/jobs/useJobs";
import { ToolbarButton } from "../ui/ToolbarButton";

/**
 * The thin bar along the bottom of the window.
 *
 * On every screen, so the place for it is settled; what goes in it is not.
 * Only the download screen has anything to say so far, and the others leave it
 * empty rather than inventing something -- the bar is there for the next thing
 * that needs a line, not for decoration.
 *
 * Small on purpose: a status bar is read in passing. One line, 11px, no
 * controls bigger than their text.
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
  const onDownload = route.name === "download";

  // Here rather than in the download screen: a test that is running when the
  // user steps over to Settings should still finish, and a measurement should
  // survive the trip.
  const monitor = useSpeedMonitor({ jobs: downloads, isOnline, enabled: onDownload });

  return (
    <footer
      className="flex h-6 shrink-0 items-center gap-x-4 overflow-hidden border-t border-line bg-surface-soft px-3 text-[11px] leading-none text-fg-muted"
    >
      {onDownload && <DownloadStatus monitor={monitor} isOnline={isOnline} language={language} />}
    </footer>
  );
}

function DownloadStatus({
  monitor,
  isOnline,
  language,
}: {
  monitor: ReturnType<typeof useSpeedMonitor>;
  isOnline: boolean;
  language: string;
}) {
  const { t } = useTranslation();
  const { shown, peak, downloading, result, testing, measuring, failed, run } = monitor;

  // One answer at a time, in order of how much it matters right now: a
  // download that is moving, a test that is running, the connection being down,
  // then the last measurement.
  return (
    <>
      {downloading ? (
        <>
          <Item
            icon={<Activity size={11} />}
            label={t("speed_now")}
            value={shown > 0 ? formatSpeed(shown, language) : "—"}
            detail={shown > 0 ? formatMegabits(shown, language) : undefined}
            strong
          />
          {peak > 0 && (
            <Item
              icon={<Gauge size={11} />}
              label={t("speed_peak")}
              value={formatSpeed(peak, language)}
            />
          )}
        </>
      ) : testing ? (
        <Item
          icon={<Loader2 size={11} className="animate-spin" />}
          label={t("speed_testing")}
          value={measuring > 0 ? formatSpeed(measuring, language) : ""}
          detail={measuring > 0 ? formatMegabits(measuring, language) : undefined}
          strong
        />
      ) : failed ? (
        <span className="flex items-center gap-1.5 text-danger-text" role="status">
          <AlertCircle size={11} className="shrink-0" />
          {t("error_network")}
        </span>
      ) : result ? (
        <Item
          icon={<Zap size={11} />}
          label={t("speed_line")}
          value={formatSpeed(result.bytesPerSecond, language)}
          detail={[
            formatMegabits(result.bytesPerSecond, language),
            result.latencyMs > 0
              ? t("speed_ping", { ms: formatCount(result.latencyMs, language) })
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
          strong
        />
      ) : null}

      {/* Not while a download runs: the test would take its share of the line
          and both figures would be wrong. */}
      {!downloading && !testing && (
        <ToolbarButton
          className="ms-auto"
          onClick={() => void run()}
          disabled={!isOnline}
          icon={<Zap size={11} />}
        >
          {t(result ? "speed_test_again" : "speed_test")}
        </ToolbarButton>
      )}
    </>
  );
}

function Item({
  icon,
  label,
  value,
  detail,
  strong,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  strong?: boolean;
}) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
      {/* `ltr`: "12.4 MB/s" and "99 Mbps" are Latin units in every language,
          and mirroring them separates the number from its unit. */}
      <span dir="ltr" className={strong ? "font-medium text-fg tnum" : "text-fg-soft tnum"}>
        {value}
      </span>
      {detail && (
        <span dir="ltr" className="tnum opacity-80">
          {detail}
        </span>
      )}
    </p>
  );
}
