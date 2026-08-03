import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { Segmented } from "../../components/ui/Segmented";
import { TextInput } from "../../components/ui/TextInput";
import { cn } from "../../lib/cn";
import * as ipc from "../../lib/ipc";
import type { AppLanguage } from "../../hooks/useAppPreferences";
import type { ToastType } from "../../types/feedback";
import { formatMinutes, formatWait } from "../jobs/errorText";
import type { Quota, TranscribeModel, TranscriptFormat } from "../jobs/types";
import {
  FileDropZone,
  FormatGroup,
  OutputFolderRow,
  RunButton,
  ToolShell,
} from "../media/components/ToolShell";
import { ApiKeyPanel } from "../settings/ApiKeyPanel";
import { useDragDropState } from "../media/useDragDropState";
import { defaultOutputName, useMediaJob } from "../media/useMediaJob";
import { useMediaFile } from "../media/useMediaFile";
import { SPOKEN_LANGUAGES } from "./languages";
import { formatFor, useTranscribeSettings } from "./useTranscribeSettings";

const FORMATS: TranscriptFormat[] = ["txt", "srt", "vtt"];

/** The wire identifiers, shown to the user as-is.
 *
 *  "Faster" and "More accurate" said nothing about what was actually being
 *  called, and anyone who knows Whisper knows these two names already. Pure
 *  Latin runs render left-to-right inside an RTL page on their own, so these
 *  need no `dir` of their own. */
const MODEL_IDS: Record<TranscribeModel, string> = {
  whisperLargeV3: "whisper-large-v3",
  whisperLargeV3Turbo: "whisper-large-v3-turbo",
};

/** Groq caps the hint at 224 tokens. Characters are not tokens, but this is the
 *  right order of magnitude in every script and is what the backend trims to. */
const MAX_PROMPT_CHARS = 800;

interface Props {
  initialFile?: string;
  language: AppLanguage;
  isOnline: boolean;
  notify: (type: ToastType, message: string) => void;
}

/**
 * The Whisper form.
 *
 * Only the form: starting a transcription hands off to the result route, which
 * owns the progress and the text. Everything here describes a run that has not
 * happened yet, and leaving it on screen beside a running job made it describe
 * nothing.
 */
