import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { LANGUAGES, type AppLanguage } from "../../hooks/useAppPreferences";
// The window icon Tauri already ships, the same one `AppIdentity` draws --
// rather than a second mark that could drift from it.
import appIcon from "../../../src-tauri/icons/128x128.png";

interface Props {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  /** Answered. The dialog does not come back. */
  onDone: () => void;
}

/**
 * The first thing a new install shows: which language this is going to be in.
 *
 * It is asked here, once, rather than left to be discovered in Settings,
 * because the whole interface is in a language the user may not read -- and
 * "Settings" is one of the words they would have to read to get out of it. Two
 * of the three languages this app speaks are also right-to-left, so the wrong
 * default is not just wrong words but a mirrored window.
 *
 * The choice applies as it is made, before the dialog closes. That is the
 * feature, not a shortcut: the answer to "is this the right language" is the
 * interface itself changing under the pointer, which nobody has to read a label
 * to understand. The button below then only has to mean "yes, that one".
 *
 * The names are endonyms and are never translated -- see `LANGUAGES`. A dialog
 * whose whole purpose is to be legible to someone who cannot read the current
 * language cannot write the options in it.
 *
 * A click outside does not dismiss this. There is nothing behind it to click at
 * this point -- the app has just started -- so an outside click here is a miss,
 * not an intention. Escape still works, and is taken the same way the button is:
 * whatever is selected, kept, and not asked again.
 */
export function WelcomeDialog({ language, onLanguageChange, onDone }: Props) {
  const { t } = useTranslation();
  const selectedRef = useRef<HTMLButtonElement>(null);

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
            "fixed inset-0 z-50 bg-scrim backdrop-blur-sm",
            "data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-out-quart)]",
          )}
        />

        <Dialog.Content
          // Escape closes this and must not also reach NavigationProvider's
          // window listener, which reads the key as `back`. Same reasoning as
          // `Modal` and `ConfirmDialog`.
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onInteractOutside={(event) => event.preventDefault()}
          // Opens on the language that is already selected rather than on the
          // first of the three, so the arrow keys start where the user is.
          onOpenAutoFocus={(event) => {
            if (!selectedRef.current) return;
            event.preventDefault();
            selectedRef.current.focus();
          }}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))]",
            "-translate-x-1/2 -translate-y-1/2",
            // No `relative` beside the `fixed` above, however harmless it
            // looks: Tailwind emits the position utilities in its own order,
            // `relative` after `fixed`, so the pair does not mean "fixed, and a
            // containing block" -- it means relative, and the centring offsets
            // then measure from the end of the document rather than the
            // viewport, which puts the dialog below the fold. `fixed` is
            // already a containing block for the hairline below.
            "overflow-hidden rounded-xl border border-line-soft",
            "px-6 py-7 text-center shadow-(--shadow-panel)",
            "bg-surface-glass backdrop-blur-glass",
            // scale-in animates `scale`, not `transform`: the centring
            // utilities above compile to `translate`, and a transform in the
            // keyframe would add to them rather than replace them.
            "data-[state=open]:animate-[scale-in_var(--duration-base)_var(--ease-out-quart)]",
            "focus:outline-none",
          )}
        >
          {/* The gradient hairline every primary surface in the app carries. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-(image:--gradient-accent) opacity-40"
          />

          <div className="flex flex-col items-center gap-5">
            <img
              src={appIcon}
              alt=""
              aria-hidden
              // 128px asset drawn at 56 so it stays sharp on a HiDPI screen.
              className="size-14"
            />

            <div className="flex flex-col gap-1.5">
              <Dialog.Title className="text-xl font-semibold text-fg">
                {t("welcome_title")}
              </Dialog.Title>
              {/* `dir="auto"`: the app's name is Persian or Arabic in two of
                  the three languages and shapes in its own direction. */}
              <p dir="auto" className="text-sm font-medium text-accent">
                {t("app_name")}
              </p>
              <Dialog.Description className="text-sm text-fg-soft">
                {t("welcome_language")}
              </Dialog.Description>
            </div>

            {/* Radios, not buttons, for the same reason `Segmented` uses them:
                one choice out of three, with arrow keys and a group name that a
                screen reader announces as such. Three across at any width the
                window allows -- its minimum is 600px and this card is 448. */}
            <div
              role="radiogroup"
              aria-label={t("language")}
              className="grid w-full grid-cols-3 gap-2"
            >
              {LANGUAGES.map((option) => {
                const selected = option.value === language;
                return (
                  <button
                    key={option.value}
                    ref={selected ? selectedRef : undefined}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onLanguageChange(option.value)}
                    className={cn(
                      "relative flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-4",
                      "transition-all duration-(--duration-fast)",
                      selected
                        ? "border-accent-line bg-accent-soft text-accent shadow-(--shadow-glow)"
                        : "border-line bg-surface text-fg-soft hover:border-line-strong hover:bg-surface-hover hover:scale-[1.02]",
                    )}
                  >
                    {/* The tick is redundant with the accent border for anyone
                        who can see colour, and is the whole answer for anyone
                        who cannot. */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-1.5 end-1.5 transition-opacity duration-(--duration-fast)",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    >
                      <Check size={13} strokeWidth={2.5} />
                    </span>

                    {/* Each name in its own direction, whatever the interface's
                        is at this moment -- "العربية" inside an English window
                        still reads right to left. */}
                    <span dir="auto" className="text-base font-medium">
                      {option.label}
                    </span>
                    <span dir="ltr" className="text-[11px] tracking-wide text-fg-muted">
                      {option.code}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex w-full flex-col items-center gap-2">
              <Button
                variant="primary"
                // The one action on the screen, at the height the run button
                // on every form has.
                size="lg"
                className="w-full"
                onClick={onDone}
              >
                {t("welcome_start")}
              </Button>
              {/* Said here so the choice does not feel final. It is one line of
                  reassurance rather than a second control. */}
              <p className="text-xs text-fg-muted">{t("welcome_change_later")}</p>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
