import {
  Crop,
  Download,
  FileVideo2,
  Repeat2,
  Scissors,
  Shrink,
  type LucideIcon,
} from "lucide-react";

import type { Route } from "../../app/navigation";

export interface ToolDefinition {
  route: Route;
  /** i18n key for the name. */
  key: string;
  icon: LucideIcon;
  /** Media tools need a file; download does not. Drives which cards light up
   *  when a file is dropped on the home screen. */
  takesFile: boolean;
}

export const TOOLS: ToolDefinition[] = [
  { route: { name: "download" }, key: "download", icon: Download, takesFile: false },
  { route: { name: "compress" }, key: "compress", icon: Shrink, takesFile: true },
  { route: { name: "trim" }, key: "trim", icon: Scissors, takesFile: true },
  { route: { name: "convert" }, key: "convert", icon: Repeat2, takesFile: true },
  { route: { name: "resize" }, key: "resize", icon: Crop, takesFile: true },
  { route: { name: "gif" }, key: "gif", icon: FileVideo2, takesFile: true },
];