export function TranscribeScreen({ initialFile, language, isOnline, notify }: Props) {
  const { go, replace } = useNavigation();
  const { t } = useTranslation();

  const file = useMediaFile(initialFile);
  // Does not open the history panel: this tool goes to its own result screen,
  // which shows the same progress plus the thing history cannot show -- the
  // text.
  const job = useMediaJob("transcribe", "start_transcribe", notify, {
    openHistoryOnStart: false,
  });
  const isDragging = useDragDropState(file.acceptDrop);

  // Outlive this screen, so coming back from the result route finds the form as
  // it was left rather than reset to defaults.
  const { settings, update } = useTranscribeSettings();
  const format = formatFor(settings.format, Boolean(file.info?.video));

  const [advanced, setAdvanced] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [needed, setNeeded] = useState<number | null>(null);

  useEffect(() => job.followInput(file.path), [file.path]);

  useEffect(() => {
    void ipc
      .apiKeyStatus()
      .then((status) => setHasKey(status.present))
      .catch(() => setHasKey(false));
  }, []);

  // Per model, because the budgets are separate -- which is the whole reason
  // "try the other model" is real advice rather than a platitude.
  useEffect(() => {
    let cancelled = false;
    void ipc
      .groqQuota(settings.model)
      .then((value) => !cancelled && setQuota(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settings.model]);

  useEffect(() => {
    if (!file.info) {
      setNeeded(null);
      return;
    }
    let cancelled = false;
    void ipc
      .estimateTranscribeSecs(file.info.durationSecs)
      .then((secs) => !cancelled && setNeeded(secs))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [file.info]);

  // Translation only exists on large-v3, so choosing it picks the model too
  // rather than letting the request fail at Groq.
  useEffect(() => {
    if (settings.translate) update("model", "whisperLargeV3");
  }, [settings.translate]);

  const start = useCallback(async () => {
    const id = await job.run(
      {
        input: file.path,
        outputName: defaultOutputName(file.path),
        model: settings.model,
        language: settings.language || undefined,
        translate: settings.translate,
        format,
        prompt: prompt.trim() || undefined,
      },
      `${defaultOutputName(file.path)}.${format}`,
      format.toUpperCase(),
    );
    if (!id) return;

    // Record the file into this screen's own route *before* pushing the next
    // one, so the entry `back` returns to still has it and the form is not
    // empty when the user comes back to run another.
    if (file.path) replace({ name: "transcribe", file: file.path });
    go({ name: "transcript", jobId: id });
  }, [file.path, format, go, job, prompt, replace, settings]);

  const ready = Boolean(
    file.path && file.info?.audio && job.outputDir && !job.busy && hasKey && isOnline,
  );

  return (
    <ToolShell subtitle={t("tool_transcribe_about")}>
      <FileDropZone
        path={file.path}
        info={file.info}
        loading={file.loading}
        isDragging={isDragging}
        onBrowse={() => void file.browse()}
      />

      {file.info && !file.info.audio && (
        <p className="text-sm text-danger">{t("transcribe_no_audio")}</p>
      )}

      {file.info?.audio && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-fg-soft">{t("transcribe_model")}</p>
            <Segmented
              label={t("transcribe_model")}
              value={settings.model}
              onChange={(value) => update("model", value as TranscribeModel)}
              options={[
                {
                  value: "whisperLargeV3",
                  label: MODEL_IDS.whisperLargeV3,
                  hint: t("transcribe_model_large_hint"),
                },
                {
                  value: "whisperLargeV3Turbo",
                  label: MODEL_IDS.whisperLargeV3Turbo,
                  hint: t("transcribe_model_turbo_hint"),
                  // Turbo has no translations endpoint at all.
                  disabled: settings.translate,
                  disabledReason: t("transcribe_translate_needs_large"),
                },
              ]}
            />
          </div>

          {/* One row, not two: both answer "what comes out", and each was
              spending a full line on a control a third of that wide. Stacks
              below sm, because the window minimum is 600px. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="spoken-language"
                className="text-sm font-medium text-fg-soft"
              >
                {t("transcribe_language")}
              </label>
              {/* The one dropdown in this app. Every other choice here is
                  between three or four options and lies flat as a Segmented; a
                  hundred languages cannot, and cutting the list down to the
                  three the interface speaks would make the tool worse at the
                  job it exists to do. */}
              <select
                id="spoken-language"
                value={settings.language}
                onChange={(event) => update("language", event.target.value)}
                className={cn(
                  "h-10 w-full rounded-md border border-line bg-surface px-3",
                  "text-base text-fg transition-colors duration-[--duration-fast]",
                  "hover:border-line-strong focus:border-accent focus:outline-none",
                )}
              >
                <option value="">{t("transcribe_language_auto")}</option>
                {SPOKEN_LANGUAGES.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>

            <FormatGroup
              title={t("transcribe_format")}
              formats={FORMATS}
              value={format}
              onChange={(value) => update("format", value as TranscriptFormat)}
            />
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-expanded={advanced}
              onClick={() => setAdvanced((open) => !open)}
              className="flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg-soft"
            >
              <Settings2 size={14} />
              {t("transcribe_advanced")}
              <ChevronDown
                size={14}
                className={cn(
                  "transition-transform duration-[--duration-fast]",
                  advanced && "rotate-180",
                )}
              />
            </button>

            {advanced && (
              <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-soft p-3">
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={settings.translate}
                    onChange={(event) => update("translate", event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-[--color-accent]"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm text-fg">{t("transcribe_translate")}</span>
                    <span className="text-xs text-fg-muted">
                      {t("transcribe_translate_hint")}
                    </span>
                  </span>
                </label>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="transcribe-prompt" className="text-sm text-fg-soft">
                    {t("transcribe_prompt")}
                  </label>
                  {/* Not dir="ltr": this holds Persian and Arabic names at
                      least as often as English ones, so it takes its direction
                      from what is typed into it. */}
                  <TextInput
                    id="transcribe-prompt"
                    dir="auto"
                    value={prompt}
                    maxLength={MAX_PROMPT_CHARS}
                    placeholder={t("transcribe_prompt_placeholder")}
                    onChange={(event) => setPrompt(event.target.value)}
                  />
                  <p className="text-xs text-fg-muted">{t("transcribe_prompt_hint")}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <OutputFolderRow folder={job.outputDir} onChoose={() => void job.chooseFolder()} />

      {/* The key is entered here, not behind a trip to Settings and back. It
          is the one thing standing between a chosen file and a transcription,
          so asking for it in place -- with the same panel Settings shows, so
          there is only one of them to maintain -- turns a three-navigation
          detour into typing in a box. It stays in Settings too, which is where
          someone goes to change a key rather than to add one. */}
      {hasKey === false ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-soft">{t("api_key_needed_here")}</p>
          <ApiKeyPanel notify={notify} onStatusChange={setHasKey} />
          <p className="text-xs text-fg-muted">{t("api_key_note")}</p>
        </div>
      ) : (
        <QuotaLine
          quota={quota}
          needed={needed}
          model={settings.model}
          language={language}
        />
      )}

      {!isOnline && (
        <p className="text-sm text-warning">{t("transcribe_needs_internet")}</p>
      )}

      <RunButton
        label={t("transcribe_start")}
        disabled={!ready}
        onClick={() => void start()}
      />
    </ToolShell>
  );
}

/**
 * What this file will cost against what is left.
 *
 * Warns, never blocks. The count is kept on this machine and cannot see the
 * same key used from a phone, a script or another app, so it can only ever be
 * optimistic -- and disabling the one button someone came here to press, on a
 * guess that may be wrong, is worse than letting Groq answer for itself. The
 * single exception is a pause Groq actually asked for.
 */
function QuotaLine({
  quota,
  needed,
  model,
  language,
}: {
  quota: Quota | null;
  needed: number | null;
  model: TranscribeModel;
  language: AppLanguage;
}) {
  const { t } = useTranslation();
  if (!quota) return null;

  const hourLeft = Math.max(0, quota.hourLimit - quota.hourUsed);
  const dayLeft = Math.max(0, quota.dayLimit - quota.dayUsed);

  if (quota.blockedForSecs !== null) {
    return (
      <p className="text-sm text-danger">
        {t("quota_blocked", { reset: formatWait(quota.blockedForSecs, t, language) })}
      </p>
    );
  }

  const tight = needed !== null && (needed > hourLeft || needed > dayLeft);

  return (
    <div className="flex flex-col gap-1">
      <p className={cn("text-xs", tight ? "text-warning" : "text-fg-muted")}>
        {t("quota_for_model", {
          model: MODEL_IDS[model],
          left: formatMinutes(hourLeft, language),
          day: formatMinutes(dayLeft, language),
        })}
      </p>
      {needed !== null && (
        <p className={cn("text-xs", tight ? "text-warning" : "text-fg-muted")}>
          {t("quota_needs", { needed: formatMinutes(needed, language) })}
        </p>
      )}
      {tight && <p className="text-xs text-warning">{t("quota_try_other_model")}</p>}
    </div>
  );
}
