import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";

export function OfflineBanner({ isOnline }: { isOnline: boolean }) {
  const { t } = useTranslation();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="flex h-8 shrink-0 items-center justify-center gap-2 border-b border-warning/20 bg-warning/10 px-3 text-sm text-warning-text"
    >
      <WifiOff size={15} />
      {t("no_internet")}
    </div>
  );
}
