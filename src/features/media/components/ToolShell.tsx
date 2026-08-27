import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Folder, Upload, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation, type SettingsSection } from "../../../app/navigation";
import { TOOL_ICON } from "../../../app/tools";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { FormCard, SectionLabel } from "../../../components/ui/Card";
import { cn } from "../../../lib/cn";
import { fileNameOf, formatBytes, formatDuration } from "../../../lib/format";
import {
  MEDIA_KIND_ICON,
  MEDIA_KIND_TINT,
  mediaKindOfPath,
  type MediaKind,
} from "../../../lib/mediaKind";
import type { MediaInfo } from "../useMediaFile";

/**
 * The one layout every tool screen uses:
 *
 *   file  ->  preview  ->  two or three controls  ->  output folder  ->  run
 *
 * If a tool needs more than three controls between the preview and the output
 * row, it is too complicated for this app. Keeping the template identical is
 * what makes the tools feel like one product instead of a stack of dialogs.
 */
export function ToolShell({
  tool,
  children,
}: {
  /** Which tool this is -- the key the sidebar, the icon map and the two
   *  strings `tool_${key}` and `tool_${key}_about` all share. Passing the key
   *  rather than the finished title and subtitle is what stops a screen from
   *  heading itself with one word while the row that led to it says another. */
  tool: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const Icon = TOOL_ICON[tool];

  return (
    // One width step, and only above xl. At the 600px window minimum and in the
    // default 1100px window the form stays xl-wide, which is where a form reads
    // best -- past that the label drifts away from the control it labels. The
    // extra 96px on a wide screen exists for one reason: the trim range needs
    // a timecode field on each side of its track without squeezing it.
    //
    // 576px, not the 672 this replaces. Every control in here is full width, so
    // the container's width *is* the control's width, and at 2xl a single-line
    // URL field was a 670px box holding a 40px cursor. A form is easier to read
    // when the eye does not have to travel the window to get from a label to
    // its input.
    //
    // min-h-full + justify-center centres a short form vertically and falls
    // back to top-aligned once the content outgrows the viewport, because a
    // min-height leaves no free space to distribute at that point.
    // gap-6, up from gap-4. The header is now three stacked parts of its own at
    // 12px and 6px, and the space separating that whole block from the form has
    // to be larger than any space inside it or the subtitle reads as the card's
    // first line rather than the heading's last.
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-6 px-6 py-6 xl:max-w-2xl">
      {/* The mark, the title, then the line explaining it.

          The screen opened with the grey subtitle alone, floating above nothing:
          26px of name over 14px of explanation is the difference between a
          form that has a subject and a form that starts mid-sentence. The name
          is the sidebar's own word for the tool, so the highlighted row and
          the heading it leads to cannot drift apart.

          `text-xl` and `text-2xl` were declared in the type scale and used by
          nothing at all -- the largest type in the app was 17px, and screen
          titles sat at 15px, the same size as body text. The title takes 2xl:
          it was written into the scale for a home screen that no longer
          exists, and this heading is now the largest thing the app ever says.

          The subtitle is capped at 34em and balanced. Every one of these lines
          is short enough to fit one line in a wide window, and `text-balance`
          is what keeps the wrap from leaving a single orphaned word under a
          centred heading when the window is narrow. */}
      <header className="flex flex-col items-center gap-3 px-2 text-center">
        <ToolMark icon={Icon} />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            {t(`tool_${tool}`)}
          </h1>
          <p className="max-w-[34em] text-sm text-balance text-fg-muted">
            {t(`tool_${tool}_about`)}
          </p>
        </div>
      </header>

      <FormCard>{children}</FormCard>
    </div>
  );
}

/**
 * The tool's own icon, once more at size, with the screen's only idle motion
 * behind it.
 *
 * A heading that is nothing but a word is the same heading on all six screens
 * -- the eye has to read it to know where it is. The glyph is already the thing
 * that identifies a tool in the sidebar, so promoting it to the top of the
 * screen means arrival is recognised before a word is read, and it costs
 * nothing new: it is `TOOL_ICON[tool]`, the sidebar's own icon.
 *
 * Three layers, and each does one job:
 *
 *   - the halo, a blurred conic gradient turning once every nine seconds. Slow
 *     enough that it is a shift in light rather than a spinner -- a spinner at
 *     the top of a form would say the form is busy.
 *   - the aura, the accent gradient blurred under the tile, breathing on the
 *     4s cycle in `aura-breathe`.
 *   - the tile itself, opaque, sharp, holding the icon still. Nothing moves
 *     inside it. Both moving layers are `aria-hidden` and sit behind, so what
 *     a screen reader gets is the heading and nothing else.
 *
 * All of it is decorative, which is why it is safe for the reduced-motion rule
 * in theme.css to stop both keyframes dead: what remains is a gradient tile
 * with a glow, i.e. the design without the movement. Only the entrance is
 * checked in JS, because framer-motion does not read that media query.
 */
function ToolMark({ icon: Icon }: { icon?: LucideIcon }) {
  const reduceMotion = useReducedMotion();

  // A tool with no icon in the map is a typo in the key, not a reason to draw
  // an empty 56px hole above the heading.
  if (!Icon) return null;

  return (
    <motion.div
      // The mark arrives; the title and the form under it do not. One thing
      // moving on entry marks the change of screen, and six things moving on
      // entry is a transition the user has to sit through six times an hour.
      initial={reduceMotion ? false : { opacity: 0, scale: 0.72 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 340, damping: 24 }}
      className="relative flex size-14 items-center justify-center"
    >
      <span
        aria-hidden
        className="absolute -inset-2.5 rounded-full bg-(image:--gradient-halo) opacity-40 blur-lg animate-[halo-turn_9s_linear_infinite]"
      />
      <span
        aria-hidden
        className="absolute inset-1 rounded-xl bg-(image:--gradient-accent) blur-md animate-[aura-breathe_4s_ease-in-out_infinite]"
      />
      {/* rounded-xl at 56px: the same 24px corner the dialogs and the form card
          use, which at this size is a squircle rather than a circle -- an app
          icon, matching the shape of the card it introduces. */}
      <span className="relative flex size-14 items-center justify-center rounded-xl bg-(image:--gradient-accent) text-on-accent shadow-(--shadow-glow-accent)">
        <Icon size={26} strokeWidth={1.75} />
      </span>
    </motion.div>
  );
}

export function FileDropZone({
  path,
  info,
  loading,
  isDragging,
  onBrowse,
}: {
  path: string | null;
  info: MediaInfo | null;
  loading: boolean;
  isDragging: boolean;
  onBrowse: () => void;
}) {
  const { t } = useTranslation();

  if (!path) {
    return (
      <button
        type="button"
        onClick={onBrowse}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8",
          "transition-[border-color,background-color,box-shadow] duration-(--duration-base)",
          // No scale. A drop zone is the largest target on the screen and it
          // already says "drag-over" three ways -- border, fill and glow. The
          // 1.01 here nudged the whole form, and the 1.005 on hover was a
          // sub-pixel change on a 400px box, i.e. nothing at all.
          isDragging
            ? "border-accent bg-accent-soft shadow-(--shadow-glow-accent)"
            : "border-line bg-surface-soft hover:border-line-strong hover:bg-surface-hover",
        )}
      >
        <Upload
          size={19}
          className={cn(
            "text-fg-muted transition-all duration-(--duration-base)",
            isDragging && "text-accent animate-[subtle-pulse_1.5s_ease-in-out_infinite]",
          )}
        />
        <span className="text-sm font-medium text-fg">{t("drop_file")}</span>
        <span className="text-xs text-fg-muted">{t("or_browse")}</span>
      </button>
    );
  }

  // ffprobe is the authority once it has answered; until then the extension is
  // the only thing known about the file, and it is right often enough that
  // showing a neutral placeholder for a moment would just be a flicker.
  const kind: MediaKind = info
    ? info.video
      ? "video"
      : "audio"
    : mediaKindOfPath(path);
  const Icon = MEDIA_KIND_ICON[kind];

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-surface p-3",
        isDragging ? "border-accent bg-accent-soft" : "border-line",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-md",
          MEDIA_KIND_TINT[kind],
        )}
      >
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg" title={path}>
          {fileNameOf(path)}
        </p>
        <p className="text-xs text-fg-muted tnum" dir="ltr">
          {loading
            ? t("reading_file")
            : info
              ? [
                  info.video
                    ? `${info.video.width}×${info.video.height}`
                    : null,
                  formatDuration(info.durationSecs),
                  formatBytes(info.sizeBytes, "en"),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "—"}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onBrowse}>
        {t("change")}
      </Button>
    </div>
  );
}

