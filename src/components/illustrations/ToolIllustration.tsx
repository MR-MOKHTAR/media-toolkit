import { useId, type CSSProperties, type ReactNode } from "react";
import { CloudDownload, FilePlay } from "lucide-react";

import "./illustrations.css";

export type IllustrationKind =
  | "download"
  | "compress"
  | "trim"
  | "convert"
  | "extractAudio";

/*
 * Every scene is composed around the centre of the 160x120 view box -- (80, 60)
 * -- and is symmetric about it, or balanced across it, so the art sits in the
 * middle of its tile and the tile in the middle of the empty state. The first
 * version placed shapes by eye and drifted a few units up and right, which at
 * this size is visible.
 *
 * Colours go through `style`, never presentation attributes: `fill="var(--x)"`
 * does not resolve, `style={{ fill: "var(--x)" }}` does. The tokens carry light
 * and dark values, so the art follows the theme without any branching.
 */

const CX = 80;
const CY = 60;

const stroke = (c: string, w = 1.5): CSSProperties => ({
  fill: "none",
  stroke: `var(--color-${c})`,
  strokeWidth: w,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});
const fill = (c: string, o = 1): CSSProperties => ({ fill: `var(--color-${c})`, opacity: o });

/** A lucide glyph placed with its centre on (x, y). Lucide's icons are drawn
 *  balanced inside their own 24-unit box, which is what makes them the reliable
 *  way to put a mark dead centre. */
function Glyph({
  icon: Icon,
  x = CX,
  y = CY,
  size,
  color,
  width = 1.5,
}: {
  icon: typeof CloudDownload;
  x?: number;
  y?: number;
  size: number;
  color: string;
  width?: number;
}) {
  return (
    <Icon
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
      // `currentColor` is lucide's stroke; the colour comes in through CSS so
      // the token resolves.
      style={{ color: `var(--color-${color})` }}
      strokeWidth={width}
    />
  );
}

/** The soft glass tile every scene sits on: a glow behind, a tinted pane, and a
 *  lit rim. Stronger in light mode than a straight alpha would be, because a
 *  pale pane on a pale aurora otherwise disappears. */
function Glass({ id, from, to }: { id: string; from: string; to: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: `var(--color-${from})`, stopOpacity: "var(--ill-pane-a)" }} />
          <stop offset="1" style={{ stopColor: `var(--color-${to})`, stopOpacity: "var(--ill-pane-b)" }} />
        </linearGradient>
        <radialGradient id={`${id}r`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: `var(--color-${from})`, stopOpacity: 0.35 }} />
          <stop offset="1" style={{ stopColor: `var(--color-${from})`, stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={`${id}e`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--color-glass-edge)" }} />
          <stop offset="1" style={{ stopColor: "var(--color-glass-line)" }} />
        </linearGradient>
      </defs>
      <circle cx={CX} cy={CY} r="58" fill={`url(#${id}r)`} />
      <rect x="14" y="10" width="132" height="100" rx="24" className="mtk-ill-pane" />
      <rect x="14" y="10" width="132" height="100" rx="24" fill={`url(#${id}g)`} />
      <rect
        x="14.5"
        y="10.5"
        width="131"
        height="99"
        rx="23.5"
        fill="none"
        stroke={`url(#${id}e)`}
        strokeWidth="1"
      />
    </>
  );
}

function Download({ id }: { id: string }) {
  return (
    <>
      <Glass id={id} from="accent" to="aurora-2" />
      {/* Progress ring around the centre. pathLength=100 keeps the dash maths
          unit-free; the -90deg turn starts it at twelve o'clock. */}
      <circle cx={CX} cy={CY} r="36" pathLength={100} style={stroke("line", 2.5)} />
      <circle
        cx={CX}
        cy={CY}
        r="36"
        pathLength={100}
        strokeDasharray="28 72"
        className="mtk-ill-a mtk-ill-sweep"
        style={{ ...stroke("accent", 3), transform: "rotate(-90deg)" }}
      />
      <g className="mtk-ill-a mtk-ill-bob">
        <Glyph icon={CloudDownload} size={42} color="accent" width={1.6} />
      </g>
    </>
  );
}

function Compress({ id }: { id: string }) {
  return (
    <>
      <Glass id={id} from="aurora-1" to="accent" />
      <g className="mtk-ill-a mtk-ill-squeeze">
        <Glyph icon={FilePlay} size={46} color="accent" width={1.5} />
      </g>
      {/* Two arrows pressing in, mirror images about the centre line. */}
      <g className="mtk-ill-a mtk-ill-push-l">
        <path d={`M${CX - 52} ${CY}h16M${CX - 42} ${CY - 6}l6 6-6 6`} style={stroke("aurora-1", 2.4)} />
      </g>
      <g className="mtk-ill-a mtk-ill-push-r">
        <path d={`M${CX + 52} ${CY}h-16M${CX + 42} ${CY - 6}l-6 6 6 6`} style={stroke("aurora-1", 2.4)} />
      </g>
    </>
  );
}

/** Bar heights, symmetric in count about the middle bar; the short ones are
 *  the silences a trim would cut at. */
const BARS = [10, 18, 6, 26, 34, 22, 38, 16, 30, 40, 24, 8, 4, 14, 20];

