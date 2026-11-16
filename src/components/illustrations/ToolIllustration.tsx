import { useId } from "react";

import "./illustrations.css";

export type IllustrationKind =
  | "download"
  | "compress"
  | "trim"
  | "convert"
  | "extractAudio";

// Colors go through `style`, never presentation attributes: `fill="var(--x)"`
// does not resolve, `style={{ fill: "var(--x)" }}` does. The tokens carry
// light and dark values, so the art follows the theme without any branching.
const stroke = (c: string, w = 1.5) => ({
  fill: "none",
  stroke: `var(--color-${c})`,
  strokeWidth: w,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});
const fill = (c: string, o = 1) => ({ fill: `var(--color-${c})`, opacity: o });

/** The soft glass tile every scene sits on: a gradient at low opacity, a
 *  lighter 1px rim, and a faint glow blob behind. */
function Glass({ id, from, to }: { id: string; from: string; to: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: `var(--color-${from})`, stopOpacity: 0.28 }} />
          <stop offset="1" style={{ stopColor: `var(--color-${to})`, stopOpacity: 0.08 }} />
        </linearGradient>
        <radialGradient id={`${id}r`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: `var(--color-${from})`, stopOpacity: 0.3 }} />
          <stop offset="1" style={{ stopColor: `var(--color-${from})`, stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <circle cx="80" cy="60" r="56" fill={`url(#${id}r)`} />
      <rect x="14" y="10" width="132" height="100" rx="22" fill={`url(#${id}g)`} />
      <rect
        x="14.5"
        y="10.5"
        width="131"
        height="99"
        rx="21.5"
        style={{ fill: "none", stroke: "var(--color-line)", strokeWidth: 1 }}
      />
    </>
  );
}

function Download({ id }: { id: string }) {
  return (
    <>
      <Glass id={id} from="accent" to="aurora-2" />
      {/* Progress arc: pathLength=100 so the dash maths is unit-free. */}
      <circle cx="80" cy="56" r="34" pathLength={100} style={stroke("line", 2)} />
      <circle
        cx="80"
        cy="56"
        r="34"
        pathLength={100}
        strokeDasharray="30 70"
        className="mtk-ill-a mtk-ill-sweep"
        style={{ ...stroke("accent", 2.5), transform: "rotate(-90deg)" }}
      />
      {/* Cloud */}
      <path
        d="M64 52a9 9 0 0 1 3-17 12 12 0 0 1 23-2 10 10 0 0 1 4 19z"
        style={{ ...fill("surface", 0.9), stroke: "var(--color-accent)", strokeWidth: 1.5, strokeLinejoin: "round" }}
      />
      <g className="mtk-ill-a mtk-ill-bob">
        <path d="M80 38v16M73 48l7 7 7-7" style={stroke("accent", 2.2)} />
      </g>
      {/* Tray */}
      <path d="M62 68v6a3 3 0 0 0 3 3h30a3 3 0 0 0 3-3v-6" style={stroke("accent", 2)} />
    </>
  );
}

function Compress({ id }: { id: string }) {
  return (
    <>
      <Glass id={id} from="aurora-1" to="accent" />
      <g className="mtk-ill-a mtk-ill-squeeze">
        <path
          d="M62 28h26l12 12v42a3 3 0 0 1-3 3H62a3 3 0 0 1-3-3V31a3 3 0 0 1 3-3z"
          style={{ ...fill("surface", 0.85), stroke: "var(--color-accent)", strokeWidth: 1.5, strokeLinejoin: "round" }}
        />
        <path d="M88 28v12h12" style={stroke("accent", 1.5)} />
        <rect x="66" y="50" width="28" height="4" rx="2" style={fill("accent", 0.9)} className="mtk-ill-a mtk-ill-shrink" />
        <rect x="66" y="59" width="22" height="4" rx="2" style={fill("aurora-1", 0.9)} className="mtk-ill-a mtk-ill-shrink" />
        <rect x="66" y="68" width="16" height="4" rx="2" style={fill("aurora-2", 0.9)} className="mtk-ill-a mtk-ill-shrink" />
      </g>
      <g className="mtk-ill-a mtk-ill-push-l">
        <path d="M24 56h20M38 49l7 7-7 7" style={stroke("aurora-1", 2.2)} />
      </g>
      <g className="mtk-ill-a mtk-ill-push-r">
        <path d="M136 56h-20M122 49l-7 7 7 7" style={stroke("aurora-1", 2.2)} />
      </g>
    </>
  );
}

const BARS = [10, 18, 6, 26, 34, 22, 38, 16, 30, 40, 24, 8, 4, 14, 20, 9];

