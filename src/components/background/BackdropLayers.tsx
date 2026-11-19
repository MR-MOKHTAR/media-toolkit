import { useId } from "react";

import type { BackdropId } from "./backdrops";
import { FloatingIcons } from "./FloatingIcons";

/**
 * The CSS drawing of a backdrop: what `lite` animates, what `off` holds still,
 * and what a thumbnail in Settings shows. Sized in container units
 * (background.css), so the same layers fill a window or a 120px swatch.
 *
 * `icons` is off for the thumbnails: the glyphs are sized in pixels and would
 * crowd a swatch.
 */
export function BackdropLayers({ id, icons = true }: { id: BackdropId; icons?: boolean }) {
  switch (id) {
    case "aurora":
      return (
        <>
          <div className="mtk-bg-curtain" />
          <div className="mtk-bg-blob" data-blob="a" />
          <div className="mtk-bg-blob" data-blob="b" />
          <div className="mtk-bg-blob" data-blob="c" />
          {icons && <FloatingIcons />}
        </>
      );
    case "silk":
      return <SilkLayers />;
    case "cosmos":
      return <CosmosLayers />;
    case "girih":
      return <GirihLayers />;
    case "mesh":
      return (
        <>
          {(["a", "b", "c", "d", "e"] as const).map((blob) => (
            <div key={blob} className="mtk-mesh-blob" data-blob={blob} />
          ))}
        </>
      );
  }
}

/* ------------------------------------------------------------- silk --- */

/** One band of fabric: a body between two curves and a highlight on its fold. */
const RIBBON_BODY =
  "M0 210 C 180 120, 360 120, 520 200 S 860 300, 1000 190 L 1000 262 C 860 360, 680 268, 520 262 S 180 186, 0 282 Z";
const RIBBON_FOLD = "M0 214 C 180 124, 360 124, 520 204 S 860 304, 1000 194";

const RIBBONS = [
  { from: "--color-aurora-1", to: "--color-aurora-2" },
  { from: "--color-aurora-2", to: "--color-aurora-3" },
  { from: "--color-aurora-3", to: "--color-aurora-1" },
  { from: "--color-aurora-1", to: "--color-aurora-3" },
];

