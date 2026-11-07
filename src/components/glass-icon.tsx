import type { CSSProperties, ReactNode } from "react";

/*
 * Glass duotone icons: a solid blue shape behind, a frosted light-blue pane in front that really blurs
 * it (backdrop-filter), and white details on top. Everything is drawn on a 64×64 grid.
 */

const BLUE = "#0a3dff";
const W = "#ffffff";

type Pane = { x: number; y: number; w: number; h: number; r?: number | string; rotate?: number; clip?: string };
type Def = { back: ReactNode; glass: Pane[]; glyph?: ReactNode };

const line = (d: string, w = 3.2) => <path d={d} fill="none" stroke={W} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;

const ICONS: Record<string, Def> = {
  // Text under 12px: "Aa" on glass, a tilted blue card behind.
  text: {
    back: <rect x="27" y="5" width="30" height="30" rx="8" fill={BLUE} transform="rotate(12 42 20)" />,
    glass: [{ x: 6, y: 18, w: 40, h: 38, r: 10 }],
    glyph: <text x="26" y="44" textAnchor="middle" fontSize="17" fontWeight="700" fill={W} fontFamily="system-ui, sans-serif">Aa</text>,
  },
  // Text off the screen: a phone of glass, a blue card sticking out of it.
  offscreen: {
    back: <rect x="32" y="20" width="28" height="24" rx="6" fill={BLUE} />,
    glass: [{ x: 12, y: 6, w: 30, h: 52, r: 8 }],
    glyph: <>{line("M23 12h8", 3)}<circle cx="27" cy="50" r="2" fill={W} /></>,
  },
  // Crowded rows: tight lines on glass, a blue dot behind.
  rows: {
    back: <circle cx="44" cy="21" r="14" fill={BLUE} />,
    glass: [{ x: 6, y: 16, w: 44, h: 40, r: 10 }],
    glyph: <>{line("M15 29h26")}{line("M15 36h26")}{line("M15 43h18")}</>,
  },
  // Text past its box: lines spilling out of a glass box over a blue one.
  box: {
    back: <rect x="6" y="8" width="34" height="26" rx="6" fill={BLUE} />,
    glass: [{ x: 16, y: 22, w: 42, h: 34, r: 9 }],
    glyph: <>{line("M24 33h26")}{line("M24 40h20")}{line("M24 47h12")}</>,
  },
  // Section heights: a tall blue bar behind a glass band with up/down arrows.
  height: {
    back: <rect x="26" y="3" width="12" height="58" rx="6" fill={BLUE} />,
    glass: [{ x: 7, y: 18, w: 50, h: 28, r: 9 }],
    glyph: <>{line("M32 24v16")}{line("M27 28l5-5 5 5")}{line("M27 36l5 5 5-5")}</>,
  },
  // Locked elements: blue shackle, glass body, white keyhole.
  lock: {
    back: <path d="M21 42v-20a11 11 0 0 1 22 0v20" fill="none" stroke={BLUE} strokeWidth="7" strokeLinecap="round" />,
    glass: [{ x: 11, y: 26, w: 42, h: 32, r: 10 }],
    glyph: <circle cx="32" cy="42" r="4" fill={W} />,
  },
  // Bleeding images: blue sun and hill behind a glass frame.
  image: {
    back: <circle cx="44" cy="20" r="13" fill={BLUE} />,
    glass: [{ x: 4, y: 20, w: 44, h: 38, r: 9 }],
    glyph: <>{line("M12 48l9-10 7 7 5-5 8 8")}<circle cx="18" cy="30" r="3" fill={W} /></>,
  },
  // Shared header & footer: a blue page between two glass bars.
  layers: {
    back: <rect x="12" y="14" width="40" height="36" rx="7" fill={BLUE} />,
    glass: [{ x: 5, y: 6, w: 54, h: 16, r: 7 }, { x: 5, y: 42, w: 54, h: 16, r: 7 }],
    glyph: <>{line("M13 14h14", 3)}{line("M13 50h22", 3)}</>,
  },
  // Blog templates: a glass page in front of a tilted blue one.
  blog: {
    back: <rect x="26" y="6" width="30" height="40" rx="6" fill={BLUE} transform="rotate(10 41 26)" />,
    glass: [{ x: 8, y: 14, w: 32, h: 44, r: 8 }],
    glyph: <>{line("M15 26h18", 3)}{line("M15 33h18", 3)}{line("M15 40h11", 3)}</>,
  },
  // Every page at once: a glass page over a blue one, with a check.
  pages: {
    back: <rect x="22" y="6" width="36" height="30" rx="8" fill={BLUE} transform="rotate(-6 40 21)" />,
    glass: [{ x: 6, y: 22, w: 38, h: 36, r: 9 }],
    glyph: line("M16 40l6 6 12-12", 3.6),
  },
  // Check: scan corners on glass, a blue dot behind.
  scan: {
    back: <circle cx="42" cy="22" r="15" fill={BLUE} />,
    glass: [{ x: 6, y: 16, w: 42, h: 42, r: 11 }],
    glyph: <>{line("M15 31v-5a3 3 0 0 1 3-3h5")}{line("M31 23h5a3 3 0 0 1 3 3v5")}{line("M39 43v5a3 3 0 0 1-3 3h-5")}{line("M23 51h-5a3 3 0 0 1-3-3v-5")}</>,
  },
  // Fix: a glass wand over a blue sparkle.
  wand: {
    back: <path d="M44 4l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill={BLUE} />,
    glass: [{ x: 4, y: 34, w: 50, h: 13, r: 7, rotate: -38 }],
    glyph: <path d="M18 18l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill={BLUE} opacity=".55" />,
  },
  // Undo: a glass disc with a white arrow, a blue disc behind.
  undo: {
    back: <circle cx="42" cy="38" r="19" fill={BLUE} />,
    glass: [{ x: 4, y: 8, w: 40, h: 40, r: "50%" }],
    glyph: <>{line("M17 25h12a7 7 0 0 1 0 14h-7")}{line("M21 20l-5 5 5 5")}</>,
  },
  // History: blue clock hands with a glass hub, like a check that tells time.
  history: {
    back: <path d="M12 26l12 12L54 10" fill="none" stroke={BLUE} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />,
    glass: [{ x: 13, y: 28, w: 22, h: 22, r: "50%" }],
  },
  // Safety: a glass shield over a blue dot, with a check.
  shield: {
    back: <circle cx="42" cy="20" r="14" fill={BLUE} />,
    glass: [{ x: 8, y: 8, w: 40, h: 50, r: 0, clip: "polygon(50% 0, 100% 16%, 100% 52%, 50% 100%, 0 52%, 0 16%)" }],
    glyph: line("M19 32l6 6 11-12", 3.6),
  },
};