/**
 * The output row and the preference row, at one height.
 *
 * These two sit directly above each other on every tool form and each ends in
 * the same ghost `size="sm"` button, so their edges are compared whether or not
 * anyone means to compare them. They were `px-3.5 py-2.5` and
 * `ps-3.5 pe-1.5 py-1.5` -- a 54px row stacked on a 46px one, with the button
 * inset differently in each.
 */
const ROW =
  "flex items-center gap-3 rounded-md border border-line bg-surface ps-3.5 pe-1.5 py-1.5";

export function OutputFolderRow({
  folder,
  onChoose,
}: {
  folder: string;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  return (
    // The whole row is pinned to ltr, not just the path inside it. This row is
    // a filesystem location, and a path only reads one way: folder icon, then
    // the path, then the button that changes it -- identical in all three
    // languages. Letting it mirror moved the change button to the left and put
    // the icon on the far side of a path that still ran left to right.
    <div dir="ltr" className={ROW}>
      <Folder size={16} className="shrink-0 text-fg-muted" />
      <span
        className="min-w-0 flex-1 truncate text-sm text-fg-soft"
        title={folder}
      >
        {folder || t("select_location")}
      </span>
      <Button variant="ghost" size="sm" onClick={onChoose}>
        {t("change")}
      </Button>
    </div>
  );
}

/**
 * A standing preference, shown on the form that obeys it.
 *
 * Some of what these forms used to ask is not a decision about the file in
 * hand at all -- which video quality to fetch, which Whisper to run. Those are
 * answered once and then true for months, so they live in Settings now and the
 * forms are shorter for it. What they must not be is invisible: a form that
 * silently downloads 720p is worse than one that spends a row saying so.
 *
 * Hence a row rather than a removal. It reads as what it is -- a fact about
 * what is about to happen, with the way to change it attached -- and it holds
 * the place the control had, so the run button does not move when a probe lands
 * or a file is picked.
 */
export function PreferenceRow({
  icon,
  label,
  value,
  section,
  onBeforeLeave,
}: {
  icon: ReactNode;
  label: string;
  /** Written as it is in Settings, so the two never look like two settings. */
  value: string;
  /** The panel this preference lives in; the button opens Settings on it. */
  section: SettingsSection;
  /** Run just before leaving, for a form to record what it is holding into its
   *  own route -- otherwise a look at the setting costs the user the link they
   *  had pasted or the file they had picked. */
  onBeforeLeave?: () => void;
}) {
  const { t } = useTranslation();
  const { go } = useNavigation();

  return (
    <div className={ROW}>
      <span className="shrink-0 text-fg-muted">{icon}</span>
      <span className="shrink-0 text-sm text-fg-soft">{label}</span>
      {/* ltr because the two values this carries -- "720p", a Whisper model id
          -- are Latin and machine-read, and truncating rather than wrapping
          keeps the row one line at the 600px window minimum. It sits next to
          its label rather than against the button, so the pair still reads as
          one phrase when the row mirrors. */}
      <span
        dir="ltr"
        className="min-w-0 truncate text-sm font-medium text-fg"
        title={value}
      >
        {value}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="ms-auto shrink-0"
        onClick={() => {
          onBeforeLeave?.();
          go({ name: "settings", section });
        }}
      >
        {t("settings")}
      </Button>
    </div>
  );
}

export function RunButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="primary"
      size="lg"
      disabled={disabled}
      onClick={onClick}
      className="w-full"
    >
      {label}
    </Button>
  );
}

