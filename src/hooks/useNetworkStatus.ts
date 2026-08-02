import { useEffect, useState } from "react";

function getInitialNetworkStatus() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(getInitialNetworkStatus);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
