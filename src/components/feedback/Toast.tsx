import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, CircleX, Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppLanguage } from "../../hooks/useAppPreferences";
import type { ToastState } from "../../types/feedback";

interface ToastProps {
  toast: ToastState | null;
  language: AppLanguage;
  onClose: () => void;
}

export function Toast({ toast, language, onClose }: ToastProps) {
  const { t } = useTranslation();

  return (
    <AnimatePresence mode="wait">
      {toast && (
        <motion.div
          key={toast.id}
          className={`toast ${toast.type}`}
          initial={{ opacity: 0, x: language === "en" ? 24 : -24, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
        >
          <span className="toast-icon">
            {toast.type === "success" ? <CheckCircle2 size={21} /> :
              toast.type === "error" ? <CircleX size={21} /> :
                toast.type === "warning" ? <AlertTriangle size={21} /> : <Download size={21} />}
          </span>
          <div className="toast-content"><strong>{t(toast.type)}</strong><p>{toast.message}</p></div>
          <button onClick={onClose} aria-label={t("close")}><X size={17} /></button>
          <span className="toast-timer" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default Toast;
