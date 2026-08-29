/**
 * The ffmpeg tools, as data.
 *
 * Adding a tool is a file in this folder and a line here -- no screen, no
 * layout, no drop zone, no ready check, no output row. The form itself is
 * `MediaToolForm`, once, and the sidebar changes which of these it is given.
 */
import type { Route } from "../../../app/navigation";
import type {
  AnyMediaToolConfig,
  MediaToolKind,
} from "../components/MediaToolForm";
import { compressTool } from "./compress";
import { convertTool } from "./convert";
import { extractAudioTool } from "./extractAudio";
import { trimTool } from "./trim";

export const MEDIA_TOOLS: Record<MediaToolKind, AnyMediaToolConfig> = {
  compress: compressTool,
  trim: trimTool,
  convert: convertTool,
  extractAudio: extractAudioTool,
};

/** Whether this route is one of them, and carries both the file every tool
 *  route may arrive with and whether its form is open. */
export function isMediaToolRoute(
  route: Route,
): route is { name: MediaToolKind; file?: string; composing?: boolean } {
  return route.name in MEDIA_TOOLS;
}
