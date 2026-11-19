/**
 * The fragment shaders the background scene can paint with, one per theme.
 *
 * Every one reads the same uniforms -- the theme's three aurora hues over its
 * base colour, a strength, the time and the pointer -- so the scene, its
 * easing between screens' tints and its slow-GPU fallback are written once and
 * only the picture changes. Kept out of the main bundle: this module is
 * imported by the scene, which is itself loaded on demand.
 */

export type SceneTheme = "aurora" | "silk" | "cosmos" | "mesh";

const HEADER = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform float uStrength;
uniform float uDark;
uniform vec2 uPointer;
uniform vec3 uBase;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value;
}
`;

/** The domain-warped aurora with its curtains of light. */
const AURORA = HEADER + /* glsl */ `
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime * 0.03;

  vec2 q = vec2(fbm(p * 1.3 + vec2(0.0, t)), fbm(p * 1.3 + vec2(5.2, -t)));
  vec2 r = vec2(
    fbm(p * 1.5 + 2.0 * q + vec2(1.7, 9.2) + t * 0.6),
    fbm(p * 1.5 + 2.0 * q + vec2(8.3, 2.8) - t * 0.4)
  );
  float f = fbm(p * 1.1 + 2.2 * r);

  vec3 color = uBase;
  color = mix(color, uA, clamp(f * f * 1.8, 0.0, 1.0) * uStrength);
  color = mix(color, uB, clamp(length(q) * 0.6 - 0.15, 0.0, 1.0) * uStrength * 0.85);
  color = mix(color, uC, clamp(r.y * r.y * 1.4, 0.0, 1.0) * uStrength * 0.7);

  // The curtains: soft vertical bands, brightest towards the top of the window.
  float band = sin(p.x * 2.4 + r.x * 3.0 + t * 4.0) * 0.5 + 0.5;
  float curtain = smoothstep(0.35, 1.0, band) * smoothstep(1.15, 0.2, vUv.y + (f - 0.5) * 0.5);
  color += curtain * mix(uA, uB, vUv.x) * uStrength * 0.35;

  // A faint warmth where the pointer is.
  float d = distance(vUv, uPointer * vec2(0.5, -0.5) + 0.5);
  color += uA * uStrength * 0.12 * smoothstep(0.45, 0.0, d);

  // A grain of dither against banding in the smooth gradients.
  color += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;

  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * Silk: five ribbons of fabric drifting across the window, each a soft
 * gaussian body with a moving sheen along its fold.
 */
