import {
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  NoToneMapping,
  HalfFloatType,
  HemisphereLight,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  WebGLRenderer,
  WebGLRenderTarget,
  type Texture,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { MEDIA_SHAPES } from "./mediaShapes";
import { SCENE_SHADERS, type SceneTheme } from "./shaders";

/** The colours the scene is drawn in, as CSS colour strings -- read straight
 *  off the theme's `--color-aurora-*` tokens by the host. */
export interface SceneColors {
  base: string;
  a: string;
  b: string;
  c: string;
  icon: string;
  dark: boolean;
}

export interface AuroraScene {
  /** New target colours. The scene eases towards them over about a second. */
  setColors(colors: SceneColors): void;
  /** Pointer position, -1..1 on both axes. */
  setPointer(x: number, y: number): void;
  /** Run the loop at this many frames per second, or stop it (0). */
  setFrameRate(fps: number): void;
  /** Draw a single frame now -- the still picture for reduced motion. */
  renderOnce(): void;
  dispose(): void;
}

interface Options {
  /** Which picture to paint -- see `shaders.ts`. */
  theme: SceneTheme;
  /** After the first frame is on the canvas, so the host can fade it in. */
  onFirstFrame: () => void;
  /** The GPU is not keeping up, or the context was lost: give up. */
  onFail: () => void;
}

/* ----------------------------------------------------------------- aurora --
 * Domain-warped fbm noise for the slow wash of colour, plus a sine curtain for
 * the bands of light that make it read as an aurora. Rendered at half
 * resolution into a target that becomes the scene's background: there is no
 * detail in it that needs full resolution, and it is the per-pixel cost. */

const AURORA_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;


/* ------------------------------------------------------------------ icons --
 * Where each glyph floats, in screen terms: x and y from 0 to 1 across the
 * window, z from -1 (far) to 1 (near). Hand-placed for the same reason as the
 * CSS layer's: margins and gaps, never a clump behind the middle of a card. */
const SPOTS: Array<{ x: number; y: number; z: number; shape: number }> = [
  { x: 0.06, y: 0.15, z: 0.9, shape: 0 },
  { x: 0.9, y: 0.1, z: 0.4, shape: 1 },
  { x: 0.72, y: 0.19, z: -0.6, shape: 2 },
  { x: 0.95, y: 0.5, z: 0.8, shape: 3 },
  { x: 0.1, y: 0.52, z: -0.2, shape: 4 },
  { x: 0.84, y: 0.84, z: 0.55, shape: 5 },
  { x: 0.34, y: 0.93, z: -0.4, shape: 6 },
  { x: 0.05, y: 0.87, z: 0.35, shape: 7 },
  { x: 0.5, y: 0.05, z: -0.8, shape: 8 },
  { x: 0.26, y: 0.16, z: -0.9, shape: 1 },
  { x: 0.63, y: 0.95, z: -1, shape: 4 },
  { x: 0.97, y: 0.93, z: -0.3, shape: 2 },
];

const FOV = 35;
const CAMERA_Z = 14;
/** Below this many frames a second, sustained, the scene gives up. */
const SLOW_FPS = 18;

interface Floater {
  mesh: Mesh<ExtrudeGeometry, MeshPhysicalMaterial>;
  spot: (typeof SPOTS)[number];
  phase: number;
  speed: number;
  spin: number;
}

export function createAuroraScene(canvas: HTMLCanvasElement, options: Options): AuroraScene {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
  renderer.outputColorSpace = SRGBColorSpace;
  // No tone mapping: the background pass runs through it too, and a filmic
  // curve would pull the aurora away from the theme colours it is drawn in.
  renderer.toneMapping = NoToneMapping;

  // --- the aurora, into a half-resolution target ---
  const auroraTarget = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  });
  const uniforms = {
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uStrength: { value: 0.6 },
    uDark: { value: 1 },
    uPointer: { value: [0, 0] as [number, number] },
    uBase: { value: new Color() },
    uA: { value: new Color() },
    uB: { value: new Color() },
    uC: { value: new Color() },
  };
  const auroraMaterial = new ShaderMaterial({
    vertexShader: AURORA_VERTEX,
    fragmentShader: SCENE_SHADERS[options.theme].fragment,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const auroraQuad = new Mesh(new PlaneGeometry(2, 2), auroraMaterial);
  const auroraScene = new Scene();
  auroraScene.add(auroraQuad);
  const auroraCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // --- the icons ---
  const scene = new Scene();
  scene.background = auroraTarget.texture;

  // The glyphs are drawn only by the themes that float them; the others skip
  // the environment map as well, which is the expensive part of setting up.
  const withIcons = SCENE_SHADERS[options.theme].icons;
  let environment: Texture | null = null;
  if (withIcons) {
    const pmrem = new PMREMGenerator(renderer);
    environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    pmrem.dispose();
  }

  const hemisphere = new HemisphereLight(0xffffff, 0x223344, 0.6);
  scene.add(hemisphere);
  const key = new DirectionalLight(0xffffff, 1.4);
  key.position.set(-4, 6, 8);
  scene.add(key);

  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAMERA_Z);

  const geometries = (withIcons ? MEDIA_SHAPES : []).map((build) => {
    const geometry = new ExtrudeGeometry(build(), {
      depth: 0.32,
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.07,
      bevelSegments: 4,
      curveSegments: 24,
    });
    geometry.center();
    return geometry;
  });

  const group = new Group();
  scene.add(group);

  const floaters: Floater[] = (withIcons ? SPOTS : []).map((spot, index) => {
    const material = new MeshPhysicalMaterial({
      metalness: 0.15,
      roughness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      iridescence: 0.8,
      iridescenceIOR: 1.35,
      envMapIntensity: 0.9,
      transparent: true,
    });
    const mesh = new Mesh(geometries[spot.shape], material);
    group.add(mesh);
    return {
      mesh,
      spot,
      phase: index * 1.7,
      speed: 0.25 + ((index * 37) % 10) / 40,
      spin: (index % 2 ? 1 : -1) * (0.12 + ((index * 13) % 7) / 50),
    };
  });

  // --- colours, eased ---
  const target = {
    base: new Color(),
    a: new Color(),
    b: new Color(),
    c: new Color(),
    icon: new Color(),
    dark: true,
  };
  const iconColor = new Color();
  let primed = false;

  const setColors = (colors: SceneColors) => {
    target.base.setStyle(colors.base);
    target.a.setStyle(colors.a);
    target.b.setStyle(colors.b);
    target.c.setStyle(colors.c);
    target.icon.setStyle(colors.icon);
    target.dark = colors.dark;
    if (!primed) {
      primed = true;
      uniforms.uBase.value.copy(target.base);
      uniforms.uA.value.copy(target.a);
      uniforms.uB.value.copy(target.b);
      uniforms.uC.value.copy(target.c);
      iconColor.copy(target.icon);
      uniforms.uDark.value = target.dark ? 1 : 0;
    }
  };

  // --- layout ---
  let width = 1;
  let height = 1;

  const place = () => {
    const halfHeightAt = (distance: number) => Math.tan((FOV * Math.PI) / 360) * distance;
    floaters.forEach(({ mesh, spot }) => {
      const z = spot.z * 3;
      const distance = CAMERA_Z - z;
      const halfH = halfHeightAt(distance);
      const halfW = halfH * camera.aspect;
      mesh.position.set((spot.x * 2 - 1) * halfW, (1 - spot.y * 2) * halfH, z);
      mesh.userData.base = mesh.position.clone();
      // Near glyphs larger, so the depth reads even without the blur a camera
      // would add.
      mesh.scale.setScalar(0.22 + (spot.z + 1) * 0.15);
    });
  };

  /** Repaints a still scene after a resize. Assigned once the loop exists. */
  let redrawStill = () => {};

  const resize = () => {
    const box = canvas.parentElement?.getBoundingClientRect();
    width = Math.max(1, Math.round(box?.width ?? window.innerWidth));
    height = Math.max(1, Math.round(box?.height ?? window.innerHeight));
    renderer.setSize(width, height, false);
    const ratio = renderer.getPixelRatio();
    auroraTarget.setSize(Math.ceil((width * ratio) / 2), Math.ceil((height * ratio) / 2));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    uniforms.uAspect.value = width / height;
    place();
    // `setSize` clears the drawing buffer. A scene that is not looping --
    // reduced motion, or a hidden window -- would stay black until something
    // else asked for a frame.
    redrawStill();
  };

  const observer = new ResizeObserver(resize);
  if (canvas.parentElement) observer.observe(canvas.parentElement);
  resize();

  // --- the frame ---
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const startedAt = performance.now();
  let firstFrame = true;

  const draw = (now: number) => {
    const time = (now - startedAt) / 1000;

    // Colours: a step of the way to the target each frame, so a change of
    // screen or theme glides instead of cutting.
    const k = 0.06;
    uniforms.uBase.value.lerp(target.base, k);
    uniforms.uA.value.lerp(target.a, k);
    uniforms.uB.value.lerp(target.b, k);
    uniforms.uC.value.lerp(target.c, k);
    iconColor.lerp(target.icon, k);
    uniforms.uStrength.value += ((target.dark ? 0.62 : 0.55) - uniforms.uStrength.value) * k;
    uniforms.uDark.value += ((target.dark ? 1 : 0) - uniforms.uDark.value) * k;
    uniforms.uTime.value = time;

    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    uniforms.uPointer.value = [pointer.x, pointer.y];
    camera.position.x = pointer.x * 0.7;
    camera.position.y = -pointer.y * 0.45;
    camera.lookAt(0, 0, 0);

    const palette = [uniforms.uA.value, uniforms.uB.value, uniforms.uC.value, iconColor];
    floaters.forEach(({ mesh, spot, phase, speed, spin }, index) => {
      const base = mesh.userData.base as typeof mesh.position | undefined;
      if (!base) return;
      mesh.position.set(
        base.x + Math.sin(time * speed * 0.6 + phase) * 0.25,
        base.y + Math.sin(time * speed + phase) * 0.35,
        base.z,
      );
      mesh.rotation.set(
        Math.sin(time * 0.3 + phase) * 0.25,
        Math.sin(time * spin + phase) * 0.7,
        Math.sin(time * 0.2 + phase) * 0.12,
      );
      const material = mesh.material;
      material.color.copy(palette[index % palette.length]).lerp(iconColor, 0.35);
      // Near glyphs clearer, far ones fainter -- depth by air.
      const nearness = (spot.z + 1) / 2;
      material.opacity = (target.dark ? 0.26 : 0.22) + nearness * 0.32;
    });

    renderer.setRenderTarget(auroraTarget);
    renderer.render(auroraScene, auroraCamera);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);

    if (firstFrame) {
      firstFrame = false;
      options.onFirstFrame();
    }
  };

  // --- the loop ---
  let fps = 0;
  let frame = 0;
  let last = 0;
  // A rolling count of how fast frames actually arrive, to notice a GPU that
  // cannot keep up. Only judged at the full rate, and not in the first seconds,
  // when shaders are still compiling.
  let windowStart = 0;
  let windowFrames = 0;
  let slowWindows = 0;

  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    const interval = 1000 / fps;
    if (now - last < interval - 2) return;
    last = now;
    draw(now);

    if (fps >= 30 && now - startedAt > 4000) {
      if (!windowStart) windowStart = now;
      windowFrames += 1;
      if (now - windowStart >= 2000) {
        const measured = (windowFrames * 1000) / (now - windowStart);
        slowWindows = measured < SLOW_FPS ? slowWindows + 1 : 0;
        windowStart = now;
        windowFrames = 0;
        if (slowWindows >= 2) options.onFail();
      }
    } else {
      windowStart = 0;
      windowFrames = 0;
    }
  };

  const setFrameRate = (next: number) => {
    if (next === fps) return;
    fps = next;
    cancelAnimationFrame(frame);
    frame = 0;
    windowStart = 0;
    windowFrames = 0;
    if (fps > 0) frame = requestAnimationFrame(loop);
  };

  redrawStill = () => {
    if (fps === 0 && !firstFrame) draw(last || startedAt + 12_000);
  };

  const onLost = (event: Event) => {
    event.preventDefault();
    options.onFail();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    setColors,
    setPointer(x, y) {
      pointer.tx = x;
      pointer.ty = y;
    },
    setFrameRate,
    renderOnce() {
      // Settle the eased values first, so the still frame shows the real
      // colours rather than the first step towards them.
      for (let index = 0; index < 60; index += 1) {
        uniforms.uBase.value.lerp(target.base, 0.2);
        uniforms.uA.value.lerp(target.a, 0.2);
        uniforms.uB.value.lerp(target.b, 0.2);
        uniforms.uC.value.lerp(target.c, 0.2);
        iconColor.lerp(target.icon, 0.2);
      }
      draw(startedAt + 12_000);
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      geometries.forEach((geometry) => geometry.dispose());
      floaters.forEach(({ mesh }) => mesh.material.dispose());
      auroraQuad.geometry.dispose();
      auroraMaterial.dispose();
      auroraTarget.dispose();
      environment?.dispose();
      renderer.dispose();
      // `dispose` frees what three.js made, not the context itself. Each
      // switch of Effects mounts a new canvas, and the browser's cap on live
      // contexts was eventually reached -- which reads as a GPU failure and
      // turned WebGL off for the session.
      renderer.forceContextLoss();
    },
  };
}
