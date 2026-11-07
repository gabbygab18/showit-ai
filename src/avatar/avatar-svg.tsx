"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";
import { clamp, darken, lighten, NEUTRAL, type Avatar, type Face } from "./engine";
import { outline, shapePath, type Pt } from "./shapes";

// Body is drawn in a 200x200 box centered on 0,0. Features are projected from a
// unit sphere so yaw/pitch slide them across the surface with foreshortening.
const R = 78;
const DEG = Math.PI / 180;
const MORPH_MS = 450;

/** How each finish lights the body: gradient strength, glassy edge, highlight, bounce light, fill opacity. */
const FINISH: Record<string, { light: number; dark: number; edge: number; spec: number; bounce: boolean; opacity: number }> = {
  soft: { light: 0.45, dark: 0.22, edge: 0.55, spec: 0.75, bounce: true, opacity: 1 },
  flat: { light: 0, dark: 0, edge: 0, spec: 0, bounce: false, opacity: 1 },
  matte: { light: 0.18, dark: 0.18, edge: 0, spec: 0, bounce: true, opacity: 1 },
  glass: { light: 0.55, dark: 0.1, edge: 0.9, spec: 0.95, bounce: true, opacity: 0.55 },
  toon: { light: 0, dark: 0, edge: 0, spec: 0, bounce: false, opacity: 1 },
  neon: { light: 0.12, dark: 0.1, edge: 0.35, spec: 0, bounce: false, opacity: 1 },
};

// Trig results can differ in the last digit between Node and browsers; rounding keeps SSR hydration stable.
const q = (v: number) => Math.round(v * 1e4) / 1e4;

/** Projects a face-local point (u, v in -1..1) onto the rotated body. */
function project(u: number, v: number, yaw: number, pitch: number, rx: number, ry: number) {
  const a = Math.asin(clamp(u * 0.9, -1, 1)) + yaw * DEG;
  const b = Math.asin(clamp(v * 0.9, -1, 1)) + pitch * DEG;
  return {
    x: q(Math.sin(a) * rx * 0.92),
    y: q(Math.sin(b) * ry * 0.92),
    sx: q(Math.max(0.04, Math.cos(a))),
    sy: q(Math.max(0.04, Math.cos(b))),
    visible: Math.cos(a) > 0.05 && Math.cos(b) > 0.05,
  };
}

