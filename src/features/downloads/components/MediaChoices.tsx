import { useEffect, useState, type ReactNode } from "react";
import { Captions, Check, Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLabel } from "../../../components/ui/Card";
import { CheckRow } from "../../../components/ui/CheckRow";
import { Disclosure } from "../../../components/ui/Disclosure";
import { Segmented } from "../../../components/ui/Segmented";
import { TextInput } from "../../../components/ui/TextInput";
import { cn } from "../../../lib/cn";
import { formatBytes } from "../../../lib/format";
import type { MediaSummary } from "../../jobs/types";
import {
  audioSizeBytes,
  bestHeightLabel,
  clockOf,
  effectiveQuality,
  qualityChoices,
  secondsOf,
  videoSize,
} from "../downloadChoices";
import {
  AUDIO_FORMATS,
  qualityLabel,
  type DownloadSettings,
} from "../useDownloadSettings";

type Update = <K extends keyof DownloadSettings>(key: K, value: DownloadSettings[K]) => void;

export function VideoQualityPicker({
  summary,
  settings,
  update,
  language,
}: {
  summary: MediaSummary | null;
  settings: DownloadSettings;
  update: Update;
  language: string;
}) {
  const { t } = useTranslation();
  const choices = qualityChoices(summary);
  const chosen = effectiveQuality(summary, settings.quality);

  if (choices.length <= 1 && choices[0] === "best") {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>{t("video_quality")}</SectionLabel>
      <Segmented
        label={t("video_quality")}
        value={chosen}
        onChange={(quality) => update("quality", quality as DownloadSettings["quality"])}
        options={choices.map((value) => {
          const size = videoSize(summary, value, settings.codec);
          const topLabel = value === "best" ? bestHeightLabel(summary) : null;
          return {
            value,
            label:
              value === "best"
                ? topLabel
                  ? `${t("quality_best_short")} (${topLabel})`
                  : t("quality_best_short")
                : qualityLabel(value, ""),
            hint: size ? `≈ ${formatBytes(size, language)}` : undefined,
          };
        })}
      />
    </div>
  );
}

export function AudioFormatPicker({
  summary,
  durationSecs,
  settings,
  update,
  language,
}: {
  summary: MediaSummary | null;
  durationSecs: number | null;
  settings: DownloadSettings;
  update: Update;
  language: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>{t("audio_format")}</SectionLabel>
      <Segmented
        label={t("audio_format")}
        value={settings.audioFormat}
        onChange={(format) => update("audioFormat", format)}
        options={AUDIO_FORMATS.map((format) => {
          const bytes = audioSizeBytes(summary, durationSecs, format);
          return {
            value: format,
            label: t(`audio_choice_${format}`),
            hint: bytes ? `≈ ${formatBytes(bytes, language)}` : undefined,
          };
        })}
      />
    </div>
  );
}

export function MoreOptions({
  mediaType,
  summary,
  durationSecs,
  settings,
  update,
  section,
  onSectionChange,
  scheduleRow,
  folderRow,
  extraSummary,
}: {
  mediaType: "video" | "audio";
  summary: MediaSummary | null;
  durationSecs: number | null;
  settings: DownloadSettings;
  update: Update;
  section: { start: string; end: string } | null;
  onSectionChange: (section: { start: string; end: string } | null) => void;
  scheduleRow?: ReactNode;
  folderRow?: ReactNode;
  extraSummary?: string | null;
}) {
  const { t } = useTranslation();
  const video = mediaType === "video";

  const available = [
    ...(summary?.subtitles.map((sub) => sub.lang) ?? []),
    ...(summary?.autoCaptions ?? []),
  ].filter((lang, index, all) => all.indexOf(lang) === index);
  const subtitleChoices = available.length > 0 ? available.slice(0, 6) : ["fa", "en", "ar"];

  const summaryLine = [
    extraSummary,
    video && settings.subtitleLangs.length > 0
      ? `${t("subtitles")}: ${settings.subtitleLangs.join(", ")}`
      : null,
    section ? t("section_short") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const toggleLang = (lang: string) =>
    update(
      "subtitleLangs",
      settings.subtitleLangs.includes(lang)
        ? settings.subtitleLangs.filter((other) => other !== lang)
        : [...settings.subtitleLangs, lang],
    );

  return (
    <Disclosure
      label={t("more_options")}
      summary={summaryLine || undefined}
      open={settings.advancedOpen}
      onOpenChange={(open) => update("advancedOpen", open)}
    >
      {folderRow}
      {scheduleRow}

      {video && (!summary || available.length > 0) && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-fg-soft">
            <Captions size={15} className="shrink-0" />
            {t("subtitles")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {subtitleChoices.map((lang) => {
              const on = settings.subtitleLangs.includes(lang);
              return (
                <button
                  key={lang}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleLang(lang)}
                  className={cn(
                    "flex items-center gap-1 rounded-sm border px-2.5 py-1 text-xs transition-colors duration-(--duration-fast)",
                    on
                      ? "border-accent bg-accent-soft font-medium text-accent"
                      : "border-line bg-surface text-fg-soft hover:border-line-strong",
                  )}
                >
                  {on && <Check size={12} strokeWidth={2.5} className="shrink-0" />}
                  <span dir="ltr">{languageName(lang)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {video && durationSecs !== null && durationSecs > 0 && (
        <SectionRange durationSecs={durationSecs} section={section} onChange={onSectionChange} />
      )}
    </Disclosure>
  );
}

function SectionRange({
  durationSecs,
  section,
  onChange,
}: {
  durationSecs: number;
  section: { start: string; end: string } | null;
  onChange: (section: { start: string; end: string } | null) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(section ?? { start: "0:00", end: clockOf(durationSecs) });
  useEffect(() => {
    if (section) setDraft(section);
  }, [section]);

  const start = secondsOf(draft.start);
  const end = secondsOf(draft.end);
  const valid = start !== null && end !== null && end > start && end <= durationSecs + 1;

  return (
    <div className="flex flex-col gap-2">
      <CheckRow
        label={t("section_label")}
        hint={t("section_hint")}
        checked={section !== null}
        onChange={(on) => onChange(on ? draft : null)}
      />
      {section && (
        <div className="flex items-center gap-2 ps-7">
          <Clock3 size={14} className="shrink-0 text-fg-muted" />
          {(["start", "end"] as const).map((key) => (
            <TextInput
              key={key}
              size="sm"
              dir="ltr"
              aria-label={t(key === "start" ? "section_from" : "section_to")}
              value={draft[key]}
              onChange={(event) => {
                const next = { ...draft, [key]: event.target.value };
                setDraft(next);
                onChange(next);
              }}
              className={cn("w-24 text-center tnum", !valid && "border-danger")}
            />
          ))}
          {!valid && <span className="text-xs text-danger-text">{t("section_invalid")}</span>}
        </div>
      )}
    </div>
  );
}

function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}
