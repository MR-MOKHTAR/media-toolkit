import { AnimatePresence, motion } from "framer-motion";
import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";

export function OfflineBanner({ isOnline }: { isOnline: boolean }) {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: 34 }}
          exit={{ height: 0 }}
          // Announced when it appears: going offline changes what every
          // download on screen can do, and a screen reader was told nothing.
          role="status"
          className="flex shrink-0 items-center justify-center gap-2 overflow-hidden bg-warning/15 text-sm text-warning-text"
        >
          <WifiOff size={15} />
          {t("no_internet")}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
