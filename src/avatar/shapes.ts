// Body silhouettes. Each shape is a closed outline in raw coordinates, normalized
// (aspect preserved) to fit a -1..1 box so width/height sliders behave the same for all.

export const SHAPES = [
  { id: "sphere", label: "Sphere", group: "3D" },
  { id: "egg", label: "Egg", group: "3D" },
  { id: "cube", label: "Cube", group: "3D" },
  { id: "capsule", label: "Capsule", group: "3D" },
  { id: "cylinder", label: "Cylinder", group: "3D" },
  { id: "cone", label: "Cone", group: "3D" },
  { id: "squircle", label: "Squircle", group: "Soft" },
  { id: "blob", label: "Blob", group: "Soft" },
  { id: "cloud", label: "Cloud", group: "Soft" },
  { id: "teardrop", label: "Drop", group: "Soft" },
  { id: "heart", label: "Heart", group: "Fun" },
  { id: "star", label: "Star", group: "Fun" },
  { id: "ghost", label: "Ghost", group: "Fun" },
  { id: "cat", label: "Cat", group: "Fun" },
  { id: "hexagon", label: "Hexagon", group: "Fun" },
  { id: "diamond", label: "Gem", group: "Fun" },
] as const;

export type Shape = (typeof SHAPES)[number]["id"];

/** Shapes whose corners follow the roundness slider. */
export const ROUNDED = new Set<Shape>(["squircle", "cube", "star", "hexagon", "diamond", "cat"]);

export type Pt = [number, number];
/** A lighter top face drawn over the body (cylinder lid), in the same space as the outline. */
export interface Cap {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

const N = 160;
const TAU = Math.PI * 2;
const range = (n: number, f: (t: number) => Pt) => Array.from({ length: n }, (_, i) => f(i / n));

const polar = (r: (a: number) => number) =>
  range(N, (u) => {
    const a = u * TAU;
    const k = r(a);
    return [Math.cos(a) * k, Math.sin(a) * k];
  });

/** Regular polygon with `n` corners (first corner at the top), softened toward its incircle. */
const polygon = (n: number, round: number) =>
  polar((a) => {
    const seg = TAU / n;
    const local = ((((a + Math.PI / 2) % seg) + seg) % seg) - seg / 2;
    const poly = Math.cos(Math.PI / n) / Math.cos(local);
    return poly + (Math.cos(Math.PI / n) - poly) * round * 0.75;
  });

/** Rounded rectangle traced clockwise from the top-left corner. */
function roundedRect(w: number, h: number, r: number): Pt[] {
  r = Math.min(r, w, h);
  const pts: Pt[] = [];
  const corner = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= 10; i++) {
      const a = from + (i / 10) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(w - r, -h + r, -Math.PI / 2);
  corner(w - r, h - r, 0);
  corner(-w + r, h - r, Math.PI / 2);
  corner(-w + r, -h + r, Math.PI);
  return pts;
}

/** Half an ellipse from angle a0 to a1. */
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 24): Pt[] =>
  range(n + 1, (u) => {
    const a = a0 + (a1 - a0) * u * (n + 1) / n;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });

