import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation, type ToolRoute } from "../../app/navigation";
import { TOOL_ICON } from "../../app/tools";
import { Button } from "../../components/ui/Button";
import * as ipc from "../../lib/ipc";
import { allUrlsIn, firstUrlIn } from "../../lib/url";
import { ChatThread, UserBubble } from "../chat/ChatThread";
import { ChatWelcome } from "../chat/ChatWelcome";
import { Composer, type ComposerHandle } from "../chat/Composer";
import { useStickToBottom } from "../chat/useStickToBottom";
import { jobsOfKind } from "../jobs/selectors";
import { useJobs } from "../jobs/useJobs";
import { useDragDropState } from "../media/useDragDropState";

interface Props {
  route: ToolRoute;
  language: string;
  /** The tool's form, rendered as the app's reply at the end of the thread
   *  while the route says `composing`. A function, so it mounts on open and
   *  unmounts on close: every job starts on a clean form. */
  children: (close: () => void) => ReactNode;
}

/**
 * A tool, as a conversation.
 *
 * The thread is the tool's history, oldest at the top: what was sent and what
 * came of it. The composer at the foot is where the next one starts -- a link
 * pasted, a file attached or dropped anywhere on the window -- and sending it
 * opens the tool's form as the app's reply under it. Starting the job turns
 * that reply into the job's own message, in place.
 */
export function ToolScreen({ route, language, children }: Props) {
  const { t } = useTranslation();
  const { replace } = useNavigation();
  const { jobs } = useJobs();

  const kind = route.name;
  const Icon = TOOL_ICON[kind];
  const mine = useMemo(() => jobsOfKind(jobs, kind), [jobs, kind]);
  const composing = Boolean(route.composing);

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const { atBottom, scrollToBottom } = useStickToBottom(scroller, content);

  // A different conversation opens at its newest message.
  useEffect(() => {
    scrollToBottom(false);
  }, [kind, scrollToBottom]);

  // A new message -- a job started here, or one arriving from elsewhere --
  // brings the thread down to it.
  const newest = mine[0]?.rowKey ?? mine[0]?.id;
  useEffect(() => {
    if (newest) scrollToBottom(true);
  }, [newest, scrollToBottom]);

  /** Closing drops what the draft was about. Kept, the next "new" opened on
   *  the file that was dropped last time. */
  const close = useCallback(
    () => replace({ name: kind, composing: false } as ToolRoute),
    [replace, kind],
  );

  const sendLinks = useCallback(
    (text: string) => {
      replace({ name: "download", link: text, composing: true });
      scrollToBottom(true);
    },
    [replace, scrollToBottom],
  );

  const sendFile = useCallback(
    (path: string) => {
      if (kind === "download") return;
      replace({ name: kind, file: path, composing: true });
      scrollToBottom(true);
    },
    [replace, kind, scrollToBottom],
  );

  // A file dropped anywhere on the conversation is a file sent. While a
  // draft is open the drop is the draft's own (its drop zone listens), and
  // Download takes links, not files.
  const isDragging = useDragDropState(
    (paths) => {
      if (paths[0]) sendFile(paths[0]);
    },
    kind !== "download" && !composing,
  );

  // Ctrl+N -- the "new" every app with a list has -- puts the cursor in the
  // composer. Not from inside a text field, where it is the field's own, and
  // not under a dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "n" || !(event.ctrlKey || event.metaKey)) return;
      if (event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      event.preventDefault();
      composer.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const pasteAndSend = useCallback(async () => {
    const clip = await ipc.readClipboardText();
    const all = clip ? allUrlsIn(clip) : [];
    const found = all.length > 1 ? all.join("\n") : clip && firstUrlIn(clip);
    if (found) sendLinks(found);
    else composer.current?.focus();
  }, [sendLinks]);

  const browse = useCallback(async () => {
    try {
      const selected = await ipc.chooseMediaFile(undefined, {
        media: t("picker_media"),
        video: t("format_video"),
        audio: t("format_audio"),
      });
      if (selected) sendFile(selected);
    } catch {
      // No native side; dropping still works.
    }
  }, [sendFile, t]);

  const empty = mine.length === 0 && !composing;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* The conversation's name, as a chat app heads its thread. Slim: the
          thread under it is what the screen is for. */}
      <header className="glass-chrome relative z-10 shrink-0 border-b px-4 py-2">
        <motion.div
          key={kind}
          className="mx-auto flex w-full max-w-3xl items-center gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {Icon && (
            <span className="tool-tile relative flex size-9 shrink-0 items-center justify-center rounded-full">
              <Icon size={17} strokeWidth={1.9} />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="holo-text truncate text-base leading-tight font-semibold">
              {t(`tool_${kind}`)}
            </h1>
            <p className="truncate text-xs text-fg-muted">{t(`tool_${kind}_about`)}</p>
          </div>
        </motion.div>
      </header>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        {/* Not keyed: the stick-to-bottom observer holds this element. */}
        <div ref={content} className="flex min-h-full flex-col">
        <motion.div
          key={kind}
          className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 pt-6 pb-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        >
          {empty ? (
            <ChatWelcome
              kind={kind}
              onPaste={() => void pasteAndSend()}
              onBrowse={() => void browse()}
            />
          ) : (
            <>
              {/* Pushes a short thread down to the composer, the way a chat
                  fills from the bottom. */}
              <div className="flex-1" />
              <ChatThread jobs={mine} language={language} />
            </>
          )}

          {composing && (
            <div className="flex flex-col gap-2">
              {route.name === "download"
                ? route.link && <UserBubble source={route.link} kind="download" />
                : route.file && <UserBubble source={route.file} kind={route.name} />}
              {children(close)}
            </div>
          )}
        </motion.div>
        </div>
      </div>

      {/* Back to the newest message, when reading further up. */}
      <AnimatePresence>
        {!atBottom && !empty && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 bottom-28 z-10 flex justify-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <Button
              variant="secondary"
              size="sm"
              className="pointer-events-auto rounded-full shadow-(--shadow-raise)"
              icon={<ArrowDown size={15} />}
              onClick={() => scrollToBottom(true)}
            >
              {t("chat_jump_latest")}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 shrink-0 pt-1">
        <Composer
          ref={composer}
          mode={kind === "download" ? "link" : "file"}
          composing={composing}
          lastSource={mine[0]?.source}
          onSendLinks={sendLinks}
          onSendFile={sendFile}
        />
      </div>

      {/* A file held over the window: the whole conversation is the target. */}
      <AnimatePresence>
        {isDragging && kind !== "download" && !composing && (
          <motion.div
            className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-accent bg-[color-mix(in_srgb,var(--tool-a)_14%,transparent)] backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Upload size={32} className="animate-[subtle-pulse_1.4s_ease-in-out_infinite] text-accent" />
            <p className="text-base font-medium text-fg">{t("drop_file")}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
