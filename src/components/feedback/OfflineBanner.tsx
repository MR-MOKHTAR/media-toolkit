import { AnimatePresence, motion } from "framer-motion";
import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";

interface OfflineBannerProps {
  isOnline: boolean;
}

export function OfflineBanner({ isOnline }: OfflineBannerProps) {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div className="offline-banner" initial={{ height: 0 }} animate={{ height: 38 }} exit={{ height: 0 }}>
          <WifiOff size={16} />{t("no_internet")}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default OfflineBanner;
