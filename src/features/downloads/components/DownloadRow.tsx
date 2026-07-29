import { memo, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  CircleX,
  Clock3,
  FileAudio2,
  FileVideo2,
  FolderSearch,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DownloadItem } from "../types";
import { isActiveDownload } from "../utils";

interface DownloadRowProps {
  item: DownloadItem;
  active: boolean;
  selected: boolean;
  isCancelling: boolean;
  formatDate: (timestamp: number) => string;
  onReveal: (item: DownloadItem) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}

function runKeyboardAction(event: KeyboardEvent<HTMLSpanElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  action();
}

function DownloadRowComponent({
  item,
  active,
  selected,
  isCancelling,
  formatDate,
  onReveal,
  onCancel,
  onRemove,
}: DownloadRowProps) {
  const { t } = useTranslation();
  const inProgress = isActiveDownload(item.status);

  return (
    <motion.button
      layout
      type="button"
      className={`download-row ${selected ? "selected" : ""} ${item.status === "completed" ? "revealable" : ""}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 18 }}
      onClick={() => onReveal(item)}
    >
      <span className={`file-type-icon ${item.type}`}>
        {item.type === "video" ? <FileVideo2 size={21} /> : <FileAudio2 size={21} />}
      </span>
      <span className="file-details">
        <strong>{item.name}</strong>
        <span>
          <Clock3 size={12} />
          {formatDate(item.createdAt)} · {item.type === "video" ? item.quality : "MP3"}
        </span>
        {inProgress && (
          <span className="row-progress-track">
            <span style={{ width: `${Math.max(2, item.progress)}%` }} />
          </span>
        )}
      </span>
      <span className={`status-badge ${item.status}`}>
        {inProgress ? <Loader2 size={14} className="spin" /> :
          item.status === "completed" ? <CheckCircle2 size={14} /> :
            item.status === "cancelled" ? <CircleX size={14} /> : <AlertTriangle size={14} />}
        <span>{t(`status_${item.status}`)}</span>
        {item.status === "downloading" && <b>{item.progress.toFixed(0)}%</b>}
      </span>
      <span className="table-value" dir="ltr">{item.size || "—"}</span>
      <span className="table-value" dir="ltr">{item.speed || "—"}</span>
      <span className="table-value eta-value" dir="ltr">
        {active && isCancelling ? t("cancelling") : item.eta || "—"}
      </span>
      <span className="row-actions">
        {active && (
          <span
            role="button"
            tabIndex={0}
            className="row-action-button cancel"
            title={t("cancel_button")}
            onClick={(event) => {
              event.stopPropagation();
              onCancel(item.id);
            }}
            onKeyDown={(event) => runKeyboardAction(event, () => onCancel(item.id))}
          >
            <X size={15} />
          </span>
        )}
        {!active && item.status === "completed" && item.filePath && (
          <span
            role="button"
            tabIndex={0}
            className="row-action-button reveal"
            title={t("reveal_file")}
            onClick={(event) => {
              event.stopPropagation();
              onReveal(item);
            }}
            onKeyDown={(event) => runKeyboardAction(event, () => onReveal(item))}
          >
            <FolderSearch size={15} />
          </span>
        )}
        {!active && (
          <span
            role="button"
            tabIndex={0}
            className="row-action-button delete"
            title={t("remove_from_list")}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(item.id);
            }}
            onKeyDown={(event) => runKeyboardAction(event, () => onRemove(item.id))}
          >
            <Trash2 size={14} />
          </span>
        )}
      </span>
    </motion.button>
  );
}

export const DownloadRow = memo(DownloadRowComponent);
