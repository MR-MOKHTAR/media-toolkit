import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { useRovingRadio } from "../../hooks/useRovingRadio";
import { cn } from "../../lib/cn";
import { LANGUAGES, type AppLanguage } from "../../hooks/useAppPreferences";

interface Props {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  onDone: () => void;
}

/**
 * First-launch language card, styled to match the standalone Settings card
 * with compact dimensions tailored to choosing and saving the app's language.
 */
export function WelcomeDialog({ language, onLanguageChange, onDone }: Props) {
  const { t } = useTranslation();
  const selectedRef = useRef<HTMLButtonElement>(null);
  const radio = useRovingRadio({
    values: LANGUAGES.map((option) => option.value),
    value: language,
    onChange: onLanguageChange,
  });

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onDone();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-scrim",
            "data-[state=open]:animate-[fade-in_var(--duration-fast)_var(--ease-out-quart)]",
          )}
        />

        <Dialog.Content
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            if (!selectedRef.current) return;
            event.preventDefault();
            selectedRef.current.focus();
          }}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex flex-col",
            "w-[min(30rem,calc(100vw-2rem))]",
            "-translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-panel)",
            "data-[state=open]:animate-[scale-in_var(--duration-base)_var(--ease-out-quart)]",
            "focus:outline-none",
          )}
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-3.5">
            <Globe size={17} className="shrink-0 text-fg-muted" />
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
              {t("language")}
            </Dialog.Title>
          </header>

          <div className="flex flex-col gap-5 p-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-fg">{t("welcome_title")}</h2>
              <Dialog.Description className="text-xs text-fg-muted">
                {t("welcome_language")}
              </Dialog.Description>
            </div>

            <div
              role="radiogroup"
              aria-label={t("language")}
              onKeyDown={radio.onKeyDown}
              className="flex flex-col gap-2"
            >
              {LANGUAGES.map((option) => {
                const selected = option.value === language;
                return (
                  <button
                    key={option.value}
                    {...radio.itemProps(option.value)}
                    ref={(node) => {
                      radio.itemProps(option.value).ref(node);
                      if (selected) selectedRef.current = node;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onLanguageChange(option.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onLanguageChange(option.value);
                        onDone();
                      }
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-start",
                      "transition-colors duration-(--duration-fast)",
                      selected
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line bg-surface-soft text-fg hover:border-line-strong hover:bg-surface-hover",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full border",
                        selected
                          ? "border-accent bg-accent text-on-accent"
                          : "border-line-strong",
                      )}
                    >
                      {selected && <Check size={11} strokeWidth={3} />}
                    </span>

                    <span dir="auto" className="min-w-0 flex-1 text-sm font-medium">
                      {option.label}
                    </span>

                    <span dir="ltr" className="text-xs font-medium tracking-wide text-fg-muted">
                      {option.code}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col items-center gap-2 pt-1">
              <Button variant="primary" size="lg" className="w-full" onClick={onDone}>
                {t("welcome_start")}
              </Button>
              <p className="text-center text-xs text-fg-muted">{t("welcome_change_later")}</p>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