function Trim({ id }: { id: string }) {
  const step = 6.2;
  const barWidth = 3.4;
  const span = (BARS.length - 1) * step + barWidth;
  const x0 = CX - span / 2;
  const barsY = CY + 8;
  const selection = { from: CX - 22, to: CX + 22 };

  return (
    <>
      <Glass id={id} from="aurora-2" to="aurora-3" />
      <rect
        x={selection.from}
        y={barsY - 26}
        width={selection.to - selection.from}
        height="52"
        rx="6"
        style={fill("accent", 0.16)}
      />
      <path
        d={`M${selection.from} ${barsY - 26}v52M${selection.to} ${barsY - 26}v52`}
        style={stroke("accent", 1.6)}
      />
      {BARS.map((h, i) => {
        const x = x0 + i * step;
        const inside = x + barWidth > selection.from && x < selection.to;
        return (
          <rect
            key={i}
            x={x}
            y={barsY - h / 2}
            width={barWidth}
            height={h}
            rx={barWidth / 2}
            style={inside ? fill("accent") : fill("fg-muted", 0.55)}
          />
        );
      })}
      {/* Scissors gliding along the top edge of the selection. */}
      <g className="mtk-ill-a mtk-ill-glide">
        <g transform={`translate(${CX} ${barsY - 36})`}>
          <circle cx="-4" cy="5" r="3" style={stroke("fg-muted", 1.4)} />
          <circle cx="4" cy="5" r="3" style={stroke("fg-muted", 1.4)} />
          <path d="M-3 2.5L3 -7M3 2.5L-3 -7" style={stroke("accent", 1.6)} />
        </g>
      </g>
    </>
  );
}

function Convert({ id }: { id: string }) {
  const tile = (cx: number, label: string, c: string): ReactNode => (
    <g>
      <rect
        x={cx - 18}
        y={CY - 22}
        width="36"
        height="44"
        rx="7"
        style={{ ...fill("surface", 0.9), stroke: `var(--color-${c})`, strokeWidth: 1.5 }}
      />
      <path d={`M${cx - 12} ${CY - 10}h24`} style={stroke(c, 2)} />
      <text
        x={cx}
        y={CY + 9}
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
      {tile(CX - 40, "MP4", "accent")}
      {tile(CX + 40, "MP3", "media-audio")}
      <g className="mtk-ill-a mtk-ill-spin">
        <path d={`M${CX - 12} ${CY - 8}a14 14 0 0 1 24 0M${CX + 8} ${CY - 13}l4 5-6 1`} style={stroke("aurora-2", 2)} />
        <path d={`M${CX + 12} ${CY + 8}a14 14 0 0 1-24 0M${CX - 8} ${CY + 13}l-4-5 6-1`} style={stroke("aurora-3", 2)} />
      </g>
    </>
  );
}

function ExtractAudio({ id }: { id: string }) {
  // Film strip on one side, the note on the other, the waves between: the
  // three together span 34..126, centred on 80.
  const strip = { x: 34, w: 34 };
  return (
    <>
      <Glass id={id} from="media-audio" to="aurora-1" />
      <rect
        x={strip.x}
        y={CY - 24}
        width={strip.w}
        height="48"
        rx="5"
        style={{ ...fill("surface", 0.9), stroke: "var(--color-media-audio)", strokeWidth: 1.5 }}
      />
      <path
        d={`M${strip.x + 7} ${CY - 24}v48M${strip.x + 27} ${CY - 24}v48`}
        style={stroke("media-audio", 1)}
      />
      {[-18, -8, 2, 12].map((dy) => (
        <g key={dy}>
          <rect x={strip.x + 2.5} y={CY + dy} width="2.5" height="4" rx="1" style={fill("media-audio", 0.8)} />
          <rect x={strip.x + 29} y={CY + dy} width="2.5" height="4" rx="1" style={fill("media-audio", 0.8)} />
        </g>
      ))}
      <path d={`M${strip.x + 13} ${CY - 9}l9 9-9 9z`} style={fill("media-audio")} />
      {[1, 2, 3].map((n) => (
        <g
          key={n}
          className={`mtk-ill-a mtk-ill-wave ${n === 2 ? "mtk-ill-wave-2" : n === 3 ? "mtk-ill-wave-3" : ""}`}
          style={{ transformOrigin: `${strip.x + strip.w + 4}px ${CY}px`, transformBox: "view-box" }}
        >
          <path d={`M${strip.x + strip.w + 8} ${CY - 12}a16 16 0 0 1 0 24`} style={stroke("media-audio", 2)} />
        </g>
      ))}
      <g className="mtk-ill-a mtk-ill-note">
        <g transform={`translate(${CX + 30} ${CY - 14})`}>
          <ellipse cx="0" cy="14" rx="5.5" ry="4" style={fill("aurora-1")} />
          <path d="M5 14V-4l10 3.5" style={stroke("aurora-1", 2.2)} />
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
export function ToolIllustration({ kind, size = 224 }: { kind: IllustrationKind; size?: number }) {
  // `useId` returns ":r1:"; colons are not valid inside a `url(#...)`.
  const id = "mtk" + useId().replace(/:/g, "");
  const Scene = SCENES[kind];
  return (
    <svg
      viewBox="0 0 160 120"
      width={size}
      height={(size * 3) / 4}
      className="mtk-ill"
      aria-hidden="true"
      focusable="false"
    >
      <Scene id={id} />
    </svg>
  );
}
