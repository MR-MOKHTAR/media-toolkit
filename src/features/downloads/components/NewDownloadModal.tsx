import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  Folder,
  Gauge,
  Link2,
  Music2,
  Video,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { StyledDropdown } from "../../../components/ui/StyledDropdown";
import type { DownloadRequest } from "../types";

export type NewDownloadValues = Omit<DownloadRequest, "savePath">;

interface NewDownloadModalProps {
  isOpen: boolean;
  savePath: string;
  isDownloading: boolean;
  ytdlpReady: boolean;
  isOnline: boolean;
  onSelectFolder: () => void;
  onStart: (values: NewDownloadValues, onSuccess: () => void) => boolean;
  onClose: () => void;
}

export function NewDownloadModal({
  isOpen,
  savePath,
  isDownloading,
  ytdlpReady,
  isOnline,
  onSelectFolder,
  onStart,
  onClose,
}: NewDownloadModalProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [downloadType, setDownloadType] = useState<DownloadRequest["downloadType"]>("video");
  const [videoQuality, setVideoQuality] = useState("720p");
  const videoQualities = useMemo(
    () => [
      { value: "best", label: t("quality_best") },
      { value: "4k", label: t("quality_4k") },
      { value: "1440p", label: t("quality_1440p") },
      { value: "1080p", label: t("quality_1080p") },
      { value: "720p", label: t("quality_720p") },
      { value: "480p", label: t("quality_480p") },
    ],
    [t],
  );
  const clearCompletedFields = useCallback(() => {
    setUrl("");
    setFilename("");
  }, []);
  const handleStart = useCallback(() => {
    const started = onStart(
      {
        url,
        filename,
        downloadType,
        quality: videoQuality,
      },
      clearCompletedFields,
    );

    if (started) onClose();
  }, [clearCompletedFields, downloadType, filename, onClose, onStart, url, videoQuality]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDownloading) onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDownloading, isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDownloading) onClose();
          }}
        >
          <motion.section
            className="download-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-download-title"
            initial={{ opacity: 0, y: 22, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ type: "spring", damping: 28, stiffness: 350 }}
          >
            <div className="modal-header">
              <span className="modal-icon"><Download size={22} /></span>
              <div><h2 id="new-download-title">{t("new_download")}</h2><p>{t("modal_subtitle")}</p></div>
              <button className="icon-button modal-close" onClick={onClose}><X size={20} /></button>
            </div>

            <div className="modal-body">
              <label className="field-group">
                <span className="field-label"><Link2 size={15} />{t("source_link")}</span>
                <input
                  className="field-control url-input"
                  type="url"
                  autoFocus
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={t("url_placeholder")}
                  dir="ltr"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleStart();
                  }}
                />
              </label>

              <fieldset className="type-fieldset">
                <legend>{t("choose_download_type")}</legend>
                <div className="type-grid">
                  <button
                    type="button"
                    className={downloadType === "video" ? "type-card selected" : "type-card"}
                    onClick={() => setDownloadType("video")}
                  >
                    <span className="type-card-icon video"><Video size={21} /></span>
                    <span><strong>{t("download_type_video")}</strong><small>{t("video_format_description")}</small></span>
                    <i>{downloadType === "video" && <Check size={13} />}</i>
                  </button>
                  <button
                    type="button"
                    className={downloadType === "audio" ? "type-card selected" : "type-card"}
                    onClick={() => setDownloadType("audio")}
                  >
                    <span className="type-card-icon audio"><Music2 size={21} /></span>
                    <span><strong>{t("download_type_audio")}</strong><small>{t("audio_format_description")}</small></span>
                    <i>{downloadType === "audio" && <Check size={13} />}</i>
                  </button>
                </div>
              </fieldset>

              <AnimatePresence mode="wait">
                {downloadType === "video" ? (
                  <motion.div
                    className="field-group"
                    key="video-quality"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className="field-label"><Gauge size={15} />{t("video_quality")}</span>
                    <StyledDropdown
                      value={videoQuality}
                      options={videoQualities}
                      onChange={setVideoQuality}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    className="audio-default-note"
                    key="audio-default"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <span><Music2 size={18} /></span>
                    <div><strong>{t("audio_default")}</strong><p>{t("audio_default_description")}</p></div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="modal-fields-row">
                <label className="field-group">
                  <span className="field-label">{t("filename_label")} <em>{t("optional")}</em></span>
                  <input
                    className="field-control"
                    value={filename}
                    onChange={(event) => setFilename(event.target.value)}
                    placeholder={t("filename_placeholder")}
                  />
                </label>
                <div className="field-group">
                  <span className="field-label">{t("save_location")}</span>
                  <button type="button" className="field-control folder-picker" onClick={onSelectFolder}>
                    <Folder size={17} />
                    <span title={savePath} dir="ltr">{savePath || t("browse_button")}</span>
                    <ChevronDown size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <span><AlertTriangle size={14} />{t("one_download_at_a_time")}</span>
              <div>
                <button className="secondary-button" onClick={onClose}>{t("cancel_button")}</button>
                <button
                  className="primary-button start-button"
                  onClick={handleStart}
                  disabled={!ytdlpReady || !isOnline}
                >
                  <Download size={18} />{t("start_download")}
                </button>
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
