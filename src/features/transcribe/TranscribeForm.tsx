import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Settings2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { CheckRow } from "../../components/ui/CheckRow";
import { Select } from "../../components/ui/Select";
import { TextInput } from "../../components/ui/TextInput";
import { Card, Field } from "../../components/ui/Card";
import { cn } from "../../lib/cn";
import * as ipc from "../../lib/ipc";
import type { ToastType } from "../../types/feedback";
import type { TranscriptFormat } from "../jobs/types";
import {
  FileDropZone,
  FormatGroup,
  OutputFolderRow,
  PreferenceRow,
  RunButton,
} from "../media/components/ToolFormParts";
import { ToolDialog } from "../tools/ToolDialog";
import { ApiKeyPanel } from "../settings/ApiKeyPanel";
import { useDragDropState } from "../media/useDragDropState";
import { defaultOutputName, useMediaJob } from "../media/useMediaJob";
import { useMediaFile } from "../media/useMediaFile";
import { SPOKEN_LANGUAGES } from "./languages";
import { MODEL_IDS } from "./ModelPicker";
import { formatFor, useTranscribeSettings } from "./useTranscribeSettings";

const FORMATS: TranscriptFormat[] = ["txt", "srt", "vtt"];

/** Groq caps the hint at 224 tokens. Characters are not tokens, but this is the
 *  right order of magnitude in every script and is what the backend trims to. */
const MAX_PROMPT_CHARS = 800;

interface Props {
  initialFile?: string;
  isOnline: boolean;
  notify: (type: ToastType, message: string) => void;
  /** Closes the dialog. This tool calls it on the way to the transcript screen
   *  rather than back to its own list, so `back` from there lands on the list
   *  with the new job on it instead of on a reopened form. */
  onDone: () => void;
}

/**
 * The Whisper form.
 *
 * Only the form: starting a transcription hands off to the result route, which
 * owns the progress and the text. Everything here describes a run that has not
 * happened yet, and leaving it on screen beside a running job made it describe
 * nothing.
 */
export function TranscribeForm({ initialFile, isOnline, notify, onDone }: Props) {
  const { go, replace } = useNavigation();
  const { t } = useTranslation();

  const file = useMediaFile(initialFile);
  const job = useMediaJob("transcribe", "start_transcribe", notify);
  const isDragging = useDragDropState(file.acceptDrop);

  // Outlive this screen, so coming back from the result route finds the form as
  // it was left rather than reset to defaults.
  const { settings, update } = useTranscribeSettings();
  const format = formatFor(settings.format, Boolean(file.info?.video));

  // Auto-detect leads, and is the only entry whose label is translated -- the
  // rest are language names, which are written in their own language and so
  // read the same whichever one the interface is in.
  const languageOptions = useMemo(
    () => [
      { value: "", label: t("transcribe_language_auto") },
      ...SPOKEN_LANGUAGES.map((entry) => ({
        value: entry.code,
        label: entry.label,
      })),
    ],
    [t],
  );

  const [advanced, setAdvanced] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => job.followInput(file.path), [file.path]);

  useEffect(() => {
    void ipc
      .apiKeyStatus()
      .then((status) => setHasKey(status.present))
      .catch(() => setHasKey(false));
  }, []);

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

    // Record the file into this tool's own route *before* pushing the next one,
    // and close the form while doing it: the entry `back` returns to is the
    // list with this job at the top of it, not the form that started it. The
    // file is kept so that opening the form again begins where this one left
    // off rather than empty.
    replace({ name: "transcribe", file: file.path ?? undefined, composing: false });
    go({ name: "transcript", jobId: id });
  }, [file.path, format, go, job, prompt, replace, settings]);

  const ready = Boolean(
    file.path && file.info?.audio && job.outputDir && !job.busy && hasKey && isOnline,
  );

  return (
    <ToolDialog
      tool="transcribe"
      onClose={onDone}
      footer={
        <RunButton
          label={t("transcribe_start")}
          disabled={!ready}
          onClick={() => void start()}
        />
      }
    >
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

      {/* Outside the "has audio" gate, unlike everything below it: which model
          runs is true of this screen whether or not a file has been picked.
          It is a row rather than the two-card picker it used to be -- the
          choice between accuracy and speed is made once and then left alone,
          so it lives in Settings and this says which way it was made. */}
      <PreferenceRow
        icon={<Sparkles size={16} />}
        label={t("transcribe_model")}
        value={MODEL_IDS[settings.model]}
        section="transcription"
        // Same reason `start` does it below: the entry `back` from Settings
        // returns to has to know about the file, or the form is empty again.
        onBeforeLeave={() =>
          replace({
            name: "transcribe",
            file: file.path ?? undefined,
            composing: true,
          })
        }
      />

      {file.info?.audio && (
        <div className="flex flex-col gap-4">
          {/* One row, not two: both answer "what comes out", and each was
              spending a full line on a control a third of that wide. Stacks
              below sm, because the window minimum is 600px. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("transcribe_language")} htmlFor="spoken-language">
              {/* The one dropdown in this app. Every other choice here is
                  between three or four options and lies flat as a Segmented; a
                  hundred languages cannot, and cutting the list down to the
                  three the interface speaks would make the tool worse at the
                  job it exists to do. */}
              <Select
                id="spoken-language"
                value={settings.language}
                onChange={(value) => update("language", value)}
                options={languageOptions}
              />
            </Field>

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
                  "transition-transform duration-(--duration-fast)",
                  advanced && "rotate-180",
                )}
              />
            </button>

            {advanced && (
              <Card padding="sm" className="flex flex-col gap-4 bg-surface-soft">
                <CheckRow
                  label={t("transcribe_translate")}
                  hint={t("transcribe_translate_hint")}
                  checked={settings.translate}
                  onChange={(translate) => update("translate", translate)}
                />

                {/* A `Field`, like the language row above it. Hand-rolled, this
                    one had dropped `font-medium` from its label, so the two
                    labels on one screen sat at two different weights. */}
                <Field
                  label={t("transcribe_prompt")}
                  htmlFor="transcribe-prompt"
                  hint={t("transcribe_prompt_hint")}
                >
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
                </Field>
              </Card>
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
      {hasKey === false && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-soft">{t("api_key_needed_here")}</p>
          <ApiKeyPanel notify={notify} onStatusChange={setHasKey} />
          <p className="text-xs text-fg-muted">{t("api_key_note")}</p>
        </div>
      )}

      {!isOnline && (
        <p className="text-sm text-warning">{t("transcribe_needs_internet")}</p>
      )}
    </ToolDialog>
  );
}
