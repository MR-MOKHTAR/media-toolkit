import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "../../../lib/cn";
import { formatCount, formatDuration } from "../../../lib/format";
import type { PlaylistListing } from "../../jobs/types";

export function PlaylistPicker({
  listing,
  loading,
  failed,
  selected,
  onSelectedChange,
}: {
  listing: PlaylistListing | null;
  loading: boolean;
  failed: boolean;
  selected: Set<string>;
  onSelectedChange: (selected: Set<string>) => void;
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
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
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
        <ul className="max-h-48 overflow-y-auto py-1">
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
                      className="h-7 w-12 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <span className="h-7 w-12 shrink-0 rounded-sm bg-surface-soft" />
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
    </div>
  );
}