/**
 * A row of short, fixed choices -- container formats, transcript formats.
 *
 * Lives here rather than in ConvertScreen, where it started, because Transcribe
 * needs the identical control and a second copy would drift. Distinct from
 * `Segmented`: that one divides the full width into equal columns for two to
 * four options with hints, this one wraps a row of short uppercase tokens.
 */
export function FormatGroup({
  title,
  formats,
  value,
  onChange,
  disabled,
  disabledHint,
}: {
  title: string;
  formats: string[];
  value: string;
  onChange: (format: string) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>
        {title}
        {disabled && disabledHint && (
          <span className="ms-2 text-xs font-normal text-fg-muted">
            {disabledHint}
          </span>
        )}
      </SectionLabel>
      <div className="flex flex-wrap gap-2">
        {formats.map((format) => (
          <button
            key={format}
            type="button"
            disabled={disabled}
            onClick={() => onChange(format)}
            className={cn(
              // Radius, padding and glow all match Segmented now. The two
              // components stay separate for the reason above, but a format
              // chip and a segmented option sit on the same form and were
              // drifting apart on every value that decides how they look.
              "rounded-md border px-3 py-2 text-sm uppercase transition-all duration-(--duration-fast)",
              "disabled:cursor-not-allowed disabled:opacity-disabled",
              value === format
                ? "border-accent-line bg-accent-soft font-medium text-accent shadow-(--shadow-glow)"
                : "border-line bg-surface text-fg-soft hover:enabled:border-line-strong hover:enabled:bg-surface-hover hover:enabled:scale-[1.02]",
            )}
          >
            {format}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Green badge for the cases where a job is a stream copy: instant, lossless,
 *  and worth telling the user before they wait for nothing. */
export function InstantBadge({ text }: { text: string }) {
  return <Badge tone="success">{text}</Badge>;
}
