import { useEffect, useState } from "react";
import { Captions, Check, Clock3, FileAudio, Music2, Sparkles, Waves } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ControlGroup } from "../../../components/ui/Card";
import { CheckRow } from "../../../components/ui/CheckRow";
import { Disclosure } from "../../../components/ui/Disclosure";
import { Segmented } from "../../../components/ui/Segmented";
import { TextInput } from "../../../components/ui/TextInput";
import { cn } from "../../../lib/cn";
import { formatBytes } from "../../../lib/format";
import type { AudioFormatChoice, CodecPref, MediaSummary } from "../../jobs/types";
import {
  audioChoiceInfo,
  clockOf,
  effectiveQuality,
  maxCompatibleHeight,
  qualityChoices,
  qualityTag,
  secondsOf,
  videoSize,
} from "../downloadChoices";
import {
  AUDIO_FORMATS,
  CODEC_PREFS,
  MP3_BITRATES,
  qualityLabel,
  type DownloadSettings,
} from "../useDownloadSettings";

type Update = <K extends keyof DownloadSettings>(key: K, value: DownloadSettings[K]) => void;

/**
 * The resolutions this video has, each with what it would weigh.
 *
 * Built from the probe, not from a fixed list: a video that tops out at 720p
 * offers 720p and below, and the chip the remembered setting lands on is the
 * one that will actually download. With no probe -- a batch, a playlist -- the
 * standing list stands in, and the backend's `res:` sort does the clamping.
 */
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
  const compatibleCap = maxCompatibleHeight(summary);

  return (
    <Segmented
      label={t("video_quality")}
      value={chosen}
      onChange={(quality) => update("quality", quality as DownloadSettings["quality"])}
      columns={choices.length > 4 ? 4 : undefined}
      options={choices.map((value) => {
        const size = videoSize(summary, value, settings.codec);
        const tag = value === "best" ? null : qualityTag(summary, value);
        // In "compatible" mode a resolution H.264 does not reach would
        // quietly come down to the largest it does; said, rather than offered.
        const beyondCompatible =
          settings.codec === "compatible" &&
          compatibleCap !== null &&
          value !== "best" &&
          Number(value) > compatibleCap;
        return {
          value,
          label: value === "best" ? t("quality_best_short") : (tag ?? qualityLabel(value, "")),
          hint: size ? `≈ ${formatBytes(size, language)}` : value === "best" && summary?.heights[0]
            ? `${summary.heights[0].height}p`
            : undefined,
          disabled: beyondCompatible,
          disabledReason: beyondCompatible
            ? t("codec_compatible_cap", { height: compatibleCap })
            : undefined,
        };
      })}
    />
  );
}

/**
 * What an audio download ends up as, with what each choice means for this
 * page: which codec and bitrate the site serves, whether it is a copy, and how
 * big. MP3's bitrate is asked only once MP3 is chosen.
 */
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
  const icons: Record<AudioFormatChoice, typeof FileAudio> = {
    original: FileAudio,
    m4a: Music2,
    opus: Waves,
    mp3: Music2,
  };
  const current = audioChoiceInfo(summary, durationSecs, settings.audioFormat, settings.mp3Bitrate);

  return (
    <ControlGroup>
      <Segmented
        label={t("audio_format")}
        value={settings.audioFormat}
        onChange={(format) => update("audioFormat", format)}
        options={AUDIO_FORMATS.map((format) => {
          const info = audioChoiceInfo(summary, durationSecs, format, settings.mp3Bitrate);
          const Icon = icons[format];
          return {
            value: format,
            label: t(`audio_choice_${format}`),
            icon: <Icon size={16} />,
            hint: info.sizeBytes ? `≈ ${formatBytes(info.sizeBytes, language)}` : undefined,
          };
        })}
      />

      {settings.audioFormat === "mp3" && (
        <Segmented
          label={t("mp3_bitrate")}
          value={String(settings.mp3Bitrate)}
          onChange={(value) => update("mp3Bitrate", Number(value))}
          options={MP3_BITRATES.map((kbps) => ({
            value: String(kbps),
            label: kbps ? `${kbps}k` : t("mp3_best"),
          }))}
        />
      )}

      {/* What will happen, in one line: the codec and bitrate, and whether it
          is the site's own file or a re-encode. */}
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Sparkles size={12} className="shrink-0" />
        {/* The codec tag is Latin; isolated so it does not reorder the
            Persian or Arabic words after it. */}
        {current.tag && (
          <>
            <bdi dir="ltr">{current.tag}</bdi>
            <span aria-hidden>·</span>
          </>
        )}
        <span>{current.copy ? t("audio_kept_as_is") : t("audio_reencoded")}</span>
      </p>
    </ControlGroup>
  );
}

