import type { CSSProperties } from "react";
import {
  AudioLines,
  AudioWaveform,
  Clapperboard,
  CloudDownload,
  Disc3,
  Download,
  Film,
  Headphones,
  Mic,
  Music2,
  Play,
  Radio,
  Scissors,
  Video,
  type LucideIcon,
} from "lucide-react";

/**
 * Where each glyph floats. Hand-placed rather than random: a random scatter
 * clumps, and a clump of icons behind the middle of a card reads as noise in
 * the one place the eye is trying to read. These keep to the margins and the
 * gaps between the window's furniture, a few of them large and soft for depth.
 *
 * `depth` is 0 (far) to 1 (near): near icons are larger, brighter, sharper and
 * move further with the pointer.
 */
const SPOTS: Array<{
  icon: LucideIcon;
  x: number;
  y: number;
  size: number;
  depth: number;
  orb?: boolean;
}> = [
  { icon: Play, x: 8, y: 12, size: 54, depth: 0.95, orb: true },
  { icon: Music2, x: 86, y: 9, size: 40, depth: 0.7 },
  { icon: Film, x: 64, y: 22, size: 30, depth: 0.35 },
  { icon: Download, x: 92, y: 46, size: 58, depth: 0.9, orb: true },
  { icon: AudioWaveform, x: 18, y: 52, size: 36, depth: 0.55 },
  { icon: Headphones, x: 74, y: 78, size: 46, depth: 0.8 },
  { icon: Scissors, x: 40, y: 86, size: 32, depth: 0.45 },
  { icon: Clapperboard, x: 4, y: 82, size: 44, depth: 0.75, orb: true },
  { icon: Mic, x: 52, y: 6, size: 26, depth: 0.3 },
  { icon: Disc3, x: 30, y: 28, size: 24, depth: 0.2 },
  { icon: Video, x: 58, y: 58, size: 28, depth: 0.25 },
  { icon: Radio, x: 96, y: 88, size: 30, depth: 0.4 },
  { icon: AudioLines, x: 24, y: 70, size: 26, depth: 0.3 },
  { icon: CloudDownload, x: 44, y: 40, size: 22, depth: 0.15 },
];

/** A pseudo-random but fixed number per spot, so each icon keeps its own
 *  rhythm across renders and launches. */
const seeded = (index: number, salt: number) => {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * Media glyphs drifting behind the interface: the CSS half of the background,
 * shown in `lite` mode and wherever WebGL is unavailable.
 *
 * Transforms only, so every frame is a compositor job; the gradient stroke and
 * the soft glow are painted once per icon, not per frame.
 */
export function FloatingIcons() {
  return (
    <div className="mtk-bg-icons">
      {/* The stroke gradient every glyph shares. userSpaceOnUse in the glyphs'
          own 24-unit box: objectBoundingBox would give a straight vertical
          stroke (the shaft of the download arrow) a zero-width box and draw it
          not at all. */}
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <linearGradient id="mtk-icon-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="24" y2="24">
            {/* As style, not the stopColor attribute: a presentation attribute
                does not resolve var(). */}
            <stop offset="0%" style={{ stopColor: "var(--color-aurora-icon)" }} />
            <stop offset="55%" style={{ stopColor: "var(--color-aurora-2)" }} />
            <stop offset="100%" style={{ stopColor: "var(--color-aurora-3)" }} />
          </linearGradient>
        </defs>
      </svg>

      {SPOTS.map(({ icon: Icon, x, y, size, depth, orb }, index) => {
        const style = {
          "--x": `${x}%`,
          "--y": `${y}%`,
          "--s": `${size}px`,
          "--depth": depth,
          "--dur": `${22 + seeded(index, 1) * 18}s`,
          "--delay": `${-seeded(index, 2) * 30}s`,
          "--rot": `${(seeded(index, 3) - 0.5) * 28}deg`,
          "--drift": `${10 + depth * 22}px`,
        } as CSSProperties;

        return (
          <span
            key={index}
            className="mtk-bg-icon"
            data-orb={orb ? "" : undefined}
            data-far={depth < 0.25 ? "" : undefined}
            style={style}
          >
            <Icon
              size={orb ? size * 0.5 : size}
              strokeWidth={orb ? 1.6 : 1.25}
              color="url(#mtk-icon-gradient)"
            />
          </span>
        );
      })}
    </div>
  );
}
