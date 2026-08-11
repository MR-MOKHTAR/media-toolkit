import type { ReactNode } from "react";
import { Check, Gauge, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import type { TranscribeModel } from "../jobs/types";

/** The wire identifiers, shown to the user as-is.
 *
 *  "Faster" and "More accurate" said nothing about what was actually being
 *  called, and anyone who knows Whisper knows these two names already. Pure
 *  Latin runs render left-to-right inside an RTL page on their own, so these
 *  need no `dir` of their own. */
export const MODEL_IDS: Record<TranscribeModel, string> = {
  whisperLargeV3: "whisper-large-v3",
  whisperLargeV3Turbo: "whisper-large-v3-turbo",
};

interface Props {
  value: TranscribeModel;
  onChange: (model: TranscribeModel) => void;
  /** Turbo has no translations endpoint at all, so choosing "translate to
   *  English" takes it off the table rather than letting Groq refuse the run. */
  turboDisabled: boolean;
}

/**
 * Which Whisper to run.
 *
 * A `Segmented` was doing this job, and it is the wrong control for it: the two
 * choices are not two words like "MP4 / MKV" but a real trade -- accuracy and
 * translation against speed -- and a segmented control gives that trade one
 * centred line of small grey text under a 20-character model id. At the window
 * minimum both ids wrapped mid-word and the hints were unreadable, which is why
 * the choice looked like something the app had already made for you.
 *
 * Two cards instead: the id, what it is for, and a badge saying which is the
 * default -- so the decision can be made by reading rather than by knowing. It
 * is also the first control on the form now instead of appearing only once a
 * file has been picked, because "which model" is a preference someone arrives
 * with, not one they form after choosing a file.
 *
 * Radios underneath, like `Segmented`: keyboard arrows, screen reader grouping
 * and form semantics come for free rather than being reimplemented badly.
 */
export function ModelPicker({ value, onChange, turboDisabled }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-fg-soft">{t("transcribe_model")}</p>
      <div
        role="radiogroup"
        aria-label={t("transcribe_model")}
        className="grid gap-2 sm:grid-cols-2"
      >
        <ModelCard
          id={MODEL_IDS.whisperLargeV3}
          icon={<Sparkles size={15} />}
          badge={t("transcribe_model_default")}
          hint={t("transcribe_model_large_hint")}
          selected={value === "whisperLargeV3"}
          onSelect={() => onChange("whisperLargeV3")}
        />
        <ModelCard
          id={MODEL_IDS.whisperLargeV3Turbo}
          icon={<Gauge size={15} />}
          badge={t("transcribe_model_fast")}
          hint={t("transcribe_model_turbo_hint")}
          selected={value === "whisperLargeV3Turbo"}
          disabledReason={
            turboDisabled ? t("transcribe_translate_needs_large") : undefined
          }
          onSelect={() => onChange("whisperLargeV3Turbo")}
        />
      </div>
    </div>
  );
}

function ModelCard({
  id,
  icon,
  badge,
  hint,
  selected,
  disabledReason,
  onSelect,
}: {
  id: string;
  icon: ReactNode;
  badge: string;
  hint: string;
  selected: boolean;
  /** Present means unavailable, and says why in place of the hint -- a card
   *  that is merely dimmed leaves the user clicking it to find out. */
  disabledReason?: string;
  onSelect: () => void;
}) {
  const disabled = disabledReason !== undefined;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-3 text-start",
        "transition-colors duration-[--duration-fast]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-accent-line bg-accent-soft"
          : "border-line bg-surface hover:enabled:border-line-strong hover:enabled:bg-surface-hover",
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("shrink-0", selected ? "text-accent" : "text-fg-muted")}>
          {icon}
        </span>
        {/* The id is Latin and machine-read, so it keeps its direction inside a
            Persian or Arabic window -- and truncates rather than wrapping
            mid-word, which is what the old control did at 600px. */}
        <span
          dir="ltr"
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            selected ? "font-medium text-accent" : "text-fg",
          )}
        >
          {id}
        </span>
        {/* The tick is what makes "selected" readable without relying on the
            tint alone, which is the whole of the state on a dark theme. */}
        {selected && <Check size={15} className="shrink-0 text-accent" />}
      </span>

      <span className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            // Outlined rather than filled: a tinted pill on the selected
            // card's own tint is a pill nobody can see.
            "rounded-full border px-1.5 py-0.5 text-[11px] leading-none",
            selected ? "border-accent-line text-accent" : "border-line text-fg-muted",
          )}
        >
          {badge}
        </span>
        <span className="text-xs text-fg-muted">{disabledReason ?? hint}</span>
      </span>
    </button>
  );
}