/** Tweens between outlines when the shape changes; other changes (roundness drags) apply at once. */
function useMorph(shape: string, pts: Pt[]): Pt[] {
  const [shown, setShown] = useState(pts);
  const last = useRef({ shape, pts });

  useEffect(() => {
    const from = last.current;
    if (from.pts === pts) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (from.shape === shape || reduce) {
      last.current = { shape, pts };
      setShown(pts);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const u = Math.min(1, (now - t0) / MORPH_MS);
      const k = u * u * (3 - 2 * u);
      const cur = u >= 1 ? pts : from.pts.map(([x, y], i): Pt => [x + (pts[i][0] - x) * k, y + (pts[i][1] - y) * k]);
      last.current = { shape, pts: cur };
      setShown(cur);
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shape, pts]);

  return shown;
}

export interface AvatarSvgProps {
  avatar: Avatar;
  face?: Face;
  /** Body color for this frame (expression overrides). */
  color?: string;
  /** Extra eye-openness multiplier for blinking. */
  blink?: number;
  /** Vertical float offset in body units. */
  float?: number;
  guides?: boolean;
  className?: string;
  ref?: Ref<SVGSVGElement>;
  title?: string;
}

export function AvatarSvg({
  avatar: av,
  face = NEUTRAL,
  color = av.color,
  blink = 1,
  float = 0,
  guides = false,
  className,
  ref,
  title,
}: AvatarSvgProps) {
  const id = useId().replace(/[^\w-]/g, "");
  const rx = R * av.width;
  const ry = R * av.height;
  const yaw = face.yaw;
  const pitch = face.pitch;
  const shape = outline(av.shape, av.roundness);
  const body = shapePath(useMorph(av.shape, shape.pts), rx, ry);
  const cap = shape.cap && { cx: shape.cap.cx * rx, cy: shape.cap.cy * ry, rx: shape.cap.rx * rx, ry: shape.cap.ry * ry };
  const finish = FINISH[av.finish] ?? FINISH.soft;
  const base = av.finish === "neon" ? darken(color, 0.78) : color;
  const style = av.eyeStyle ?? "solid";

  const ew = av.eyeSize * rx * 2.2;
  const eh = ew * av.eyeRatio;
  const open = clamp(face.open * blink, 0, 1.6);
  // Googly eyes stay put and roll their pupils instead.
  const lookX = style === "googly" ? 0 : face.lookX * ew * 0.35;
  const lookY = style === "googly" ? 0 : face.lookY * eh * 0.25;

  const eyes = [-1, 1].map((side) => {
    const L = side < 0;
    const p = project(side * av.eyeGap * face.gap, av.eyeY + face.shiftY, yaw, pitch, rx, ry);
    const w = ew * (L ? face.wideL : face.wideR) * p.sx;
    const h = Math.max(0.6, eh * open * (L ? face.tallL : face.tallR) * p.sy);
    const tilt = L ? face.tiltL : face.tiltR;
    // Lids: the top edge tilts (brow), the bottom edge arcs up (smile).
    const inner = -h / 2 - 2 + face.brow * h * 0.55;
    const outer = -h / 2 - 2 - face.brow * h * 0.15;
    const [tl, tr] = side < 0 ? [outer, inner] : [inner, outer];
    // The quadratic bottom curve peaks halfway to its control point, so this leaves a crescent at smile = 1.
    const lift = face.smile * h * 0.7;
    const clip = `M${-w},${tl} L${w},${tr} L${w},${h / 2 + 2} Q0,${h / 2 + 2 - lift * 2} ${-w},${h / 2 + 2} Z`;
    return { side, p, w, h, tilt, clip };
  });

  const plate = av.screen ? project(0, av.eyeY + face.shiftY, yaw, pitch, rx, ry) : null;
  const plateW = (av.eyeGap * 2 * 0.92 * rx + ew * 2.4) * (plate?.sx ?? 1);
  const plateH = eh * 2 * (plate?.sy ?? 1);

  // Squash keeps the base planted on the ground.
  const sx = 1 + face.squash;
  const sy = 1 - face.squash;
  const lift = -float * 6;

  return (
    <svg ref={ref} viewBox="-100 -100 200 200" className={className} role="img" aria-label={title ?? av.name} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={`${id}-body`} cx="36%" cy="28%" r="85%">
          <stop offset="0" stopColor={lighten(base, finish.light)} />
          <stop offset="0.45" stopColor={base} />
          <stop offset="1" stopColor={darken(base, finish.dark)} />
        </radialGradient>
        {/* Glassy edge glow, a soft top-left highlight and light bouncing up from below. */}
        <radialGradient id={`${id}-edge`} r="62%">
          <stop offset="0.68" stopColor={lighten(color, 0.6)} stopOpacity="0" />
          <stop offset="1" stopColor={lighten(color, 0.6)} stopOpacity={finish.edge} />
        </radialGradient>
        <radialGradient id={`${id}-spec`}>
          <stop offset="0" stopColor="#fff" stopOpacity={finish.spec} />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-bounce`}>
          <stop offset="0" stopColor={lighten(color, 0.4)} stopOpacity="0.45" />
          <stop offset="1" stopColor={lighten(color, 0.4)} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop offset="0" stopColor={darken(color, 0.55)} stopOpacity="0.38" />
          <stop offset="1" stopColor={darken(color, 0.55)} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-sclera`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.55" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9e1ee" />
        </linearGradient>
        <linearGradient id={`${id}-screen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={lighten(av.screenColor, 0.12)} />
          <stop offset="1" stopColor={av.screenColor} />
        </linearGradient>
        <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <clipPath id={`${id}-clip`}>
          <path d={body} />
        </clipPath>
        {eyes.map((e) => (
          <clipPath key={e.side} id={`${id}-lid${e.side}`}>
            <path d={e.clip} />
          </clipPath>
        ))}
      </defs>

      <ellipse cx="0" cy={ry * sy + 10} rx={rx * 0.85 * (1 - float * 0.08)} ry="9" fill={`url(#${id}-shadow)`} />

      <g transform={`translate(0 ${lift + ry * face.squash}) rotate(${face.roll}) scale(${sx} ${sy})`}>
        {av.finish === "neon" && <path d={body} fill="none" stroke={color} strokeWidth="5" opacity="0.8" filter={`url(#${id}-glow)`} />}
        <path d={body} fill={`url(#${id}-body)`} fillOpacity={finish.opacity} />
        {cap && <ellipse cx={cap.cx} cy={cap.cy} rx={cap.rx} ry={cap.ry} fill={lighten(color, 0.22)} stroke={lighten(color, 0.55)} strokeOpacity="0.4" strokeWidth="1" />}

        <g clipPath={`url(#${id}-clip)`}>
          {finish.edge > 0 && <path d={body} fill={`url(#${id}-edge)`} />}
          {finish.bounce && <ellipse cx={0} cy={ry * 0.78} rx={rx * 0.65} ry={ry * 0.25} fill={`url(#${id}-bounce)`} />}
          {guides && <Guides yaw={yaw} pitch={pitch} rx={rx} ry={ry} />}

          {plate?.visible && (
            <g transform={`translate(${plate.x} ${plate.y})`}>
              <rect x={-plateW / 2} y={-plateH / 2} width={plateW} height={plateH} rx={Math.min(plateW, plateH) * 0.42} fill={`url(#${id}-screen)`} />
              <rect x={-plateW / 2 + 4} y={-plateH / 2 + 2.5} width={plateW - 8} height={plateH * 0.28} rx={plateH * 0.14} fill="#fff" opacity="0.08" />
            </g>
          )}

          {eyes.map(
            (e) =>
              e.p.visible && (
                <g key={e.side} transform={`translate(${e.p.x + lookX * e.p.sx} ${e.p.y + lookY * e.p.sy}) rotate(${e.tilt})`}>
                  {style === "glow" && (
                    <rect x={-e.w / 2} y={-e.h / 2} width={e.w} height={e.h} rx={(Math.min(e.w, e.h) / 2) * av.eyeRound} fill={av.eyeColor} opacity="0.8" filter={`url(#${id}-glow)`} />
                  )}
                  <g clipPath={`url(#${id}-lid${e.side})`}>
                    <Eye style={style} w={e.w} h={e.h} round={av.eyeRound} color={av.eyeColor} rim={darken(color, 0.3)} look={[face.lookX, face.lookY]} shine={av.shine && open > 0.35} gradient={`url(#${id}-sclera)`} />
                  </g>
                </g>
              ),
          )}
        </g>

        {finish.spec > 0 && <ellipse cx={-rx * 0.34} cy={-ry * 0.46} rx={rx * 0.36} ry={ry * 0.2} transform={`rotate(-22 ${-rx * 0.34} ${-ry * 0.46})`} fill={`url(#${id}-spec)`} />}
        {av.finish === "toon" && (
          <>
            <path d={body} fill="none" stroke={darken(color, 0.6)} strokeWidth="4" strokeLinejoin="round" />
            <ellipse cx={-rx * 0.38} cy={-ry * 0.5} rx={rx * 0.16} ry={ry * 0.08} transform={`rotate(-28 ${-rx * 0.38} ${-ry * 0.5})`} fill="#fff" opacity="0.7" />
          </>
        )}
        {av.finish === "neon" && <path d={body} fill="none" stroke={lighten(color, 0.25)} strokeWidth="2.2" />}
        {av.finish === "flat" && <path d={body} fill="none" stroke={lighten(color, 0.5)} strokeOpacity="0.25" strokeWidth="1.2" />}
      </g>
    </svg>
  );
}

function Eye({ style, w, h, round, color, rim, look, shine, gradient }: {
  style: string;
  w: number;
  h: number;
  round: number;
  color: string;
  rim: string;
  look: [number, number];
  shine: boolean;
  gradient: string;
}) {
  const r = (Math.min(w, h) / 2) * round;
  const box = { x: -w / 2, y: -h / 2, width: w, height: h, rx: r };
  if (style === "googly") {
    const pr = Math.min(w, h) * 0.34;
    const px = look[0] * Math.max(0, w / 2 - pr) * 0.85;
    const py = look[1] * Math.max(0, h / 2 - pr) * 0.85;
    return (
      <>
        <rect {...box} fill={gradient} stroke={rim} strokeOpacity="0.35" strokeWidth="0.8" />
        <circle cx={px} cy={py} r={pr} fill={color} />
        {shine && <circle cx={px + pr * 0.35} cy={py - pr * 0.4} r={pr * 0.28} fill="#fff" opacity="0.9" />}
      </>
    );
  }
  if (style === "glow") {
    return (
      <>
        <rect {...box} fill={color} />
        <rect {...box} fill="#fff" opacity="0.35" transform={`scale(0.55)`} />
      </>
    );
  }
  return (
    <>
      <rect {...box} fill={color} />
      {shine && <circle cx={w * 0.18} cy={-h * 0.22} r={Math.min(w, h) * 0.16} fill="#fff" opacity="0.9" />}
    </>
  );
}

/** Wireframe meridians and parallels that rotate with the body. */
function Guides({ yaw, pitch, rx, ry }: { yaw: number; pitch: number; rx: number; ry: number }) {
  const lines = [];
  for (let i = -3; i <= 3; i++) {
    const a = i * 30 * DEG + yaw * DEG;
    if (Math.cos(a) <= 0) continue;
    lines.push(<ellipse key={`m${i}`} cx={0} cy={0} rx={q(Math.abs(Math.sin(a)) * rx)} ry={ry} />);
  }
  for (let i = -2; i <= 2; i++) {
    const b = i * 30 * DEG + pitch * DEG;
    if (Math.cos(b) <= 0) continue;
    lines.push(<ellipse key={`p${i}`} cx={0} cy={q(Math.sin(b) * ry)} rx={q(Math.cos(b) * rx)} ry={q(Math.cos(b) * rx * 0.12)} />);
  }
  return (
    <g fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="0.7" strokeDasharray="2 2">
      {lines}
    </g>
  );
}
