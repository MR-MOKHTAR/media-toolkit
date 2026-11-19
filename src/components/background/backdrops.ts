import type { SceneTheme } from "./scene/shaders";

/**
 * The pictures the window can be painted with. Each is drawn three ways --
 * the WebGL scene (`full`), CSS layers (`lite`, and the fallback wherever
 * WebGL is missing or slow), and the same CSS layers held still (`off`) -- so
 * turning the effects down never leaves a plain background behind.
 */
export type BackdropId = "aurora" | "silk" | "cosmos" | "girih" | "mesh";

export const BACKDROPS: BackdropId[] = ["aurora", "silk", "cosmos", "girih", "mesh"];

export const DEFAULT_BACKDROP: BackdropId = "aurora";

export function isBackdropId(value: unknown): value is BackdropId {
  return BACKDROPS.includes(value as BackdropId);
}

/** The shader each picture has in `full`, or null where the CSS drawing is the
 *  whole of it -- girih is line art, which a fragment shader would only blur. */
export const BACKDROP_SCENE: Record<BackdropId, SceneTheme | null> = {
  aurora: "aurora",
  silk: "silk",
  cosmos: "cosmos",
  girih: null,
  mesh: "mesh",
};