function raw(shape: Shape, round: number): { pts: Pt[]; cap?: Cap } {
  switch (shape) {
    case "egg":
      return { pts: polar((a) => 1 + 0.13 * Math.sin(a)) }; // y points down: narrower top
    case "squircle": {
      const n = 2.2 + (1 - round) * 7;
      return { pts: polar((a) => 1 / (Math.abs(Math.cos(a)) ** n + Math.abs(Math.sin(a)) ** n) ** (1 / n)) };
    }
    case "blob":
      return { pts: polar((a) => 1 + 0.055 * Math.sin(3 * a + 0.8) + 0.04 * Math.cos(5 * a - 0.4)) };
    case "cube":
      return { pts: roundedRect(1, 1, 0.06 + round * 0.55) };
    case "capsule":
      return { pts: roundedRect(0.66, 1, 0.66) };
    case "cylinder": {
      const ry = 0.22;
      return {
        pts: [...arc(0, -0.78, 0.8, ry, Math.PI, TAU), ...arc(0, 0.78, 0.8, ry, 0, Math.PI)],
        cap: { cx: 0, cy: -0.78, rx: 0.8, ry },
      };
    }
    case "cone": {
      // Rounded tip, straight flanks, elliptical base.
      const tip = arc(0, -0.86, 0.1, 0.1, Math.PI * 1.12, Math.PI * 1.88, 10);
      return { pts: [...tip, ...arc(0, 0.8, 0.86, 0.24, 0, Math.PI)] };
    }
    case "cloud":
      return { pts: polar((a) => 0.86 + 0.14 * Math.abs(Math.cos(3.5 * (a + Math.PI / 2))) ** 0.6) };
    case "teardrop":
      return { pts: range(N, (u) => [Math.sin(u * TAU) * Math.sin((u * TAU) / 2) ** 1.2, -Math.cos(u * TAU)]) };
    case "heart":
      return {
        pts: range(N, (u) => {
          const t = u * TAU;
          return [Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16];
        }),
      };
    case "star": {
      const sharp = 1 + (1 - round) * 2.5;
      return { pts: polar((a) => 0.62 + 0.38 * ((Math.cos(5 * (a + Math.PI / 2)) + 1) / 2) ** sharp) };
    }
    case "ghost": {
      const wave = range(41, (u) => {
        const x = 1 - 2 * u;
        return [x, 0.86 + 0.12 * Math.cos(x * Math.PI * 3)] as Pt;
      });
      return { pts: [...arc(0, -0.1, 1, 1, Math.PI, TAU), ...wave] };
    }
    case "cat": {
      const pointy = 1.2 + (1 - round) * 1.3;
      const ear = (a: number, at: number) => Math.max(0, 1 - Math.abs(Math.atan2(Math.sin(a - at), Math.cos(a - at))) / 0.3) ** pointy;
      return { pts: polar((a) => 1 + 0.42 * (ear(a, -Math.PI / 2 - 0.55) + ear(a, -Math.PI / 2 + 0.55))) };
    }
    case "hexagon":
      return { pts: polygon(6, round) };
    case "diamond":
      return { pts: polygon(4, round).map(([x, y]) => [x * 0.82, y] as Pt) };
    default:
      return { pts: polar(() => 1) };
  }
}

/** Outline points fitted to -1..1 (aspect kept), plus an optional cap in the same space. */
/** Points every outline is resampled to, so any two shapes can morph point by point. */
export const SAMPLES = 180;

/** `n` points evenly spaced along a closed polyline. */
function even(loop: Pt[], n: number): Pt[] {
  const seg = loop.map((p, i) => Math.hypot(loop[(i + 1) % loop.length][0] - p[0], loop[(i + 1) % loop.length][1] - p[1]));
  const total = seg.reduce((a, b) => a + b, 0);
  const out: Pt[] = [];
  let i = 0;
  let walked = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (walked + seg[i] < target) walked += seg[i++];
    const [x0, y0] = loop[i];
    const [x1, y1] = loop[(i + 1) % loop.length];
    const t = seg[i] ? (target - walked) / seg[i] : 0;
    out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
  }
  return out;
}

/** SAMPLES evenly spaced points, clockwise on screen, starting at the point straight above the center. */
function resample(pts: Pt[]): Pt[] {
  let area = 0;
  pts.forEach(([x, y], i) => {
    const [nx, ny] = pts[(i + 1) % pts.length];
    area += x * ny - nx * y;
  });
  const ring = area < 0 ? [...pts].reverse() : pts; // y points down, so positive area is clockwise
  // Densify first so flat edges (cube top) have a point near x = 0 to start from.
  const dense = even(ring, SAMPLES * 8);
  const up = (p: Pt) => Math.abs(Math.atan2(p[0], -p[1])); // angle away from straight up
  const start = dense.reduce((best, p, i) => (up(p) < up(dense[best]) ? i : best), 0);
  return Array.from({ length: SAMPLES }, (_, k) => dense[(start + k * 8) % dense.length]);
}

const cache = new Map<string, { pts: Pt[]; cap?: Cap }>();

/** Outline points fitted to -1..1 (aspect kept), plus an optional cap in the same space. Cached, so equal inputs return the same arrays. */
export function outline(shape: Shape, roundness: number): { pts: Pt[]; cap?: Cap } {
  const key = `${shape}:${roundness}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { pts, cap } = raw(shape, roundness);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const s = 2 / Math.max(x1 - x0, y1 - y0);
  const fit = ([x, y]: Pt): Pt => [(x - cx) * s, (y - cy) * s];
  const result = {
    pts: resample(pts.map(fit)),
    cap: cap && { cx: (cap.cx - cx) * s, cy: (cap.cy - cy) * s, rx: cap.rx * s, ry: cap.ry * s },
  };
  if (cache.size > 500) cache.clear(); // ponytail: crude bound for roundness-slider drags; LRU if it ever matters
  cache.set(key, result);
  return result;
}

/** SVG path for an outline scaled to rx/ry. */
export function shapePath(pts: Pt[], rx: number, ry: number): string {
  return `M${pts.map(([x, y]) => `${(x * rx).toFixed(2)},${(y * ry).toFixed(2)}`).join("L")}Z`;
}