function SilkLayers() {
  const uid = useId().replace(/:/g, "");
  return (
    <>
      <div className="mtk-silk-glow" />
      {RIBBONS.map(({ from, to }, index) => (
        <svg
          key={index}
          className="mtk-silk-ribbon"
          data-ribbon={index}
          viewBox="0 0 1000 400"
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <linearGradient id={`${uid}-r${index}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" style={{ stopColor: `var(${from})`, stopOpacity: 0 }} />
              <stop offset="22%" style={{ stopColor: `var(${from})`, stopOpacity: 0.85 }} />
              <stop offset="70%" style={{ stopColor: `var(${to})`, stopOpacity: 0.8 }} />
              <stop offset="100%" style={{ stopColor: `var(${to})`, stopOpacity: 0 }} />
            </linearGradient>
            <linearGradient id={`${uid}-s${index}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#fff" stopOpacity="0" />
              <stop offset="45%" stopColor="#fff" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={RIBBON_BODY} fill={`url(#${uid}-r${index})`} />
          <path d={RIBBON_FOLD} fill="none" stroke={`url(#${uid}-s${index})`} strokeWidth="2.2" />
        </svg>
      ))}
    </>
  );
}

/* ----------------------------------------------------------- cosmos --- */

function CosmosLayers() {
  return (
    <>
      <div className="mtk-cosmos-nebula" />
      <div className="mtk-cosmos-stars" data-layer="far" />
      <div className="mtk-cosmos-stars" data-layer="mid" />
      <div className="mtk-cosmos-stars" data-layer="near" />
      <div className="mtk-cosmos-comet" />
    </>
  );
}

/* ------------------------------------------------------------ girih --- */

/**
 * Star-and-cross girih: eight-pointed stars on a square lattice, tip to tip,
 * each with a smaller rosette and an octagon inside. Drawn once as a pattern
 * and used as a mask over a gradient of the theme's hues, so the lines are
 * iridescent and follow each screen's tint. The aurora washes and the sweeping
 * curtain behind it are what move.
 */
const GIRIH_STARS = [
  "120,60 91.41,73.01 102.43,102.43 73.01,91.41 60,120 46.99,91.41 17.57,102.43 28.59,73.01 0,60 28.59,46.99 17.57,17.57 46.99,28.59 60,0 73.01,28.59 102.43,17.57 91.41,46.99",
  "60,0 31.41,13.01 42.43,42.43 13.01,31.41 0,60 -13.01,31.41 -42.43,42.43 -31.41,13.01 -60,0 -31.41,-13.01 -42.43,-42.43 -13.01,-31.41 0,-60 13.01,-31.41 42.43,-42.43 31.41,-13.01",
  "180,0 151.41,13.01 162.43,42.43 133.01,31.41 120,60 106.99,31.41 77.57,42.43 88.59,13.01 60,0 88.59,-13.01 77.57,-42.43 106.99,-31.41 120,-60 133.01,-31.41 162.43,-42.43 151.41,-13.01",
  "60,120 31.41,133.01 42.43,162.43 13.01,151.41 0,180 -13.01,151.41 -42.43,162.43 -31.41,133.01 -60,120 -31.41,106.99 -42.43,77.57 -13.01,88.59 0,60 13.01,88.59 42.43,77.57 31.41,106.99",
  "180,120 151.41,133.01 162.43,162.43 133.01,151.41 120,180 106.99,151.41 77.57,162.43 88.59,133.01 60,120 88.59,106.99 77.57,77.57 106.99,88.59 120,60 133.01,88.59 162.43,77.57 151.41,106.99",
];
const GIRIH_ROSETTE =
  "87.72,71.48 72.02,72.02 71.48,87.72 60,77 48.52,87.72 47.98,72.02 32.28,71.48 43,60 32.28,48.52 47.98,47.98 48.52,32.28 60,43 71.48,32.28 72.02,47.98 87.72,48.52 77,60";
const GIRIH_OCTAGON =
  "78.48,67.65 67.65,78.48 52.35,78.48 41.52,67.65 41.52,52.35 52.35,41.52 67.65,41.52 78.48,52.35";

function GirihLayers() {
  const uid = useId().replace(/:/g, "");
  return (
    <>
      <div className="mtk-bg-blob" data-blob="a" />
      <div className="mtk-bg-blob" data-blob="c" />
      <svg className="mtk-girih" aria-hidden>
        <defs>
          <pattern
            id={`${uid}-tile`}
            width="120"
            height="120"
            patternUnits="userSpaceOnUse"
            patternTransform="scale(0.95)"
          >
            <g fill="none" stroke="#fff" strokeLinejoin="round">
              {GIRIH_STARS.map((points) => (
                <polygon key={points} points={points} strokeWidth="1.7" />
              ))}
              <polygon points={GIRIH_ROSETTE} strokeWidth="1.3" />
              <polygon points={GIRIH_OCTAGON} strokeWidth="1" strokeOpacity="0.75" />
              <circle cx="60" cy="60" r="4" fill="#fff" fillOpacity="0.5" stroke="none" />
            </g>
          </pattern>
          <mask id={`${uid}-mask`}>
            <rect width="100%" height="100%" fill={`url(#${uid}-tile)`} />
          </mask>
          <linearGradient id={`${uid}-ink`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--color-aurora-1)" }} />
            <stop offset="50%" style={{ stopColor: "var(--color-aurora-2)" }} />
            <stop offset="100%" style={{ stopColor: "var(--color-aurora-3)" }} />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${uid}-ink)`} mask={`url(#${uid}-mask)`} />
      </svg>
      <div className="mtk-bg-curtain" />
    </>
  );
}
