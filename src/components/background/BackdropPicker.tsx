import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useRovingRadio } from "../../hooks/useRovingRadio";
import { cn } from "../../lib/cn";
import { BackdropLayers } from "./BackdropLayers";
import { BACKDROPS, type BackdropId } from "./backdrops";

/**
 * The backdrops as swatches: each one a small, still copy of the real drawing
 * -- the same layers, the same tint -- rather than a picture of it, so a
 * swatch can never show something the window will not.
 */
export function BackdropPicker({
  value,
  onChange,
}: {
  value: BackdropId;
  onChange: (next: BackdropId) => void;
}) {
  const { t } = useTranslation();
  const radio = useRovingRadio({ values: BACKDROPS, value, onChange });

  return (
    <div
      role="radiogroup"
      aria-label={t("backdrop")}
      onKeyDown={radio.onKeyDown}
      className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2"
    >
      {BACKDROPS.map((id) => {
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(id)}
            {...radio.itemProps(id)}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-lg border text-start",
              "transition-[border-color,box-shadow] duration-(--duration-fast)",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              selected
                ? "border-accent shadow-(--shadow-glow)"
                : "border-glass-line hover:border-line-strong",
            )}
          >
            <span className="relative block h-20 overflow-hidden">
              <span className="mtk-bg" data-preview data-still data-backdrop={id}>
                <span className="mtk-bg-base" />
                <BackdropLayers id={id} icons={false} />
                <span className="mtk-bg-vignette" />
              </span>
              {selected && (
                <span className="absolute end-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-on-accent">
                  <Check size={13} strokeWidth={3} />
                </span>
              )}
            </span>
            <span className="glass-inset border-t px-2.5 py-1.5 text-sm font-medium text-fg">
              {t(`backdrop_${id}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
