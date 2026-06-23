import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  Music,
  Folder,
  Moon,
  Sun,
  Check,
  AlertCircle,
  WifiOff,
  RotateCcw,
  Minus,
  Square,
  Copy,
  X,
  ChevronDown,
  Play,
} from "lucide-react";
import i18n from "./i18n";

interface ProgressPayload {
  percent: number;
  size: string;
  speed: string;
  eta: string;
}

interface DownloadResult {
  success: boolean;
  message: string;
  file_path?: string;
}

interface AlertState {
  type: "success" | "error" | "info" | "warning";
  message: string;
}

interface DropdownOption {
  value: string;
  label: string;
}

// Custom dropdown — native <select>/<option> backgrounds are not reliably
// styleable across webviews (especially WebKitGTK on Linux), so we render
// our own fully theme-controlled menu instead.
function StyledDropdown({
  value,
  options,
  onChange,
  disabled,
  darkMode,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  darkMode: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`w-full px-4 py-3 rounded-xl border-2 cursor-pointer font-bold flex items-center justify-between gap-2 transition-all ${
          darkMode
            ? "bg-slate-900 border-slate-700 text-white hover:border-slate-600"
            : "bg-white border-blue-200 text-gray-900 hover:border-blue-300"
        } focus:outline-none focus:ring-4 focus:ring-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown
          className={`w-5 h-5 shrink-0 opacity-50 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className={`absolute z-50 mt-2 w-full rounded-xl border-2 overflow-hidden shadow-xl ${
              darkMode
                ? "bg-slate-900 border-slate-700"
                : "bg-white border-blue-200"
            }`}
          >
            {options.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full text-start px-4 py-2.5 text-sm font-semibold transition-colors ${
                    opt.value === value
                      ? "bg-blue-500 text-white"
                      : darkMode
                        ? "text-slate-200 hover:bg-slate-800"
                        : "text-gray-800 hover:bg-blue-50"
                  }`}
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [savePath, setSavePath] = useState("");
  const [darkMode, setDarkMode] = useState(true);
  const [language, setLanguage] = useState("en");
  const [isDownloading, setIsDownloading] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [ytdlpReady, setYtdlpReady] = useState(true);
  const [downloadStats, setDownloadStats] = useState<ProgressPayload | null>(
    null,
  );
  const [downloadSuccessInfo, setDownloadSuccessInfo] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [downloadType, setDownloadType] = useState<"audio" | "video">("audio");
  const [audioQuality, setAudioQuality] = useState("medium");
  const [videoQuality, setVideoQuality] = useState("720p");
  const [isMaximized, setIsMaximized] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);

  // Window Controls
  const minimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      console.error("Failed to minimize window:", error);
    }
  };
  const toggleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
      setIsMaximized(await getCurrentWindow().isMaximized());
    } catch (error) {
      console.error("Failed to toggle maximize:", error);
    }
  };
  const closeWindow = async () => {
    try {
      await getCurrentWindow().close();
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  };

  // Listen for real-time progress
  useEffect(() => {
    let unlisten: () => void;

    async function setupListener() {
      unlisten = await listen<ProgressPayload>("download-progress", (event) => {
        setDownloadStats(event.payload);
      });
    }

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Auto-dismiss alerts
  useEffect(() => {
    if (!alert) return;

    let timeout: ReturnType<typeof setTimeout>;

    if (alert.type === "success") {
      timeout = setTimeout(() => setAlert(null), 8000);
    } else if (alert.type === "info") {
      timeout = setTimeout(() => setAlert(null), 6000);
    } else if (alert.type === "warning") {
      timeout = setTimeout(() => setAlert(null), 8000);
    } else if (alert.type === "error") {
      timeout = setTimeout(() => setAlert(null), 10000);
    }

    return () => clearTimeout(timeout);
  }, [alert]);

  // Check internet connection
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

  // Block Developer Tools and Context Menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Allow the native context menu (cut/copy/paste) inside text fields,
      // block it everywhere else.
      const target = e.target as HTMLElement;
      const isEditable =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (!isEditable) {
        e.preventDefault();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Block F12
      if (e.key === "F12") {
        e.preventDefault();
      }
      // Block Ctrl+Shift+I (Windows/Linux) or Cmd+Option+I (Mac)
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "I" || e.key === "i")
      ) {
        e.preventDefault();
      }
      // Block Cmd+Option+I specifically for Mac
      if (
        e.metaKey &&
        e.altKey &&
        (e.key === "I" ||
          e.key === "i" ||
          e.key === "J" ||
          e.key === "j" ||
          e.key === "C" ||
          e.key === "c")
      ) {
        e.preventDefault();
      }
      // Block Ctrl+Shift+J or Ctrl+Shift+C
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "J" || e.key === "j" || e.key === "C" || e.key === "c")
      ) {
        e.preventDefault();
      }
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Initialize app
  useEffect(() => {
    initializeApp();
  }, []);

  // Apply dark mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  // Keep maximize/restore icon in sync with the actual window state
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function trackMaximize() {
      const appWindow = getCurrentWindow();
      setIsMaximized(await appWindow.isMaximized());
      unlisten = await appWindow.onResized(async () => {
        setIsMaximized(await appWindow.isMaximized());
      });
    }

    trackMaximize().catch((error) =>
      console.error("Failed to track window state:", error),
    );

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Change language
  const changeLanguage = (newLang: string) => {
    setLanguage(newLang);
    i18n.changeLanguage(newLang);
    // Set RTL for Arabic and Farsi
    if (newLang === "ar" || newLang === "fa") {
      document.documentElement.dir = "rtl";
      document.documentElement.lang = newLang;
    } else {
      document.documentElement.dir = "ltr";
      document.documentElement.lang = newLang;
    }
  };

  async function initializeApp() {
    try {
      const defaultPath = await invoke<string>("get_default_download_path");
      setSavePath(defaultPath);

      const isInstalled = await invoke<boolean>("check_ytdlp_installed");
      if (!isInstalled) {
        setAlert({
          type: "warning",
          message: t("ytdlp_not_found"),
        });
        setYtdlpReady(false);
      }
    } catch (error) {
      console.error("Initialization error:", error);
      setAlert({
        type: "error",
        message: String(error),
      });
    }
  }

  async function selectFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: savePath,
      });
      if (selected) {
        setSavePath(selected as string);
      }
    } catch (error) {
      console.error("Error selecting folder:", error);
      setAlert({
        type: "error",
        message: `${t("error_selecting_folder")}: ${String(error)}`,
      });
    }
  }

  async function openPath(path: string) {
    try {
      await invoke("open_path", { path });
    } catch (error) {
      console.error("Error opening path:", error);
      setAlert({
        type: "error",
        message: `${t("error_opening_folder")}: ${String(error)}`,
      });
    }
  }

  async function handleDownload() {
    // Validation
    if (!url.trim()) {
      setAlert({
        type: "error",
        message: t("invalid_url"),
      });
      return;
    }

    if (!savePath.trim()) {
      setAlert({
        type: "error",
        message: t("select_location"),
      });
      return;
    }

    if (!isOnline) {
      setAlert({
        type: "error",
        message: t("no_internet"),
      });
      return;
    }

    if (!ytdlpReady) {
      setAlert({
        type: "warning",
        message: t("ytdlp_not_found"),
      });
      return;
    }

    setIsDownloading(true);
    setIsCancelling(false);
    setDownloadStats(null);
    setDownloadSuccessInfo(null);

    try {
      const quality = downloadType === "audio" ? audioQuality : videoQuality;
      const result = await invoke<DownloadResult>("download_media", {
        url: url.trim(),
        outputPath: savePath,
        filename: filename.trim() || "media",
        downloadType: downloadType,
        quality: quality,
      });

      if (result.success) {
        const downloadDir =
          result.file_path?.substring(0, result.file_path.lastIndexOf("/")) ||
          savePath;
        setDownloadSuccessInfo({
          path: downloadDir,
          name:
            result.file_path?.split("/").pop() ||
            filename.trim() ||
            (downloadType === "audio" ? "audio.mp3" : "video.mp4"),
        });
        setAlert({
          type: "success",
          message: t("success"),
        });
        setUrl("");
        setFilename("");
      } else if (result.message === "Download cancelled") {
        setAlert({
          type: "info",
          message: t("download_cancelled"),
        });
      } else {
        setAlert({
          type: "error",
          message: result.message,
        });
      }
    } catch (error) {
      const errorMessage = String(error);
      if (errorMessage.includes("No such file")) {
        setAlert({
          type: "error",
          message: t("invalid_location"),
        });
      } else {
        setAlert({
          type: "error",
          message: errorMessage,
        });
      }
    } finally {
      setIsDownloading(false);
      setIsCancelling(false);
    }
  }

  const audioQualityOptions: DropdownOption[] = [
    { value: "highest", label: t("quality_highest") },
    { value: "high", label: t("quality_high") },
    { value: "medium", label: t("quality_medium") },
    { value: "low", label: t("quality_low") },
  ];

  const videoQualityOptions: DropdownOption[] = [
    { value: "4k", label: t("quality_4k") },
    { value: "1440p", label: t("quality_1440p") },
    { value: "1080p", label: t("quality_1080p") },
    { value: "720p", label: t("quality_720p") },
    { value: "480p", label: t("quality_480p") },
    { value: "best", label: t("quality_best") },
  ];

  const handleRetry = () => {
    if (isOnline) {
      handleDownload();
    } else {
      setAlert({
        type: "info",
        message: t("no_internet"),
      });
    }
  };

  async function handleCancel() {
    setIsCancelling(true);
    try {
      await invoke("cancel_download");
    } catch (error) {
      console.error("Error cancelling download:", error);
    }
  }

  return (
    <div
      className={`min-h-screen flex flex-col ${
        darkMode
          ? "dark bg-slate-950 text-white"
          : "bg-linear-to-br from-blue-50 to-indigo-100 text-gray-900"
      } transition-colors duration-300`}
    >
      {/* Custom Window Header */}
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={`${
          darkMode
            ? "bg-slate-900 border-slate-800 text-white"
            : "bg-blue-50 border-blue-200 text-gray-900"
        } border-b z-50 select-none sticky top-0 h-10 flex items-center justify-between px-4 transition-colors duration-300`}
        dir="ltr"
      >
        {/* Left: App Title and Icon (drag handle) */}
        <div
          data-tauri-drag-region
          className="flex items-center gap-3 h-full"
        >
          <Music className="w-5 h-5 text-blue-500 pointer-events-none" />
          <h1 className="text-sm font-bold truncate max-w-[300px] pointer-events-none">
            {filename || downloadSuccessInfo?.name || t("app_title")}
          </h1>
        </div>

        {/* Center: flexible drag region */}
        <div data-tauri-drag-region className="flex-1 h-full" />

        {/* Right Section: Toggles + Window Controls */}
        <div className="flex items-center h-full">
          {/* Language & Theme Controls */}
          <div
            className="flex items-center gap-2 px-4 border-r border-slate-700/20 dark:border-slate-400/10 h-8 mr-1"
            style={{ direction: "ltr" }}
          >
            <motion.select
              whileTap={{ scale: 0.95 }}
              value={language}
              onChange={(e) => changeLanguage(e.target.value)}
              className={`px-2 py-1 h-7 text-[11px] rounded border cursor-pointer font-bold transition-all appearance-none text-center ${
                darkMode
                  ? "bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500"
                  : "bg-white border-blue-200 text-gray-600 hover:text-blue-600 hover:border-blue-400"
              } focus:outline-none min-w-[40px]`}
            >
              <option value="en">EN</option>
              <option value="fa">FA</option>
              <option value="ar">AR</option>
            </motion.select>

            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setDarkMode(!darkMode)}
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                darkMode
                  ? "hover:bg-slate-800 text-yellow-400"
                  : "hover:bg-blue-100 text-blue-600"
              }`}
            >
              {darkMode ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </motion.button>
          </div>

          {/* Window Controls Group */}
          <div className="flex items-center gap-1 h-full">
            <button
              onClick={minimize}
              title={t("minimize")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                darkMode
                  ? "hover:bg-slate-800 text-slate-400"
                  : "hover:bg-gray-200 text-gray-600"
              }`}
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={toggleMaximize}
              title={isMaximized ? t("restore") : t("maximize")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                darkMode
                  ? "hover:bg-slate-800 text-slate-400"
                  : "hover:bg-gray-200 text-gray-600"
              }`}
            >
              {isMaximized ? (
                <Copy className="w-3.5 h-3.5 -scale-x-100" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={closeWindow}
              title={t("close")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                darkMode
                  ? "hover:bg-red-500 hover:text-white text-slate-400"
                  : "hover:bg-red-500 hover:text-white text-gray-600"
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.header>

      {/* Internet Status */}
      <AnimatePresence mode="wait">
        {!isOnline && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-orange-500 text-white px-6 py-3 flex items-center gap-2"
          >
            <WifiOff className="w-5 h-5" />
            <span>{t("no_internet")}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`${
            darkMode
              ? "bg-slate-900 border-slate-800 shadow-2xl"
              : "bg-white border-blue-200"
          } border rounded-2xl p-8 shadow-lg relative overflow-hidden`}
        >
          {/* Form Header - Centered */}
          <div className="flex flex-col items-center justify-center gap-4 mb-10 text-center">
            <div className="relative">
              <motion.div
                animate={{
                  boxShadow: [
                    "0 0 0px 0px rgba(239, 68, 68, 0)",
                    "0 0 15px 4px rgba(239, 68, 68, 0.4)",
                    "0 0 0px 0px rgba(239, 68, 68, 0)",
                  ],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="p-4 rounded-full bg-linear-to-br from-red-500 to-red-600 text-white shadow-lg"
              >
                <Play className="w-6 h-6 fill-white ml-0.5" />
              </motion.div>
            </div>
          </div>
          {/* URL Input */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
          >
            <label className="sm:w-32 text-sm font-bold opacity-70 mb-1 sm:mb-0 shrink-0">
              {t("url_label")}
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isDownloading && ytdlpReady) {
                  handleDownload();
                }
              }}
              placeholder={t("url_placeholder")}
              disabled={isDownloading}
              className={`flex-1 px-4 py-2.5 rounded-xl border-2 cursor-text transition-all ${
                darkMode
                  ? "bg-slate-800/50 border-slate-700 focus:border-blue-500"
                  : "bg-blue-50/50 border-blue-200 focus:border-blue-500"
              } focus:outline-none focus:ring-4 focus:ring-blue-500/10 disabled:opacity-50`}
            />
          </motion.div>

          {/* Filename Input */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-6 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
          >
            <label className="sm:w-32 text-sm font-bold opacity-70 mb-1 sm:mb-0 shrink-0">
              {t("filename_label")}
            </label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isDownloading && ytdlpReady) {
                  handleDownload();
                }
              }}
              placeholder={t("filename_placeholder")}
              disabled={isDownloading}
              className={`flex-1 px-4 py-2.5 rounded-xl border-2 cursor-text transition-all ${
                darkMode
                  ? "bg-slate-800/50 border-slate-700 focus:border-blue-500"
                  : "bg-blue-50/50 border-blue-200 focus:border-blue-500"
              } focus:outline-none focus:ring-4 focus:ring-blue-500/10 disabled:opacity-50`}
            />
          </motion.div>

          {/* Unified Settings Box */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className={`grid grid-cols-1 sm:grid-cols-2 gap-8 mb-8 p-6 rounded-2xl border ${
              darkMode
                ? "bg-slate-800/40 border-slate-700/50 shadow-inner"
                : "bg-blue-50/30 border-blue-200/50 shadow-sm"
            }`}
          >
            {/* Download Type Selection */}
            <div>
              <label className="block text-sm font-bold mb-4 opacity-80 uppercase tracking-wider">
                {t("download_type_label")}
              </label>
              <div className="flex gap-6">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input
                      type="radio"
                      name="downloadType"
                      value="audio"
                      checked={downloadType === "audio"}
                      onChange={(e) =>
                        setDownloadType(e.target.value as "audio" | "video")
                      }
                      disabled={isDownloading}
                      className="peer w-5 h-5 cursor-pointer appearance-none rounded-full border-2 border-slate-400 checked:border-blue-500 transition-all"
                    />
                    <div className="absolute w-2.5 h-2.5 rounded-full bg-blue-500 scale-0 peer-checked:scale-100 transition-transform" />
                  </div>
                  <span className="text-sm font-semibold group-hover:text-blue-500 transition-colors">
                    {t("download_type_audio")}
                  </span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input
                      type="radio"
                      name="downloadType"
                      value="video"
                      checked={downloadType === "video"}
                      onChange={(e) =>
                        setDownloadType(e.target.value as "audio" | "video")
                      }
                      disabled={isDownloading}
                      className="peer w-5 h-5 cursor-pointer appearance-none rounded-full border-2 border-slate-400 checked:border-blue-500 transition-all"
                    />
                    <div className="absolute w-2.5 h-2.5 rounded-full bg-blue-500 scale-0 peer-checked:scale-100 transition-transform" />
                  </div>
                  <span className="text-sm font-semibold group-hover:text-blue-500 transition-colors">
                    {t("download_type_video")}
                  </span>
                </label>
              </div>
            </div>

            {/* Quality Selection */}
            <div>
              <label className="block text-sm font-bold mb-3 opacity-80 uppercase tracking-wider">
                {t("quality_label")}
              </label>
              {downloadType === "audio" ? (
                <StyledDropdown
                  value={audioQuality}
                  options={audioQualityOptions}
                  onChange={setAudioQuality}
                  disabled={isDownloading}
                  darkMode={darkMode}
                />
              ) : (
                <StyledDropdown
                  value={videoQuality}
                  options={videoQualityOptions}
                  onChange={setVideoQuality}
                  disabled={isDownloading}
                  darkMode={darkMode}
                />
              )}
            </div>
          </motion.div>

          {/* Save Location */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mb-8 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
          >
            <label className="sm:w-32 text-sm font-bold opacity-70 mb-1 sm:mb-0 shrink-0">
              {t("save_location")}
            </label>
            <div className="flex-1 flex gap-3" style={{ direction: "ltr" }}>
              <input
                type="text"
                value={savePath}
                readOnly
                className={`flex-1 px-4 py-2.5 rounded-xl border-2 cursor-default transition-all ${
                  darkMode
                    ? "bg-slate-800/50 border-slate-700"
                    : "bg-blue-50/50 border-blue-200"
                } focus:outline-none`}
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={selectFolder}
                disabled={isDownloading}
                className={`px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  darkMode
                    ? "bg-slate-800 hover:bg-slate-700 border border-slate-700"
                    : "bg-blue-100 hover:bg-blue-200 border border-blue-200"
                } disabled:opacity-50`}
              >
                <Folder className="w-4 h-4 text-blue-500" />
                {t("browse_button")}
              </motion.button>
            </div>
          </motion.div>

          {/* Progress Bar */}
          <AnimatePresence mode="wait">
            {isDownloading && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-6 overflow-hidden"
              >
                {downloadStats ? (
                  <>
                    <div className="flex justify-between items-end mb-2">
                      <span className="text-sm font-semibold text-blue-500">
                        {t("downloading")} {downloadStats.percent.toFixed(1)}%
                      </span>
                      <span className="text-xs font-mono opacity-80">
                        {downloadStats.size}
                      </span>
                    </div>
                    <div
                      className={`w-full h-2.5 rounded-full overflow-hidden ${
                        darkMode ? "bg-slate-800" : "bg-blue-200"
                      }`}
                    >
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${downloadStats.percent}%` }}
                        transition={{ ease: "linear", duration: 0.3 }}
                        className="h-full bg-linear-to-r from-blue-500 to-indigo-600 rounded-full"
                      />
                    </div>
                    <div className="flex justify-between items-center mt-2 text-xs font-mono opacity-70">
                      <span>Speed: {downloadStats.speed}</span>
                      <span>ETA: {downloadStats.eta}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold mb-2 text-blue-500 animate-pulse">
                      {t("please_wait")}...
                    </p>
                    <div
                      className={`w-full h-2.5 rounded-full overflow-hidden relative ${darkMode ? "bg-slate-800" : "bg-blue-200"}`}
                    >
                      <div className="absolute top-0 left-0 h-full w-1/3 bg-blue-500 rounded-full animate-[loading_1.5s_infinite_ease-in-out]"></div>
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Buttons */}
          <div className="flex gap-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleDownload}
              disabled={isDownloading || !ytdlpReady}
              className={`flex-1 px-6 py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                isDownloading
                  ? darkMode
                    ? "bg-slate-700 text-gray-400"
                    : "bg-gray-300 text-gray-500"
                  : "bg-linear-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white active:scale-95"
              }`}
            >
              {isDownloading ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1 }}
                  >
                    <Download className="w-5 h-5" />
                  </motion.div>
                  {t("please_wait")}
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  {t("download_button")}
                </>
              )}
            </motion.button>

            {isDownloading && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleCancel}
                disabled={isCancelling}
                className={`px-6 py-3 rounded-lg font-bold cursor-pointer transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  darkMode
                    ? "bg-red-900/30 hover:bg-red-900/50 text-red-300"
                    : "bg-red-200 hover:bg-red-300 text-red-700"
                }`}
              >
                <X className="w-5 h-5" />
                {isCancelling ? t("cancelling") : t("cancel_button")}
              </motion.button>
            )}
          </div>

          {/* Persistent Download Success Area */}
          <AnimatePresence>
            {downloadSuccessInfo && !isDownloading && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`mt-6 p-5 rounded-xl border ${
                  darkMode
                    ? "bg-green-900/10 border-green-800"
                    : "bg-green-50 border-green-200"
                } flex flex-col sm:flex-row items-center justify-between gap-4`}
                dir="ltr"
              >
                <div className="flex items-center gap-4 text-left w-full">
                  <div
                    className={`p-3 rounded-full shrink-0 ${
                      darkMode
                        ? "bg-green-900/50 text-green-400"
                        : "bg-green-200 text-green-700"
                    }`}
                  >
                    <Check className="w-6 h-6" />
                  </div>
                  <div className="overflow-hidden w-full">
                    <p
                      className="font-bold text-sm sm:text-base truncate max-w-full"
                      style={{ direction: "ltr" }}
                    >
                      {downloadSuccessInfo.name}
                    </p>
                    <p
                      className={`text-xs mt-1 truncate max-w-full ${darkMode ? "text-gray-400" : "text-gray-600"}`}
                      style={{ direction: "ltr" }}
                    >
                      {downloadSuccessInfo.path}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => openPath(downloadSuccessInfo.path)}
                  className="whitespace-nowrap px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all shadow-sm active:scale-95 bg-linear-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white cursor-pointer"
                >
                  <Folder className="w-5 h-5" />
                  {t("open_folder")}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>

      {/* Alert Messages */}
      <AnimatePresence>
        {alert && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 max-w-md rounded-lg p-4 flex items-start gap-3 shadow-lg backdrop-blur-sm ${
              alert.type === "success"
                ? darkMode
                  ? "bg-green-900/50 border border-green-700"
                  : "bg-green-100 border border-green-300"
                : alert.type === "error"
                  ? darkMode
                    ? "bg-red-900/50 border border-red-700"
                    : "bg-red-100 border border-red-300"
                  : alert.type === "warning"
                    ? darkMode
                      ? "bg-yellow-900/50 border border-yellow-700"
                      : "bg-yellow-100 border border-yellow-300"
                    : darkMode
                      ? "bg-blue-900/50 border border-blue-700"
                      : "bg-blue-100 border border-blue-300"
            } ${
              alert.type === "success"
                ? darkMode
                  ? "text-green-100"
                  : "text-green-800"
                : alert.type === "error"
                  ? darkMode
                    ? "text-red-100"
                    : "text-red-800"
                  : alert.type === "warning"
                    ? darkMode
                      ? "text-yellow-100"
                      : "text-yellow-800"
                    : darkMode
                      ? "text-blue-100"
                      : "text-blue-800"
            }`}
          >
            <div>
              {alert.type === "success" && <Check className="w-5 h-5 mt-0.5" />}
              {alert.type === "error" && (
                <AlertCircle className="w-5 h-5 mt-0.5" />
              )}
              {alert.type === "warning" && (
                <AlertCircle className="w-5 h-5 mt-0.5" />
              )}
              {alert.type === "info" && (
                <AlertCircle className="w-5 h-5 mt-0.5" />
              )}
            </div>
            <div className="flex-1">
              <p className="font-semibold">{t(`${alert.type}`)}</p>
              <p className="text-sm opacity-90 mt-1">{alert.message}</p>
              {alert.type === "error" && (
                <button
                  onClick={handleRetry}
                  className="mt-2 text-sm font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  {t("retry")}
                </button>
              )}
            </div>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setAlert(null)}
              className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
            >
              ✕
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

export default App;
