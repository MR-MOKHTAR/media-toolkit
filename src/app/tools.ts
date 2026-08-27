import {
  AudioLines,
  Captions,
  Download,
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
 * The six tools, in the order the sidebar lists them.
 *
 * Download first because it is where the app opens and the only one that needs
 * no file; the four ffmpeg tools next, roughly by how often they are reached;
 * then transcribe, the only one that talks to a server.
 */
export const TOOLS: ToolDefinition[] = [
  { route: { name: "download" }, key: "download", icon: Download },
  { route: { name: "compress" }, key: "compress", icon: Shrink },
  { route: { name: "trim" }, key: "trim", icon: Scissors },
  { route: { name: "convert" }, key: "convert", icon: Repeat2 },
  { route: { name: "extractAudio" }, key: "extractAudio", icon: AudioLines },
  // `Captions` rather than `Mic`: a microphone reads as "record", which is the
  // one thing this tool does not do.
  { route: { name: "transcribe" }, key: "transcribe", icon: Captions },
];

/**
 * A tool's icon, by the same key its name and its description are stored under.
 *
 * The sidebar walks `TOOLS` in order; a tool screen knows only which tool it is
 * and needs the one icon. Deriving the lookup from the list rather than writing
 * it out again is what keeps the mark at the top of a screen and the row that
 * led there from ever being two different glyphs.
 */
export const TOOL_ICON: Record<string, LucideIcon> = Object.fromEntries(
  TOOLS.map((tool) => [tool.key, tool.icon]),
);
