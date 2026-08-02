import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import type { TranscriptFormat } from "../jobs/types";

/**
 * The transcript itself: one box that holds text and scrolls.
 *
 * Sized by its parent rather than by a `max-height` of its own. It used to cap
 * at 320px, which in the default 740px window left the thing the whole screen
 * exists for using under half the height with empty space above and below it.
 * The flex default (`flex: 0 1 auto`) plus `min-h-0` and `overflow-y-auto` --
 * set here so the box owns its own scrolling -- means it grows to fit a short
 * transcript and stops at whatever the window allows for a long one.
 *
 * A reading surface, so the type is document-sized rather than UI-sized. This
 * app's scale is deliberately compact -- `text-base` is 14px, not 16 -- which is
 * right for labels and controls and too small for a page of prose, so the
 * transcript takes `text-lg` and is the largest thing on the screen. Everything
 * around it, the file name included, is chrome and stays smaller.
 */
export function TranscriptPanel({
  text,
  format,
}: {
  text: string;
  format: TranscriptFormat;
}) {
  const { t } = useTranslation();
  const cues = format === "txt" ? null : parseCues(text);

  return (
    <div className="min-h-40 min-w-0 overflow-y-auto rounded-lg border border-line bg-surface p-4">
      {text.trim() === "" ? (
        <p className="text-base text-fg-muted">{t("transcript_empty")}</p>
      ) : cues ? (
        <ol className="flex flex-col">
          {cues.map((cue, index) => (
            <li
              key={index}
              className={cn(
                "flex gap-4 rounded-sm px-2 py-1.5",
                "transition-colors duration-[--duration-fast] hover:bg-surface-hover",
                // A hairline between cues rather than a gap: at a hundred rows
                // a gap reads as a list of cards, and a rule reads as a
                // transcript. Not on the first, so the box does not appear to
                // start with a divider.
                index > 0 && "border-t border-line/60",
              )}
            >
              {/* Timecodes never mirror and never localize their digits -- the
                  same rule the trim fields and the output path row follow. The
                  text beside them does both, from its own content. */}
              <span
                dir="ltr"
                className="shrink-0 pt-0.5 text-sm text-fg-muted tnum"
              >
                {cue.at}
              </span>
              <span
                dir="auto"
                className="min-w-0 flex-1 text-start text-lg leading-relaxed text-fg"
                style={{ overflowWrap: "anywhere" }}
              >
                {cue.text}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        // `dir="auto"` per paragraph, not on the container: the direction
        // belongs to the *speech*, so a Persian transcript has to read
        // right-to-left inside an English interface and an English one has to
        // read left-to-right inside a Persian one. Resolving it per paragraph
        // also handles a transcript that switches language part-way.
        <div className="flex flex-col gap-3">
          {text
            .split("\n")
            .filter((line) => line.trim() !== "")
            .map((line, index) => (
              <p
                key={index}
                dir="auto"
                className="text-start text-lg leading-relaxed text-fg"
                style={{ overflowWrap: "anywhere" }}
              >
                {line}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

interface Cue {
  at: string;
  text: string;
}

/**
 * Pulls the start time and the words out of an SRT or VTT body.
 *
 * Rendering the raw file would show cue numbers and full `-->` ranges, which
 * are for a player, not a reader. Anything that does not parse falls back to
 * being shown as plain lines rather than disappearing -- a transcript is worth
 * more than a tidy layout.
 */
function parseCues(body: string): Cue[] | null {
  const cues: Cue[] = [];
  const blocks = body.replace(/^WEBVTT\s*/, "").split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    const timingAt = lines.findIndex((line) => line.includes("-->"));
    if (timingAt === -1) continue;

    const start = lines[timingAt].split("-->")[0].trim();
    const text = lines.slice(timingAt + 1).join(" ").trim();
    if (text === "") continue;

    // Drop the milliseconds and a leading zero hour: reading a transcript, the
    // useful precision is "about four minutes in".
    cues.push({ at: start.replace(/[.,]\d+$/, "").replace(/^00:/, ""), text });
  }

  return cues.length > 0 ? cues : null;
}