function Trim({ id }: { id: string }) {
  const x0 = 28;
  const step = 6.4;
  return (
    <>
      <Glass id={id} from="aurora-2" to="aurora-3" />
      {/* Selection region */}
      <rect x="58" y="34" width="44" height="64" rx="6" style={fill("accent", 0.18)} />
      <path d="M58 34v64M102 34v64" style={stroke("accent", 1.5)} />
      {BARS.map((h, i) => {
        const x = x0 + i * step;
        const inSel = x + 2 > 58 && x < 102;
        return (
          <rect
            key={i}
            x={x}
            y={66 - h / 2}
            width="3.4"
            height={h}
            rx="1.7"
            style={inSel ? fill("accent") : fill("fg-muted", 0.6)}
          />
        );
      })}
      {/* Scissors gliding along the top */}
      <g className="mtk-ill-a mtk-ill-glide">
        <g transform="translate(80 24)">
          <circle cx="-4" cy="5" r="3" style={stroke("fg-muted", 1.4)} />
          <circle cx="4" cy="5" r="3" style={stroke("fg-muted", 1.4)} />
          <path d="M-3 2.5L3 -7M3 2.5L-3 -7" style={stroke("accent", 1.6)} />
        </g>
      </g>
    </>
  );
}

function Convert({ id }: { id: string }) {
  const tile = (x: number, label: string, c: string) => (
    <g>
      <rect x={x} y="38" width="36" height="44" rx="7" style={{ ...fill("surface", 0.85), stroke: `var(--color-${c})`, strokeWidth: 1.5 }} />
      <path d={`M${x + 6} 50h24`} style={stroke(c, 2)} />
      <text
        x={x + 18}
        y="68"
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        style={{ fill: `var(--color-${c})` }}
      >
        {label}
      </text>
    </g>
  );
  return (
    <>
      <Glass id={id} from="accent" to="media-audio" />
      {tile(22, "MP4", "accent")}
      {tile(102, "MP3", "media-audio")}
      <g className="mtk-ill-a mtk-ill-spin">
        <path d="M68 52a14 14 0 0 1 24 0M88 47l4 5-6 1" style={stroke("aurora-2", 2)} />
        <path d="M92 68a14 14 0 0 1-24 0M72 73l-4-5 6-1" style={stroke("aurora-3", 2)} />
      </g>
    </>
  );
}

function ExtractAudio({ id }: { id: string }) {
  return (
    <>
      <Glass id={id} from="media-audio" to="aurora-1" />
      {/* Film strip */}
      <rect x="26" y="38" width="34" height="48" rx="5" style={{ ...fill("surface", 0.85), stroke: "var(--color-media-audio)", strokeWidth: 1.5 }} />
      <path d="M33 38v48M53 38v48" style={stroke("media-audio", 1)} />
      {[44, 54, 64, 74].map((y) => (
        <g key={y}>
          <rect x="28.5" y={y} width="2.5" height="4" rx="1" style={fill("media-audio", 0.8)} />
          <rect x="55" y={y} width="2.5" height="4" rx="1" style={fill("media-audio", 0.8)} />
        </g>
      ))}
      <path d="M40 53l8 9-8 9z" style={fill("media-audio")} />
      {/* Sound waves: grouped so each expands from its own origin */}
      <g>
        {[1, 2, 3].map((n) => (
          <g key={n} transform="translate(0 0)">
            <g
              className={`mtk-ill-a mtk-ill-wave ${n === 2 ? "mtk-ill-wave-2" : n === 3 ? "mtk-ill-wave-3" : ""}`}
              style={{ transformOrigin: "66px 62px", transformBox: "view-box" as never }}
            >
              <path d="M70 50a16 16 0 0 1 0 24" style={stroke("media-audio", 2)} />
            </g>
          </g>
        ))}
      </g>
      {/* Music note */}
      <g className="mtk-ill-a mtk-ill-note">
        <g transform="translate(108 44)">
          <ellipse cx="0" cy="14" rx="5" ry="3.8" style={fill("aurora-1")} />
          <path d="M4.6 14V-2l9 3" style={stroke("aurora-1", 2)} />
        </g>
      </g>
    </>
  );
}

const SCENES = {
  download: Download,
  compress: Compress,
  trim: Trim,
  convert: Convert,
  extractAudio: ExtractAudio,
} satisfies Record<IllustrationKind, (p: { id: string }) => React.JSX.Element>;

/** Animated, theme-aware SVG for a tool's empty state. Decorative only. */
export function ToolIllustration({ kind }: { kind: IllustrationKind }) {
  // `useId` returns ":r1:"; colons are not valid inside a `url(#...)`.
  const id = "mtk" + useId().replace(/:/g, "");
  const Scene = SCENES[kind];
  return (
    <svg viewBox="0 0 160 120" width={160} height={120} aria-hidden="true" focusable="false">
      <Scene id={id} />
    </svg>
  );
}
