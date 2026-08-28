import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation, type ToolRoute } from "../../app/navigation";
import { TOOL_ICON } from "../../app/tools";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/Card";
import { JobList } from "../jobs/components/JobList";
import { jobsOfKind } from "../jobs/selectors";
import { useJobs } from "../jobs/useJobs";
import { useDragDropState } from "../media/useDragDropState";

interface Props {
  route: ToolRoute;
  language: string;
  /** The tool's form, rendered only while the dialog is open. A function rather
   *  than an element so it mounts on open and unmounts on close: every job
   *  starts on a clean form, and nothing keeps the previous one's file or its
   *  probe result alive in the background. */
  children: (close: () => void) => ReactNode;
}

/**
 * A tool, as a download manager shows one: the list is the screen.
 *
 * What this replaces was the other way round -- the form sat in the middle of
 * the window and the list of what the tool had done was a panel behind a button
 * in the title bar, which opened itself when a job started and covered the form
 * below `xl`. The thing the user spends their time watching was the hardest
 * thing on the screen to see, and the form nobody was filling in any more was
 * the easiest.
 *
 * So: the jobs are the page, and the form is a dialog over them. Starting one
 * closes the dialog and the new row is already there underneath, running.
 */
export function ToolScreen({ route, language, children }: Props) {
  const { t } = useTranslation();
  const { replace } = useNavigation();
  const { jobs } = useJobs();

  // The route's own name is the tool: `ToolRoute["name"]` and `JobKind` are the
  // same six strings, so nothing has to be passed alongside it.
  const kind = route.name;
  const Icon = TOOL_ICON[kind];
  const mine = useMemo(() => jobsOfKind(jobs, kind), [jobs, kind]);

  // `replace`, never `go`: opening the form is not somewhere new to be. It is
  // the same screen with its form open, and recording it that way is what lets
  // a trip to Settings and back find the form still there -- see `ToolRoute`.
  const setComposing = useCallback(
    (composing: boolean) => replace({ ...route, composing }),
    [replace, route],
  );

  const open = useCallback(() => setComposing(true), [setComposing]);
  const close = useCallback(() => setComposing(false), [setComposing]);

  // A file dropped on the list opens the form with it already loaded.
  //
  // Switched off while the form is open -- that is the form's own drop to
  // handle, and its drop zone is already listening. Off for Download too, which
  // takes a link rather than a file and has nothing to do with one.
  useDragDropState(
    (paths) => {
      // The `kind` check is the `enabled` flag again, for the type checker:
      // only the five file tools carry a `file` on their route.
      if (!paths[0] || kind === "download") return;
      replace({ name: kind, file: paths[0], composing: true });
    },
    kind !== "download" && !route.composing,
  );

  // The shortcut every app with a list and a "new" button has. Ignored while
  // the form is already open, and while the user is typing into something --
  // Ctrl+N in a text field is the browser's own, and stealing it there would be
  // the wrong kind of surprise.
  useEffect(() => {
    if (route.composing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "n" || !(event.ctrlKey || event.metaKey)) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [route.composing, open]);

  const action = (
    <Button
      variant="primary"
      onClick={open}
      icon={<Plus size={17} strokeWidth={2.25} />}
    >
      {t(`tool_${kind}_action`)}
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The toolbar. It does not scroll: the button that starts a job has to
          be in the same place whether the list below it holds nothing or two
          hundred rows. */}
      <header className="shrink-0 border-b border-line bg-surface px-6 py-3">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 lg:max-w-4xl xl:max-w-5xl">
          {/* The sidebar's own glyph for this tool, so the highlighted row and
              the screen it leads to cannot drift apart. Static -- the animated
              version of this mark introduced a form, and this introduces a
              list. */}
          {Icon && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-(image:--gradient-accent) text-on-accent shadow-(--shadow-glow)">
              <Icon size={18} strokeWidth={1.75} />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-lg font-medium text-fg">
              {t(`tool_${kind}`)}
            </h1>
            <p className="truncate text-sm text-fg-muted">
              {t(`tool_${kind}_about`)}
            </p>
          </div>
          {action}
        </div>
      </header>

      {/* The only thing that scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-6 lg:max-w-4xl xl:max-w-5xl">
          <JobList
            jobs={mine}
            language={language}
            empty={
              <EmptyState
                icon={Icon ? <Icon size={22} /> : null}
                title={t("no_jobs_title")}
                // The tool's own line, not the generic one Tasks uses: this
                // list is empty because *this* tool has not been used, and the
                // sentence that explains the tool is the one worth reading
                // while deciding whether to press the button under it.
                description={t(`tool_${kind}_about`)}
                action={action}
              />
            }
          />
        </div>
      </div>

      {route.composing && children(close)}
    </div>
  );
}
