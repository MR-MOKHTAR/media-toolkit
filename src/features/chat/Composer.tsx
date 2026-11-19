import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ArrowUp, ClipboardPaste, Paperclip, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import * as ipc from "../../lib/ipc";
import { allUrlsIn, firstUrlIn } from "../../lib/url";

export interface ComposerHandle {
  focus: () => void;
}

/**
 * The box at the foot of every conversation: where a link is pasted, or a
 * file is attached. Sending it is what opens the tool's answer -- the draft
 * with the preview and the choices -- in the thread above.
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    mode: "link" | "file";
    /** Links, one per line, already cleaned out of whatever was pasted. */
    onSendLinks: (text: string) => void;
    onSendFile: (path: string) => void;
    /** The most recent link this tool was given, so the clipboard prefill does
     *  not offer the download that was just made again. */
    lastSource?: string;
    /** A draft is open: the clipboard is not read into the box under it. */
    composing: boolean;
  }
>(function Composer({ mode, onSendLinks, onSendFile, lastSource, composing }, ref) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const attach = useRef<HTMLButtonElement>(null);
  const textRef = useRef(text);
  textRef.current = text;

  useImperativeHandle(ref, () => ({
    focus: () => (mode === "link" ? area.current : attach.current)?.focus(),
  }));

  // Grow with the text, up to six lines; past that it scrolls.
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 6 * 22 + 20)}px`;
  }, [text]);

  // A copied link is put in the box when the conversation opens -- opening
  // the downloader is almost always the second half of copying one -- and
  // selected, so typing over it costs nothing. Not while a draft is open, not
  // over anything typed meanwhile, and not the link that was just sent.
  useEffect(() => {
    if (mode !== "link" || composing) return;
    let cancelled = false;
    void ipc.readClipboardText().then((clip) => {
      if (cancelled || !clip || textRef.current) return;
      const all = allUrlsIn(clip);
      const found = all.length > 1 ? all.join("\n") : firstUrlIn(clip);
      if (!found || found === lastSource) return;
      setText(found);
      requestAnimationFrame(() => area.current?.select());
    });
    return () => {
      cancelled = true;
    };
    // Once per visit to the conversation, not on every new job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, composing]);

  const cleaned = useCallback((raw: string) => {
    const all = allUrlsIn(raw);
    if (all.length > 1) return all.join("\n");
    return firstUrlIn(raw) ?? raw.trim();
  }, []);

  const send = () => {
    const value = cleaned(text);
    if (!value) return;
    onSendLinks(value);
    setText("");
  };

  const pasteClipboard = async () => {
    const clip = await ipc.readClipboardText();
    if (!clip) return;
    const value = cleaned(`${text}\n${clip}`);
    setText(value);
    area.current?.focus();
  };

  const browse = async () => {
    try {
      const selected = await ipc.chooseMediaFile(undefined, {
        media: t("picker_media"),
        video: t("format_video"),
        audio: t("format_audio"),
      });
      if (selected) onSendFile(selected);
    } catch {
      // No picker (not in Tauri); the drop still works.
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-3">
      <div className="composer-glass relative flex items-end gap-1.5 rounded-3xl border p-2 ps-3 holo-rim [--rim-opacity:0.45] focus-within:[--rim-opacity:0.9]">
        {mode === "link" ? (
          <>
            <IconButton
              label={t("composer_paste")}
              onClick={() => void pasteClipboard()}
              className="mb-0.5 rounded-full"
            >
              <ClipboardPaste size={17} />
            </IconButton>
            <textarea
              ref={area}
              rows={1}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onPaste={(event) => {
                // A link pasted out of a message arrives with the message
                // around it; keep only the links.
                const pasted = event.clipboardData.getData("text");
                const element = event.currentTarget;
                const replacing =
                  element.selectionStart === 0 && element.selectionEnd === element.value.length;
                const next = cleaned(replacing ? pasted : `${text}\n${pasted}`);
                if (next && next !== pasted.trim()) {
                  event.preventDefault();
                  setText(next);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={t("composer_placeholder_link")}
              aria-label={t("url_label")}
              spellCheck={false}
              // A link reads left to right in every language; the empty box's
              // prompt follows the interface.
              dir={text ? "ltr" : undefined}
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] leading-[22px] text-fg outline-none placeholder:text-fg-muted"
            />
            <SendButton disabled={!text.trim()} onClick={send} label={t("composer_send")} />
          </>
        ) : (
          <>
            <IconButton
              label={t("composer_attach")}
              onClick={() => void browse()}
              className="mb-0.5 rounded-full"
            >
              <Paperclip size={17} />
            </IconButton>
            <button
              ref={attach}
              type="button"
              onClick={() => void browse()}
              className="flex min-h-9 flex-1 items-center gap-2 py-2 text-start text-[15px] text-fg-muted outline-none hover:text-fg focus-visible:text-fg"
            >
              <Upload size={16} className="shrink-0" />
              <span className="truncate">{t("composer_placeholder_file")}</span>
            </button>
            <SendButton disabled onClick={() => undefined} label={t("composer_send")} />
          </>
        )}
      </div>
      <p className="mt-1.5 truncate px-4 text-center text-[11px] text-fg-muted">
        {mode === "link" ? t("composer_hint_link") : t("composer_hint_file")}
      </p>
    </div>
  );
});

function SendButton({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full transition-all duration-(--duration-fast)",
        disabled
          ? "bg-surface-hover text-fg-muted"
          : "tool-tile hover:scale-105 active:scale-95",
      )}
    >
      <ArrowUp size={18} strokeWidth={2.4} />
    </button>
  );
}
