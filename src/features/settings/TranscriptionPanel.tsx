import { useTranslation } from "react-i18next";

import { ModelPicker } from "../transcribe/ModelPicker";
import { useTranscribeSettings } from "../transcribe/useTranscribeSettings";

/**
 * Which Whisper every transcription runs on.
 *
 * The picker used to be the first control on the transcribe form, above the
 * file it was going to be used on. That put a choice nobody makes twice -- the
 * two models differ in accuracy and speed, not in how they suit one recording
 * over another -- in front of the one thing that screen is for. It is a
 * preference, so it sits with the key it is billed against, and the form shows
 * which model is selected with a way back here.
 *
 * The API key is the other half of this section and stays where it was, below
 * this, because it is what the model needs in order to run at all.
 */
export function TranscriptionPanel() {
  const { t } = useTranslation();
  const { settings, update } = useTranscribeSettings();

  return (
    <section className="flex flex-col gap-2">
      <ModelPicker
        value={settings.model}
        onChange={(model) => update("model", model)}
        // "Translate to English" is still switched on per run, on the form, and
        // only large-v3 has a translations endpoint -- so turning it on there
        // moves this selection, and turbo is off the table here while it is on.
        turboDisabled={settings.translate}
      />
      <p className="text-xs text-fg-muted">{t("transcribe_model_note")}</p>
    </section>
  );
}
