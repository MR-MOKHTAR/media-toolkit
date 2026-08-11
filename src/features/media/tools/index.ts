/**
 * The ffmpeg tools, as data.
 *
 * Adding a tool is a file in this folder and a line here -- no screen, no
 * layout, no drop zone, no ready check, no output row. The form itself is
 * `MediaToolScreen`, once, and the sidebar changes which of these it is given.
 */
import type { Route } from "../../../app/navigation";
import type {
  AnyMediaToolConfig,
  MediaToolKind,
} from "../components/MediaToolScreen";
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

/** Whether this route is one of them, and carries the dropped file that every
 *  tool route may arrive with. */
export function isMediaToolRoute(
  route: Route,
): route is { name: MediaToolKind; file?: string } {
  return route.name in MEDIA_TOOLS;
}
