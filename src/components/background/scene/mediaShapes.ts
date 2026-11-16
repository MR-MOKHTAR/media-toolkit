import { Path, Shape } from "three";

/**
 * The glyphs that float in the background, as flat outlines ready to be
 * extruded into 3D.
 *
 * Drawn with three's Shape API rather than loaded from SVG: lucide's icons are
 * strokes, which have no inside to extrude, and a filled outline built from
 * circles and rounded boxes stays clean at any bevel. Overlapping parts are
 * fine -- they share one material and one plane, so where two meet there is
 * nothing to see.
 *
 * Every glyph is drawn in a box roughly 2 units across, centred on the origin;
 * the scene centres the extruded geometry again anyway.
 */

const TAU = Math.PI * 2;

function circle(x: number, y: number, r: number): Shape {
  const shape = new Shape();
  shape.absarc(x, y, r, 0, TAU, false);
  return shape;
}

function hole(x: number, y: number, r: number): Path {
  const path = new Path();
  path.absarc(x, y, r, 0, TAU, true);
  return path;
}

/** A ring: a disc with a disc-shaped hole. */
function ring(x: number, y: number, outer: number, inner: number): Shape {
  const shape = circle(x, y, outer);
  shape.holes.push(hole(x, y, inner));
  return shape;
}

function roundedBox(x: number, y: number, w: number, h: number, r: number): Shape {
  const shape = new Shape();
  const radius = Math.min(r, w / 2, h / 2);
  shape.moveTo(x + radius, y);
  shape.lineTo(x + w - radius, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + radius);
  shape.lineTo(x + w, y + h - radius);
  shape.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  shape.lineTo(x + radius, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

/** A closed polygon from a list of points. */
function polygon(points: Array<[number, number]>): Shape {
  const shape = new Shape();
  points.forEach(([x, y], index) => (index ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  return shape;
}

/** A band of an annulus between two angles -- the headphones' headband. */
function arcBand(radius: number, thickness: number, from: number, to: number): Shape {
  const shape = new Shape();
  shape.absarc(0, 0, radius, from, to, false);
  shape.absarc(0, 0, radius - thickness, to, from, true);
  shape.closePath();
  return shape;
}

/** Play: a triangle with softened corners. */
function play(): Shape[] {
  const shape = new Shape();
  const r = 0.18;
  shape.moveTo(-0.62, -0.78 + r);
  shape.lineTo(-0.62, 0.78 - r);
  shape.quadraticCurveTo(-0.62, 0.92, -0.48, 0.86);
  shape.lineTo(0.82, 0.12);
  shape.quadraticCurveTo(0.95, 0, 0.82, -0.12);
  shape.lineTo(-0.48, -0.86);
  shape.quadraticCurveTo(-0.62, -0.92, -0.62, -0.78 + r);
  return [shape];
}

/** Two beamed notes. */
function notes(): Shape[] {
  return [
    circle(-0.55, -0.62, 0.32),
    circle(0.6, -0.42, 0.32),
    roundedBox(-0.33, -0.62, 0.13, 1.42, 0.04),
    roundedBox(0.82, -0.42, 0.13, 1.32, 0.04),
    polygon([
      [-0.33, 0.62],
      [0.95, 0.88],
      [0.95, 1.14],
      [-0.33, 0.88],
    ]),
  ];
}

/** A film reel: a disc with five sprocket holes and an axle. */
function reel(): Shape[] {
  const disc = circle(0, 0, 0.95);
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * TAU + Math.PI / 2;
    disc.holes.push(hole(Math.cos(angle) * 0.52, Math.sin(angle) * 0.52, 0.2));
  }
  disc.holes.push(hole(0, 0, 0.1));
  return [disc];
}

/** A download arrow dropping into a tray. */
function download(): Shape[] {
  return [
    polygon([
      [-0.14, 0.95],
      [0.14, 0.95],
      [0.14, 0.05],
      [0.46, 0.05],
      [0, -0.45],
      [-0.46, 0.05],
      [-0.14, 0.05],
    ]),
    polygon([
      [-0.95, -0.35],
      [-0.75, -0.35],
      [-0.75, -0.75],
      [0.75, -0.75],
      [0.75, -0.35],
      [0.95, -0.35],
      [0.95, -0.95],
      [-0.95, -0.95],
    ]),
  ];
}

/** A sound wave: seven rounded bars. */
function waveform(): Shape[] {
  const heights = [0.5, 1.1, 1.7, 1.25, 1.85, 0.95, 0.45];
  return heights.map((height, index) =>
    roundedBox(-0.98 + index * 0.29, -height / 2, 0.17, height, 0.085),
  );
}

/** Headphones: a headband and two cups. */
function headphones(): Shape[] {
  return [
    arcBand(0.88, 0.16, Math.PI * 0.02, Math.PI * 0.98),
    roundedBox(-0.98, -0.85, 0.42, 0.9, 0.16),
    roundedBox(0.56, -0.85, 0.42, 0.9, 0.16),
  ];
}

/** Scissors: two finger rings and two crossed blades. */
function scissors(): Shape[] {
  const blade = (sign: number) => {
    const shape = new Shape();
    shape.moveTo(sign * -0.3, -0.25);
    shape.lineTo(sign * 0.95, 0.95);
    shape.lineTo(sign * 0.72, 0.98);
    shape.lineTo(sign * -0.5, -0.12);
    shape.closePath();
    return shape;
  };
  return [ring(-0.5, -0.55, 0.36, 0.2), ring(0.5, -0.55, 0.36, 0.2), blade(1), blade(-1)];
}

/** A clapperboard: the slate and its striped arm, raised. */
function clapper(): Shape[] {
  return [
    roundedBox(-0.95, -0.85, 1.9, 1.2, 0.12),
    polygon([
      [-0.95, 0.48],
      [0.85, 0.82],
      [0.92, 1.05],
      [-0.9, 0.72],
    ]),
  ];
}

/** A disc: a ring with a label ring inside. */
function disc(): Shape[] {
  return [ring(0, 0, 0.95, 0.42), ring(0, 0, 0.3, 0.11)];
}

export const MEDIA_SHAPES: Array<() => Shape[]> = [
  play,
  notes,
  reel,
  download,
  waveform,
  headphones,
  scissors,
  clapper,
  disc,
];