export const GLASS_ICONS = Object.keys(ICONS);

export function GlassIcon({ name, size = 56, className = "" }: { name: string; size?: number; className?: string }) {
  const def = ICONS[name];
  if (!def) return null;
  const k = size / 64; // grid units -> px
  return (
    <span aria-hidden className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 size-full">{def.back}</svg>
      {def.glass.map((p, i) => {
        const style: CSSProperties = {
          left: p.x * k,
          top: p.y * k,
          width: p.w * k,
          height: p.h * k,
          borderRadius: typeof p.r === "string" ? p.r : (p.r ?? 8) * k,
          transform: p.rotate ? `rotate(${p.rotate}deg)` : undefined,
          clipPath: p.clip,
          background: "linear-gradient(160deg, rgb(206 217 255 / .5), rgb(150 176 255 / .4))",
          backdropFilter: `blur(${Math.max(3, 6 * k)}px) saturate(1.3)`,
          WebkitBackdropFilter: `blur(${Math.max(3, 6 * k)}px) saturate(1.3)`,
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / .55), inset 0 -1px 0 rgb(10 61 255 / .08)",
        };
        return <span key={i} className="absolute" style={style} />;
      })}
      {def.glyph && <svg viewBox="0 0 64 64" className="absolute inset-0 size-full">{def.glyph}</svg>}
    </span>
  );
}
