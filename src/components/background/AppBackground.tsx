import { useCallback, useEffect, useRef, useState } from "react";

import type { EffectsLevel } from "../../hooks/useAppPreferences";
import { AuroraCanvas } from "./AuroraCanvas";
import { BackdropLayers } from "./BackdropLayers";
import { BACKDROP_SCENE, type BackdropId } from "./backdrops";
import { useBackgroundActivity } from "./useBackgroundActivity";
import "./background.css";

interface Props {
  effects: EffectsLevel;
  /** Which picture -- see `backdrops.ts`. */
  backdrop: BackdropId;
}

/**
 * The layer behind the whole window.
 *
 * Mounted as the first child of the shell, under everything: the title bar,
 * the sidebar, the cards and the status bar are glass over it (theme.css,
 * `glass-*`). Pointer events never reach it.
 *
 * Built in layers so every mode is a subset of the next:
 *   off  -- a still wash of the aurora hues, a dot lattice, film grain, a
 *           vignette.
 *   lite -- plus drifting aurora blobs, a sweeping curtain, floating glyphs.
 *   full -- the WebGL scene (aurora shader + 3D icons) in place of the
 *           blobs and glyphs. The CSS layer stays until the scene's first
 *           frame, and comes back for good if WebGL is missing or slow.
 */
export function AppBackground({ effects, backdrop }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const activity = useBackgroundActivity();
  const animated = effects !== "off" && !activity.reducedMotion;
  // Per session: a GPU that could not keep up once is not asked again until
  // the next launch, or until the setting is changed.
  const [webgl, setWebgl] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    if (effects !== "full") setWebgl("loading");
  }, [effects]);
  // A new picture is a new scene: back to the CSS drawing until its first
  // frame is up. A GPU that failed stays failed for the session.
  useEffect(() => {
    setWebgl((current) => (current === "failed" ? current : "loading"));
  }, [backdrop]);
  const onReady = useCallback(() => setWebgl("ready"), []);
  const onFail = useCallback(() => setWebgl("failed"), []);
  const sceneTheme = BACKDROP_SCENE[backdrop];
  const useWebgl = effects === "full" && webgl !== "failed" && sceneTheme !== null;
  // Drawn in every mode now -- held still when effects are off -- so turning
  // them down changes how much moves, never whether there is a picture.
  const cssLayer = !(useWebgl && webgl === "ready");

  // Pointer parallax. Throttled to a frame, and written as two custom
  // properties on this element only -- the icons read them through CSS, so a
  // pointer move restyles fourteen spans and nothing else.
  useEffect(() => {
    const element = root.current;
    if (!element || !animated || !activity.visible) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      frame = 0;
      element.style.setProperty("--px", x.toFixed(3));
      element.style.setProperty("--py", y.toFixed(3));
    };
    const onMove = (event: PointerEvent) => {
      x = (event.clientX / window.innerWidth) * 2 - 1;
      y = (event.clientY / window.innerHeight) * 2 - 1;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [animated, activity.visible]);

  return (
    <div
      ref={root}
      className="mtk-bg"
      aria-hidden
      data-effects={effects}
      data-backdrop={backdrop}
    >
      <div className="mtk-bg-base" />
      {cssLayer && <BackdropLayers id={backdrop} />}
      {useWebgl && sceneTheme && (
        <AuroraCanvas
          key={sceneTheme}
          theme={sceneTheme}
          activity={activity}
          onReady={onReady}
          onFail={onFail}
        />
      )}
      {/* Over the scene, not under it: the WebGL canvas is opaque. The
          lattice belongs to the aurora; the other pictures have their own
          texture. */}
      {backdrop === "aurora" && <div className="mtk-bg-grid" />}
      <div className="mtk-bg-vignette" />
      <div className="mtk-bg-grain" />
    </div>
  );
}
