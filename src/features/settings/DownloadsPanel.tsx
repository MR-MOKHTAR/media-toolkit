import { useEffect, useState } from "react";
import { FileAudio, Music2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Field, SectionLabel } from "../../components/ui/Card";
import { CheckRow } from "../../components/ui/CheckRow";
import { Segmented } from "../../components/ui/Segmented";
import { Select } from "../../components/ui/Select";
import * as ipc from "../../lib/ipc";
import {
  NO_COOKIES,
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
 * Audio has no *resolution* to choose, but it does have a format, and that is a
 * real question rather than a technicality: `Original` is the stream the site
 * served, handed over without being decoded, and MP3 is a re-encode that loses
 * something to produce a file some other program insists on. The row appears
 * only when audio is the selected type -- it has nothing to say about a video
 * download, and a control that is permanently irrelevant is worse than one that
 * comes and goes.
 */
export function DownloadsPanel() {
  const { t } = useTranslation();
  const { settings, update } = useDownloadSettings();
  /** Asked of the backend rather than listed here, so the browsers Settings
   *  offers are exactly the ones `download.rs` will accept. Empty until the
   *  answer lands, which hides the row rather than briefly offering nothing. */
  const [browsers, setBrowsers] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void ipc
      .getCookieBrowsers()
      .then((names) => {
        if (!cancelled) setBrowsers(names);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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

      {settings.mediaType === "audio" && (
        <section className="flex flex-col gap-2">
          <SectionLabel>{t("audio_format")}</SectionLabel>
          <Segmented
            label={t("audio_format")}
            value={settings.audioFormat}
            onChange={(audioFormat) => update("audioFormat", audioFormat)}
            options={[
              {
                value: "original" as const,
                label: t("audio_format_original"),
                icon: <FileAudio size={16} />,
              },
              {
                value: "mp3" as const,
                label: "MP3",
                icon: <Music2 size={16} />,
              },
            ]}
          />
          <p className="text-xs text-fg-muted">
            {t(
              settings.audioFormat === "original"
                ? "audio_format_original_note"
                : "audio_format_mp3_note",
            )}
          </p>
        </section>
      )}

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

      {/* Last, and off by default. Reading a browser's cookie jar is a thing
          to opt into rather than to discover the app has been doing -- and it
          is the only setting here that touches anything outside this app.

          A Select rather than the Segmented every other choice on this panel
          uses: nine browsers plus "none" is not a row of buttons, and unlike
          quality or format this is a list where one entry is right and the
          other nine are irrelevant to any given machine. */}
      {browsers.length > 0 && (
        // `Field`, not the `SectionLabel` the rows above use: this is one
        // control with a real <label> pointing at it, and a Select needs that
        // association to be announced at all.
        <Field
          label={t("cookies_from")}
          htmlFor="cookies-from"
          hint={t("cookies_hint")}
        >
          <Select
            id="cookies-from"
            value={settings.cookiesFrom}
            onChange={(value) => update("cookiesFrom", value)}
            options={[
              { value: NO_COOKIES, label: t("cookies_none") },
              ...browsers.map((name) => ({
                value: name,
                // yt-dlp's own spelling, capitalised for a label. These are
                // product names, so they are not translated.
                label: name.charAt(0).toUpperCase() + name.slice(1),
              })),
            ]}
          />
        </Field>
      )}

      <p className="text-xs text-fg-muted">{t("download_audio_note")}</p>
    </>
  );
}
