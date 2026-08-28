import { Music2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLabel } from "../../components/ui/Card";
import { CheckRow } from "../../components/ui/CheckRow";
import { Segmented } from "../../components/ui/Segmented";
import {
  QUALITIES,
  qualityLabel,
  useDownloadSettings,
} from "../downloads/useDownloadSettings";

/**
 * What a download asks the site for.
 *
 * This was four buttons on the download form, re-answered for every link and
 * forgotten every time the screen was left. It is a standing preference -- how
 * big you want your files -- so it is set here once, and the form shows the
 * answer instead of asking the question.
 *
 * Video-or-MP3 is the same preference for the other half of the question, and
 * the same default: what a link is taken as unless the form says otherwise for
 * one particular link. The form can still say otherwise, because that is the
 * one choice here that genuinely changes between two videos -- and whatever it
 * says lands back in this setting.
 *
 * Audio has no quality to choose: yt-dlp is asked for the best MP3 it can make
 * either way. The note says so rather than leaving the section looking like it
 * only covers half of what the tool does.
 */
export function DownloadsPanel() {
  const { t } = useTranslation();
  const { settings, update } = useDownloadSettings();

  return (
    <>
      <section className="flex flex-col gap-2">
        <SectionLabel>{t("download_as")}</SectionLabel>
        <Segmented
          label={t("download_as")}
          value={settings.mediaType}
          onChange={(mediaType) => update("mediaType", mediaType)}
          options={[
            {
              value: "video" as const,
              label: t("download_type_video"),
              icon: <Video size={16} />,
            },
            {
              value: "audio" as const,
              label: t("download_type_audio"),
              icon: <Music2 size={16} />,
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>{t("video_quality")}</SectionLabel>
        <Segmented
          label={t("video_quality")}
          value={settings.quality}
          onChange={(quality) => update("quality", quality)}
          // Two rows of three. Six across is 48px a cell in the settings panel
          // of a 600px window, and "2160p" does not fit in 48px.
          columns={3}
          options={QUALITIES.map((value) => ({
            value,
            label: qualityLabel(value, t("quality_best")),
          }))}
        />
        <p className="text-xs text-fg-muted">{t("download_quality_note")}</p>
      </section>

      {/* A `switch`, not a `check`: it changes what the next download does the
          moment it moves, and there is no run button here to read it later.

          On by default, and it is the setting behind the app being fast --
          which is also why it is a setting at all rather than simply how
          downloads work. It is the one path that talks to a site's CDN
          differently from the way yt-dlp would, so the rare host that objects
          needs an answer that is not "wait for the next release". */}
      <section className="flex flex-col gap-2">
        <SectionLabel>{t("download_speed")}</SectionLabel>
        <CheckRow
          control="switch"
          label={t("download_parallel")}
          hint={t("download_parallel_hint")}
          checked={settings.parallel}
          onChange={(parallel) => update("parallel", parallel)}
        />
      </section>

      <p className="text-xs text-fg-muted">{t("download_audio_note")}</p>
    </>
  );
}