const SILK = HEADER + /* glsl */ `
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime * 0.11;
  // A little warp, so the folds are never perfect sines.
  p += 0.06 * vec2(fbm(p * 1.6 + t), fbm(p * 1.6 - t + 4.0)) - 0.03;

  vec3 color = uBase;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float center = 0.08 + fi * 0.21
      + 0.13 * sin(p.x * 1.25 + t * 1.6 + fi * 1.9)
      + 0.05 * sin(p.x * 3.1 - t * 2.3 + fi * 0.7);
    float width = 0.11 + 0.035 * sin(t * 0.9 + fi * 2.1);
    float d = (p.y - center) / width;
    float body = exp(-d * d);
    float fold = d - 0.45 * sin(p.x * 3.6 + t * 3.0 + fi * 1.3);
    float sheen = pow(max(0.0, 1.0 - abs(fold) * 0.9), 8.0);

    vec3 ribbon = mix(uA, uB, fract(fi * 0.37 + 0.1));
    ribbon = mix(ribbon, uC, 0.5 + 0.5 * sin(p.x * 0.8 + fi + t));
    color = mix(color, ribbon, body * 0.8 * uStrength);
    color += mix(ribbon, vec3(1.0), 0.55) * sheen * body * 0.6 * uStrength;
  }

  float d = distance(vUv, uPointer * vec2(0.5, -0.5) + 0.5);
  color += uB * uStrength * 0.1 * smoothstep(0.45, 0.0, d);
  color += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * Cosmos: a nebula of the theme's hues with three layers of stars that
 * twinkle, the nearest drifting with the pointer.
 */
const COSMOS = HEADER + /* glsl */ `
float stars(vec2 p, float scale, float density, float seed) {
  vec2 g = p * scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash(id + seed);
  if (h < density) return 0.0;
  vec2 offset = (vec2(hash(id + seed + 1.3), hash(id + seed + 7.1)) - 0.5) * 0.7;
  float d = length(f - offset);
  float size = 0.03 + 0.05 * hash(id + seed + 3.7);
  float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + h * 2.5) + h * 40.0);
  return smoothstep(size, 0.0, d) * twinkle + smoothstep(size * 4.0, 0.0, d) * 0.12;
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime * 0.02;

  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 3.1));
  float cloud = fbm(p * 1.8 + 1.8 * q);
  float wisps = fbm(p * 3.2 - q * 2.0 + t * 2.0);

  vec3 color = uBase;
  color = mix(color, uA, smoothstep(0.42, 0.95, cloud) * 0.75 * uStrength);
  color = mix(color, uB, smoothstep(0.5, 1.0, length(q)) * 0.6 * uStrength);
  color += uC * pow(wisps, 3.0) * 0.55 * uStrength;

  vec2 drift = uPointer * vec2(-0.012, 0.01);
  float s = stars(p + drift * 0.3, 38.0, 0.9, 0.0)
          + stars(p + drift * 0.7, 22.0, 0.93, 11.0)
          + stars(p + drift * 1.2, 12.0, 0.96, 23.0) * 1.3;
  vec3 starColor = mix(vec3(1.0), mix(uA, uC, 0.5), 0.25);
  // On the pale theme a white star vanishes; there they are ink.
  vec3 lightInk = mix(uC, uB, 0.5) * 0.55;
  color = mix(color, mix(lightInk, starColor, uDark), clamp(s, 0.0, 1.0) * mix(0.55, 1.0, uDark));

  color += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * Mesh: four control points carrying the hues, wandering slowly, blended by
 * inverse distance -- the soft mesh gradient of a poster, alive.
 */
const MESH = HEADER + /* glsl */ `
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float t = uTime * 0.09;
  p += 0.05 * vec2(fbm(p * 2.0 + t), fbm(p * 2.0 - t));

  vec2 pts[4];
  pts[0] = vec2(0.2 * uAspect + 0.15 * sin(t * 1.1), 0.25 + 0.12 * cos(t * 0.9));
  pts[1] = vec2(0.8 * uAspect + 0.12 * cos(t * 0.8), 0.3 + 0.15 * sin(t * 1.3));
  pts[2] = vec2(0.65 * uAspect + 0.18 * sin(t * 0.7 + 2.0), 0.82 + 0.1 * cos(t));
  pts[3] = vec2(0.25 * uAspect + 0.14 * cos(t * 1.2 + 1.0), 0.78 + 0.12 * sin(t * 0.6));
  vec3 cols[4];
  cols[0] = uA;
  cols[1] = uB;
  cols[2] = uC;
  // A pocket of the base colour: the depth a poster gradient gets from one
  // dark corner.
  cols[3] = mix(uBase, uB, 0.3);

  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    float d = distance(p, pts[i]);
    float w = 1.0 / pow(d + 0.08, 2.6);
    sum += cols[i] * w;
    total += w;
  }
  vec3 mesh = sum / total;
  vec3 color = mix(uBase, mesh, clamp(uStrength * 1.25, 0.0, 1.0));

  // Light pooling through the gradient, like sun through frosted glass.
  float pool = pow(fbm(p * 2.2 + vec2(t * 0.6, -t * 0.4)), 3.0);
  color += mix(uA, uC, vUv.x) * pool * 0.55 * uStrength;

  float d = distance(vUv, uPointer * vec2(0.5, -0.5) + 0.5);
  color += uC * uStrength * 0.1 * smoothstep(0.45, 0.0, d);
  color += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}
`;

export const SCENE_SHADERS: Record<SceneTheme, { fragment: string; icons: boolean }> = {
  aurora: { fragment: AURORA, icons: true },
  silk: { fragment: SILK, icons: false },
  cosmos: { fragment: COSMOS, icons: false },
  mesh: { fragment: MESH, icons: true },
};
