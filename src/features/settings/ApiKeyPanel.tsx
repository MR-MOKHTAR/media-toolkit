import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";
import { cn } from "../../lib/cn";
import * as ipc from "../../lib/ipc";
import type { ToastType } from "../../types/feedback";
import { describe } from "../media/useMediaJob";
import type { ApiKeyStatus } from "../jobs/types";

interface Props {
  notify: (type: ToastType, message: string) => void;
  /** Told whether a key is stored, on load and after every save or removal.
   *  The transcribe screen gates its run button on this. */
  onStatusChange?: (present: boolean) => void;
}

/**
 * The Groq key for the transcribe tool.
 *
 * Lives here but is used from two places: Settings, where someone looking for
 * it expects to find it, and the transcribe screen itself, where it is
 * actually needed. Sending someone who just picked a file off to another route
 * to paste a key, then back, is three navigations to fill in one field.
 *
 * The input is a write-only field: it starts empty and stays empty. What is
 * stored is described by the status line underneath, never by the box -- the
 * key lives in a file only the Rust side reads, and putting it back in the
 * webview so it could be pre-filled would undo the entire reason it is kept
 * there.
 */
export function ApiKeyPanel({ notify, onStatusChange }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<boolean | null>(null);

  // One helper for every path that changes the key, so the screen holding this
  // panel can never be left believing in a key that is no longer there.
  const refresh = async () => {
    const next = await ipc.apiKeyStatus();
    setStatus(next);
    onStatusChange?.(next.present);
  };

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await ipc.setApiKey(draft);
      setDraft("");
      setTested(null);
      await refresh();
      notify("success", t("api_key_saved"));
    } catch (error) {
      notify("error", describe(ipc.toAppError(error), t));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await ipc.clearApiKey();
      setTested(null);
      await refresh();
      notify("info", t("api_key_cleared"));
    } catch (error) {
      notify("error", describe(ipc.toAppError(error), t));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await ipc.testApiKey();
      setTested(true);
      notify("success", t("api_key_ok"));
    } catch (error) {
      setTested(false);
      notify("error", describe(ipc.toAppError(error), t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
      <div className="flex gap-2">
        <TextInput
          type="password"
          // A key is Latin and machine-read, so it never mirrors, whatever
          // the interface language is.
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          placeholder={t("api_key_placeholder")}
          aria-label={t("api_key")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim() !== "" && !busy) void save();
          }}
        />
        <Button
          variant="secondary"
          size="md"
          disabled={busy || draft.trim() === ""}
          onClick={() => void save()}
        >
          {t("api_key_save")}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex flex-1 items-center gap-1.5 text-sm",
            status?.present ? "text-success" : "text-fg-muted",
          )}
        >
          {status === null ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              {t("tool_checking")}
            </>
          ) : status.present ? (
            <>
              {tested === false ? (
                <XCircle size={15} className="text-danger" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              <span dir="ltr">{t("api_key_present", { hint: status.hint ?? "" })}</span>
            </>
          ) : (
            <>
              <XCircle size={15} />
              {t("api_key_missing")}
            </>
          )}
        </span>

        {status?.present && (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void test()}>
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {t("api_key_test")}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void clear()}>
              {t("api_key_clear")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
