import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field, SectionLabel } from "../../components/ui/Card";
import { CheckRow } from "../../components/ui/CheckRow";
import { Segmented } from "../../components/ui/Segmented";
import { Select } from "../../components/ui/Select";
import * as ipc from "../../lib/ipc";
import {
  AUDIO_FORMATS,
  NO_COOKIES,
  QUALITIES,
  qualityLabel,
  useDownloadSettings,
} from "../downloads/useDownloadSettings";

export function DownloadsPanel() {
  const { t } = useTranslation();
  const { settings, update } = useDownloadSettings();
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
        <SectionLabel>{t("video_quality")}</SectionLabel>
        <Segmented
          label={t("video_quality")}
          value={settings.quality}
          onChange={(quality) => update("quality", quality)}
          options={QUALITIES.map((value) => ({
            value,
            label: qualityLabel(value, t("quality_best_short")),
          }))}
        />
        <p className="text-xs text-fg-muted">{t("download_quality_note")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>{t("audio_format")}</SectionLabel>
        <Segmented
          label={t("audio_format")}
          value={settings.audioFormat}
          onChange={(audioFormat) => update("audioFormat", audioFormat)}
          options={AUDIO_FORMATS.map((format) => ({
            value: format,
            label: t(`audio_choice_${format}`),
          }))}
        />
        <p className="text-xs text-fg-muted">{t(`audio_format_${settings.audioFormat}_note`)}</p>
      </section>

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

      {browsers.length > 0 && (
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
                label: name.charAt(0).toUpperCase() + name.slice(1),
              })),
            ]}
          />
        </Field>
      )}
    </>
  );
}
