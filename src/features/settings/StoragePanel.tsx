import { useEffect, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { CheckRow } from "../../components/ui/CheckRow";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Card } from "../../components/ui/Card";
import * as ipc from "../../lib/ipc";
import type { ToastType } from "../../types/feedback";
import { describe } from "../media/useMediaJob";
import type { LibraryInfo } from "../jobs/types";

interface Props {
  notify: (type: ToastType, message: string) => void;
}

/**
 * Where the app keeps what it makes.
 *
 * Everything used to be written into the user's Downloads folder, alongside
 * every installer and PDF they have ever saved, and the choice lasted exactly
 * as long as the window was open. This is the persistent half: one root the app
 * owns, and the two switches that decide the shape inside it.
 *
 * Rust is the source of truth for all of it, so every action here reads the new
 * state back from the answer rather than assuming its own optimistic version --
 * a rejected folder must leave the panel showing the folder still in use.
 */
export function StoragePanel({ notify }: Props) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<LibraryInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void ipc.getLibraryInfo().then(setInfo).catch(() => undefined);
  }, []);

  /** Every mutation is the same shape: run it, adopt what Rust answers, and
   *  surface the real message when it refuses. */
  const apply = async (action: () => Promise<LibraryInfo>, success?: string) => {
    setBusy(true);
    try {
      setInfo(await action());
      if (success) notify("success", success);
    } catch (error) {
      notify("error", describe(ipc.toAppError(error), t));
    } finally {
      setBusy(false);
    }
  };

  const change = async () => {
    let selected: string | null = null;
    try {
      selected = await ipc.chooseFolder(info?.root);
    } catch {
      notify("error", t("error_selecting_folder"));
      return;
    }
    if (!selected) return;
    await apply(() => ipc.setLibraryRoot(selected), t("library_moved"));
  };

  const open = async () => {
    if (!info) return;
    try {
      await ipc.openPath(info.root);
    } catch {
      notify("error", t("open_folder_failed"));
    }
  };

  return (
    <Card padding="sm" className="flex flex-col gap-3">
      {/* Pinned to ltr for the same reason the tool screens' folder row is: a
          path reads one way in every language, and mirroring the row put the
          buttons on the far side of text that still ran left to right. */}
      <div dir="ltr" className="flex items-center gap-3">
        <FolderOpen size={16} className="shrink-0 text-fg-muted" />
        <span
          className="min-w-0 flex-1 truncate text-sm text-fg-soft"
          title={info?.root}
        >
          {info?.root ?? ""}
        </span>
        {/* Asks first, because this one moves files. `change` below does not
            need to: the folder picker it opens is its own confirmation, and
            cancelling that is how you back out of it. */}
        {info && !info.isDefault && (
          <ConfirmDialog
            title={t("library_reset")}
            description={t("library_reset_confirm")}
            confirmLabel={t("library_reset")}
            onConfirm={() =>
              void apply(() => ipc.resetLibraryRoot(), t("library_moved"))
            }
            trigger={
              <Button variant="ghost" size="sm" disabled={busy}>
                {t("library_reset")}
              </Button>
            }
          />
        )}
        <Button variant="ghost" size="sm" disabled={!info} onClick={() => void open()}>
          {t("open_folder")}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void change()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {t("change")}
        </Button>
      </div>

      {/* Switches rather than checkboxes: both of these are written to
          settings.json the moment they move, so neither is waiting on a button
          to mean anything. */}
      <CheckRow
        control="switch"
        label={t("library_organize")}
        hint={t("library_organize_hint")}
        checked={info?.organizeByTool ?? true}
        disabled={!info || busy}
        onChange={(enabled) => void apply(() => ipc.setLibraryOrganize(enabled))}
      />

      <CheckRow
        control="switch"
        label={t("library_next_to_input")}
        hint={t("library_next_to_input_hint")}
        checked={info?.saveNextToInput ?? false}
        disabled={!info || busy}
        onChange={(enabled) => void apply(() => ipc.setSaveNextToInput(enabled))}
      />
    </Card>
  );
}
