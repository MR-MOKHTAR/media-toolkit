import {
  Captions,
  Crop,
  Download,
  FileVideo2,
  Repeat2,
  Scissors,
  Shrink,
  type LucideIcon,
} from "lucide-react";

import type { Route } from "./navigation";

export interface ToolDefinition {
  route: Route;
  /** i18n key for the name: `tool_${key}`. */
  key: string;
  icon: LucideIcon;
}

/**
 * The seven tools, in the order the sidebar lists them.
 *
 * Download first because it is where the app opens and the only one that needs
 * no file; the five ffmpeg tools next, roughly by how often they are reached;
 * transcribe last, being the only one that talks to a server.
 */
export const TOOLS: ToolDefinition[] = [
  { route: { name: "download" }, key: "download", icon: Download },
  { route: { name: "compress" }, key: "compress", icon: Shrink },
  { route: { name: "trim" }, key: "trim", icon: Scissors },
  { route: { name: "convert" }, key: "convert", icon: Repeat2 },
  { route: { name: "resize" }, key: "resize", icon: Crop },
  { route: { name: "gif" }, key: "gif", icon: FileVideo2 },
  // `Captions` rather than `Mic`: a microphone reads as "record", which is the
  // one thing this tool does not do.
  { route: { name: "transcribe" }, key: "transcribe", icon: Captions },
];
