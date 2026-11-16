import { useEffect, useRef, useState } from "react";

import type { AuroraScene, SceneColors } from "./scene/auroraScene";
import type { BackgroundActivity } from "./useBackgroundActivity";

interface Props {
  activity: BackgroundActivity;
  /** The first frame is on screen: the CSS layer under it can go. */
  onReady: () => void;
  /** No WebGL, a lost context, or a GPU that cannot keep up. */
  onFail: () => void;
}

/** Full rate while the window is in front, a trickle while it is not. */
const FPS_FOCUSED = 30;
const FPS_BLURRED = 12;

/** How often the theme's colours are read back. The aurora tokens transition
 *  over 1.4s on a change of screen; the scene eases between samples. */
const COLOR_SAMPLE_MS = 300;

function readColors(element: Element): SceneColors {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    base: read("--color-aurora-base", "#060a12"),
    a: read("--color-aurora-1", "#0f766e"),
    b: read("--color-aurora-2", "#5b21b6"),
    c: read("--color-aurora-3", "#1e40af"),
    icon: read("--color-aurora-icon", "#2dd4bf"),
    dark: document.documentElement.classList.contains("dark"),
  };
}

/**
 * The WebGL half of the background: an aurora shader with extruded media
 * glyphs floating in front of it.
 *
 * three.js is loaded on demand, the first time this mounts, so the app's first
 * paint never waits for it -- the CSS layer is on screen until the first frame
 * here is drawn, and stays if anything goes wrong.
 */
export function AuroraCanvas({ activity, onReady, onFail }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<AuroraScene | null>(null);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ onReady, onFail });
  callbacks.current = { onReady, onFail };
  const activityRef = useRef(activity);
  activityRef.current = activity;

  // Create once; dispose on the way out.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let disposed = false;

    import("./scene/auroraScene")
      .then(({ createAuroraScene }) => {
        if (disposed) return;
        const created = createAuroraScene(element, {
          onFirstFrame: () => {
            setReady(true);
            callbacks.current.onReady();
          },
          onFail: () => callbacks.current.onFail(),
        });
        created.setColors(readColors(element));
        scene.current = created;
        const current = activityRef.current;
        if (current.reducedMotion || !current.visible) created.renderOnce();
        else created.setFrameRate(current.focused ? FPS_FOCUSED : FPS_BLURRED);
      })
      // The chunk failed to load, or the renderer could not get a context.
      .catch(() => callbacks.current.onFail());

    return () => {
      disposed = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  // Running, slowed, stopped, or one still frame.
  useEffect(() => {
    const current = scene.current;
    if (!current) return;
    if (!activity.visible) {
      current.setFrameRate(0);
    } else if (activity.reducedMotion) {
      current.setFrameRate(0);
      current.renderOnce();
    } else {
      current.setFrameRate(activity.focused ? FPS_FOCUSED : FPS_BLURRED);
    }
  }, [activity.visible, activity.focused, activity.reducedMotion]);

  // The theme and the screen's tint, read back from CSS.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !activity.visible) return;
    let last = "";
    const sample = () => {
      if (!scene.current) return;
      const colors = readColors(element);
      const key = JSON.stringify(colors);
      if (key === last) return;
      last = key;
      scene.current.setColors(colors);
      // A still picture is redrawn only when there is something new to show.
      if (activityRef.current.reducedMotion) scene.current.renderOnce();
    };
    sample();
    const timer = setInterval(sample, COLOR_SAMPLE_MS);
    return () => clearInterval(timer);
  }, [activity.visible]);

  // The pointer, for the parallax and the glow that follows it.
  useEffect(() => {
    if (!activity.visible || activity.reducedMotion) return;
    const onMove = (event: PointerEvent) => {
      scene.current?.setPointer(
        (event.clientX / window.innerWidth) * 2 - 1,
        (event.clientY / window.innerHeight) * 2 - 1,
      );
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [activity.visible, activity.reducedMotion]);

  return <canvas ref={canvas} className="mtk-bg-canvas" data-ready={ready ? "" : undefined} />;
}