/**
 * Everything past resolution and format: codec preference, container,
 * subtitles, tags and cover, SponsorBlock, a time range. Closed by default and
 * remembered open; its summary line says what in it is set.
 */
export function MoreOptions({
  mediaType,
  summary,
  durationSecs,
  isYouTube,
  settings,
  update,
  section,
  onSectionChange,
}: {
  mediaType: "video" | "audio";
  summary: MediaSummary | null;
  durationSecs: number | null;
  isYouTube: boolean;
  settings: DownloadSettings;
  update: Update;
  section: { start: string; end: string } | null;
  onSectionChange: (section: { start: string; end: string } | null) => void;
}) {
  const { t } = useTranslation();
  const video = mediaType === "video";

  const available = [
    ...(summary?.subtitles.map((sub) => sub.lang) ?? []),
    ...(summary?.autoCaptions ?? []),
  ].filter((lang, index, all) => all.indexOf(lang) === index);
  const subtitleChoices = available.length > 0 ? available : ["fa", "en", "ar"];

  const summaryLine = [
    video && settings.codec !== "auto" ? t(`codec_${settings.codec}`) : null,
    video && settings.container === "mkv" ? "MKV" : null,
    video && settings.subtitleLangs.length > 0
      ? `${t("subtitles")}: ${settings.subtitleLangs.join(", ")}`
      : null,
    settings.sponsorBlock && isYouTube ? "SponsorBlock" : null,
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
      summary={summaryLine || t("more_options_hint")}
      open={settings.advancedOpen}
      onOpenChange={(open) => update("advancedOpen", open)}
    >
      {video && (
        <>
          <ControlGroup>
            <Segmented
              label={t("codec_pref")}
              value={settings.codec}
              onChange={(codec: CodecPref) => update("codec", codec)}
              options={CODEC_PREFS.map((codec) => ({
                value: codec,
                label: t(`codec_${codec}`),
              }))}
            />
            <p className="text-xs text-fg-muted">{t(`codec_${settings.codec}_hint`)}</p>
          </ControlGroup>

          <Segmented
            label={t("container")}
            value={settings.container}
            onChange={(container) => update("container", container)}
            options={[
              { value: "mp4" as const, label: "MP4", hint: t("container_mp4_hint") },
              { value: "mkv" as const, label: "MKV", hint: t("container_mkv_hint") },
            ]}
          />

          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-fg-soft">
              <Captions size={15} className="shrink-0" />
              {t("subtitles")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {subtitleChoices.map((lang) => {
                const on = settings.subtitleLangs.includes(lang);
                const auto = summary !== null && !summary.subtitles.some((sub) => sub.lang === lang);
                return (
                  <button
                    key={lang}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleLang(lang)}
                    className={cn(
                      "flex items-center gap-1 rounded-sm border px-2.5 py-1 text-sm transition-colors duration-(--duration-fast)",
                      on
                        ? "border-accent-line bg-accent-soft text-accent"
                        : "border-line bg-surface/65 text-fg-soft hover:border-line-strong",
                    )}
                  >
                    {on && <Check size={13} strokeWidth={2.5} className="shrink-0" />}
                    <span dir="ltr">{languageName(lang)}</span>
                    {auto && <span className="text-xs opacity-70">{t("subtitles_auto")}</span>}
                  </button>
                );
              })}
            </div>
            {summary && available.length === 0 && (
              <p className="text-xs text-fg-muted">{t("subtitles_none_here")}</p>
            )}
            {settings.subtitleLangs.length > 0 && (
              <CheckRow
                label={t("subtitles_embed")}
                hint={t("subtitles_embed_hint")}
                checked={settings.subtitleEmbed}
                onChange={(embed) => update("subtitleEmbed", embed)}
              />
            )}
          </div>
        </>
      )}

      <CheckRow
        label={t("embed_metadata")}
        hint={t("embed_metadata_hint")}
        checked={settings.embedMetadata}
        onChange={(value) => update("embedMetadata", value)}
      />
      {!video && (
        <CheckRow
          label={t("embed_cover")}
          hint={t("embed_cover_hint")}
          checked={settings.embedCover}
          onChange={(value) => update("embedCover", value)}
        />
      )}

      {isYouTube && (
        <CheckRow
          label={t("sponsorblock")}
          hint={t("sponsorblock_hint")}
          checked={settings.sponsorBlock}
          onChange={(value) => update("sponsorBlock", value)}
        />
      )}

      {video && durationSecs !== null && durationSecs > 0 && (
        <SectionRange durationSecs={durationSecs} section={section} onChange={onSectionChange} />
      )}
    </Disclosure>
  );
}

/** Fetch only part of the video: two time fields, off until switched on. */
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

/** A language code as its own name ("فارسی", "English"), via Intl. */
function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}
