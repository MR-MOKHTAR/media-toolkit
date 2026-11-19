import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CheckRow } from "../../../components/ui/CheckRow";
import { cn } from "../../../lib/cn";
import { formatCount, formatDuration } from "../../../lib/format";
import type { PlaylistListing } from "../../jobs/types";

/**
 * The videos of a playlist, to pick from.
 *
 * "All of them" used to mean all of them -- the first hundred, queued blind.
 * The listing is fetched as soon as the whole playlist is asked for, and every
 * entry starts ticked, so the common case is still one press; leaving out the
 * three you already have is now a few clicks rather than three cancels.
 */
export function PlaylistPicker({
  listing,
  loading,
  failed,
  selected,
  onSelectedChange,
  folder,
  onFolderChange,
  numbers,
  onNumbersChange,
}: {
  listing: PlaylistListing | null;
  loading: boolean;
  failed: boolean;
  selected: Set<string>;
  onSelectedChange: (selected: Set<string>) => void;
  folder: boolean;
  onFolderChange: (value: boolean) => void;
  numbers: boolean;
  onNumbersChange: (value: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set());

  if (loading) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-fg-muted" role="status">
        <Loader2 size={12} className="shrink-0 animate-spin" />
        {t("playlist_loading")}
      </p>
    );
  }
  if (failed || !listing) {
    return failed ? <p className="text-xs text-danger-text">{t("playlist_failed")}</p> : null;
  }

  const entries = listing.entries;
  const allOn = selected.size === entries.length;
  const toggle = (url: string) => {
    const next = new Set(selected);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    onSelectedChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="glass-inset overflow-hidden rounded-lg border">
        <div className="flex items-center gap-2 border-b border-glass-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg-soft">
            {t("playlist_selected", {
              selected: formatCount(selected.size, i18n.language),
              total: formatCount(entries.length, i18n.language),
            })}
          </span>
          <button
            type="button"
            onClick={() =>
              onSelectedChange(allOn ? new Set() : new Set(entries.map((entry) => entry.url)))
            }
            className="rounded-sm px-2 py-0.5 text-xs text-accent transition-colors hover:bg-accent-soft"
          >
            {allOn ? t("playlist_select_none") : t("playlist_select_all")}
          </button>
        </div>
        <ul className="max-h-56 overflow-y-auto py-1">
          {entries.map((entry, index) => {
            const on = selected.has(entry.url);
            return (
              <li key={entry.url}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(entry.url)}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-start transition-colors hover:bg-surface-hover"
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                      on ? "border-accent bg-accent text-on-accent" : "border-line-strong",
                    )}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="w-6 shrink-0 text-end text-xs text-fg-muted tnum">
                    {formatCount(index + 1, i18n.language)}
                  </span>
                  {entry.thumbnail && !failedThumbs.has(entry.url) ? (
                    <img
                      src={entry.thumbnail}
                      alt=""
                      loading="lazy"
                      onError={() => setFailedThumbs((current) => new Set(current).add(entry.url))}
                      className="h-8 w-14 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <span className="h-8 w-14 shrink-0 rounded-sm bg-surface-soft" />
                  )}
                  <span className={cn("min-w-0 flex-1 truncate text-sm", on ? "text-fg" : "text-fg-muted")}>
                    {entry.title}
                  </span>
                  {entry.durationSecs ? (
                    <span dir="ltr" className="shrink-0 text-xs text-fg-muted tnum">
                      {formatDuration(entry.durationSecs)}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {listing.truncated && (
        <p className="text-xs text-warning-text">
          {t("playlist_truncated", {
            shown: formatCount(entries.length, i18n.language),
            total: formatCount(listing.total, i18n.language),
          })}
        </p>
      )}

      <CheckRow
        label={t("playlist_folder")}
        hint={listing.title ? t("playlist_folder_hint", { name: listing.title }) : t("playlist_folder_hint_plain")}
        checked={folder}
        onChange={onFolderChange}
      />
      <CheckRow
        label={t("playlist_numbers")}
        hint={t("playlist_numbers_hint")}
        checked={numbers}
        onChange={onNumbersChange}
      />
    </div>
  );
}
