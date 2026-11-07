// Procedural avatar model: types, defaults, interpolation and animation sampling.
// Pure functions only, so the studio, the landing page and exports all share one source of truth.

import { EXTRA_EXPRESSIONS, PRESET_MOTION } from "./expressions.ts";
import { PRESET_ANIMATIONS, PRESET_EXPRESSIONS } from "./library.ts";
import type { Shape } from "./shapes";

export type { Shape };
export type Ease = "linear" | "smooth" | "back";
export type PlayMode = "loop" | "once" | "pingpong";
export type Finish = "soft" | "flat" | "matte" | "glass" | "toon" | "neon";
export type EyeStyle = "solid" | "googly" | "glow";
/** Body movement layered on top of an animation's expressions. */
export type Motion = "none" | "bounce" | "giggle" | "shake" | "sway" | "nod" | "breathe";

/** Animatable face values. Expressions store these relative to the avatar's neutral look. */
export interface Face {
  yaw: number; // degrees, turn left/right
  pitch: number; // degrees, look up/down
  roll: number; // degrees, head tilt
  open: number; // eye openness multiplier, 0 closed .. 1.5 wide
  smile: number; // lower-lid squint, 0 .. 1 (happy crescent eyes)
  brow: number; // upper-lid tilt, -1 sad .. 1 angry
  lookX: number; // -1 .. 1
  lookY: number; // -1 .. 1
  squash: number; // -0.3 stretch .. 0.3 squash
  wideL: number; // per-eye width multiplier (L = screen left)
  wideR: number;
  tallL: number; // per-eye height multiplier
  tallR: number;
  tiltL: number; // per-eye rotation, degrees
  tiltR: number;
  gap: number; // eye spacing multiplier
  shiftY: number; // vertical eye offset, body units (-0.5 .. 0.5)
}

export interface Expression extends Face {
  id: string;
  name: string;
  group?: string;
  /** Optional temporary body color for this expression. */
  color?: string;
}

export interface Step {
  id: string;
  expressionId: string;
  hold: number; // ms
  transition: number; // ms
  ease: Ease;
}

export interface Animation {
  id: string;
  name: string;
  group?: string;
  motion?: Motion;
  steps: Step[];
  mode: PlayMode;
  blink: boolean;
  blinkEvery: number; // seconds
}

export interface Avatar {
  id: string;
  name: string;
  shape: Shape;
  width: number; // 0.5 .. 1.2
  height: number; // 0.5 .. 1.2
  roundness: number; // corner softness, 0 .. 1
  color: string;
  eyeColor: string;
  eyeSize: number; // 0.05 .. 0.25 of body width
  eyeRatio: number; // height / width, 0.5 .. 2.5
  eyeGap: number; // 0.1 .. 0.6
  eyeY: number; // -0.5 .. 0.3
  eyeRound: number; // corner roundness, 0 .. 1
  shine: boolean;
  finish: Finish; // how the body is lit (see FINISH in avatar-svg)
  eyeStyle: EyeStyle;
  screen: boolean; // dark face panel behind the eyes
  screenColor: string;
  yaw: number; // neutral pose
  pitch: number;
  expressions: Expression[];
  animations: Animation[];
}

/** Bump when built-in expressions or animations change, so saved projects pick them up once. */
export const PRESETS_VERSION = 4;

export interface Project {
  version: 1;
  /** PRESETS_VERSION this project last merged. */
  presets?: number;
  avatars: Avatar[];
}

export const NEUTRAL: Face = {
  yaw: 0,
  pitch: 0,
  roll: 0,
  open: 1,
  smile: 0,
  brow: 0,
  lookX: 0,
  lookY: 0,
  squash: 0,
  wideL: 1,
  wideR: 1,
  tallL: 1,
  tallR: 1,
  tiltL: 0,
  tiltR: 0,
  gap: 1,
  shiftY: 0,
};

export const FACE_KEYS = Object.keys(NEUTRAL) as (keyof Face)[];

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Fresh copy of the built-in expressions and the preset animation library. */
export function defaultBehavior(): Pick<Avatar, "expressions" | "animations"> {
  return {
    expressions: [
      { id: "neutral", name: "Neutral", group: "Moods", ...NEUTRAL },
      ...EXTRA_EXPRESSIONS.map((e) => ({ ...NEUTRAL, ...e })),
      ...PRESET_EXPRESSIONS.map((e) => ({ ...structuredClone(e), group: "Classic" })),
    ],
    animations: PRESET_ANIMATIONS.map((an) => ({ ...structuredClone(an), motion: PRESET_MOTION[an.id] ?? "none" })),
  };
}

// Version-1 defaults, built for the removed mouth; they duplicate the presets.
const LEGACY = {
  expressions: new Set(["Neutral", "Happy", "Curious", "Surprised", "Sleepy", "Grumpy"]),
  animations: new Set(["Say hi", "Mood swing"]),
};

/** Puts the current built-ins (matched by id) in front of the avatar's own items; optionally drops version-1 defaults. */
export function mergePresets(a: Avatar, dropLegacy: boolean): Avatar {
  const preset = defaultBehavior();
  const builtin = new Set([...preset.expressions, ...preset.animations].map((x) => x.id));
  const own = <T extends { id: string; name: string }>(list: T[], legacy: Set<string>) =>
    list.filter((x) => !builtin.has(x.id) && !(dropLegacy && legacy.has(x.name)));
  const expressions = [...preset.expressions, ...own(a.expressions, LEGACY.expressions)];
  const ids = new Set(expressions.map((e) => e.id));
  const mine = own(a.animations, LEGACY.animations).map((an) => ({ ...an, steps: an.steps.filter((s) => ids.has(s.expressionId)) }));
  return { ...a, expressions, animations: [...preset.animations, ...mine] };
}

/** Fills missing fields so hand-edited or older files still render. */
export function normalize(a: Partial<Avatar>): Avatar {
  return {
    ...newAvatar(a.name ?? "Avatar"),
    ...a,
    id: typeof a.id === "string" ? a.id : uid(),
    expressions: (Array.isArray(a.expressions) ? a.expressions : []).map((e) => ({ ...NEUTRAL, ...e })),
    animations: Array.isArray(a.animations) ? a.animations.map((an) => ({ ...an, steps: Array.isArray(an.steps) ? an.steps : [] })) : [],
  };
}

// Sample characters were renamed in presets v4; saved avatars still carrying an old sample name follow along.
const RENAMED: Record<string, string> = { Momo: "Ember", Pip: "Bitsy", Bloop: "Wobbles", Tiki: "Nacho", Puff: "Nimbus" };

/** Normalizes a loaded project and, when its built-ins are outdated, refreshes them on every avatar. */
export function upgradeProject(p: Project): Project {
  const avatars = p.avatars.map(normalize);
  if (p.presets === PRESETS_VERSION) return { version: 1, presets: PRESETS_VERSION, avatars };
  const from = p.presets ?? 0;
  return {
    version: 1,
    presets: PRESETS_VERSION,
    avatars: avatars.map((a) => ({ ...mergePresets(a, from < 3), name: from < 4 ? (RENAMED[a.name] ?? a.name) : a.name })),
  };
}

export function newAvatar(name = "Ember", over: Partial<Avatar> = {}): Avatar {
  return {
    id: uid(),
    name,
    shape: "sphere",
    width: 0.9,
    height: 0.86,
    roundness: 0.6,
    color: "#ff8a5c",
    eyeColor: "#241a2e",
    eyeSize: 0.09,
    eyeRatio: 2.2,
    eyeGap: 0.3,
    eyeY: -0.12,
    eyeRound: 1,
    shine: false,
    finish: "soft",
    eyeStyle: "solid",
    screen: false,
    screenColor: "#16122b",
    yaw: 0,
    pitch: 0,
    ...defaultBehavior(),
    ...over,
  };
}

export function defaultProject(): Project {
  return {
    version: 1,
    presets: PRESETS_VERSION,
    avatars: [
      newAvatar("Ember"),
      newAvatar("Bitsy", { shape: "cube", color: "#b9b4ff", roundness: 0.55, width: 0.82, height: 0.82, eyeStyle: "glow", eyeColor: "#7ef0ff", screen: true, eyeRatio: 1.3, eyeSize: 0.08, eyeRound: 0.6 }),
      newAvatar("Wobbles", { shape: "blob", color: "#2ec4a6", eyeStyle: "googly", eyeColor: "#111", eyeRatio: 1.1, eyeSize: 0.13, eyeGap: 0.27, shine: true }),
      newAvatar("Nacho", { shape: "cone", color: "#f5b83d", eyeY: 0.18, eyeSize: 0.08, eyeGap: 0.22 }),
      newAvatar("Nimbus", { shape: "cloud", color: "#6fb6ff", eyeStyle: "googly", eyeColor: "#0b0b12", eyeRatio: 1, eyeSize: 0.14, eyeGap: 0.3, eyeY: 0.05, shine: true }),
    ],
  };
}

/** Deep copy with fresh ids (and expression references remapped). */
export function cloneAvatar(a: Avatar, name = `${a.name} copy`): Avatar {
  const ids = new Map<string, string>();
  const expressions = a.expressions.map((e) => {
    const id = uid();
    ids.set(e.id, id);
    return { ...e, id };
  });
  const animations = a.animations.map((an) => ({
    ...an,
    id: uid(),
    steps: an.steps.map((s) => ({ ...s, id: uid(), expressionId: ids.get(s.expressionId) ?? s.expressionId })),
  }));
  return { ...a, id: uid(), name, expressions, animations };
}

// ---------- math ----------

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function lerpFace(a: Face, b: Face, t: number): Face {
  const out = { ...NEUTRAL };
  for (const k of FACE_KEYS) out[k] = lerp(a[k], b[k], t);
  return out;
}

const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  back: (t) => {
    const c = 1.7;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.padEnd(6, "0");
  const n = parseInt(full.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return (
    "#" +
    ca
      .map((v, i) =>
        Math.round(lerp(v, cb[i], clamp(t, 0, 1)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export const lighten = (hex: string, t: number) => mixHex(hex, "#ffffff", t);
export const darken = (hex: string, t: number) => mixHex(hex, "#000000", t);

// ---------- animation sampling ----------

export interface Frame {
  face: Face;
  color: string;
}

/** Eye-openness multiplier for periodic blinking (150 ms blink at the end of each period). */
export function blinkAt(ms: number, every: number): number {
  const period = Math.max(0.5, every) * 1000;
  const into = ms % period;
  const dur = 150;
  if (into < period - dur) return 1;
  const u = (into - (period - dur)) / dur;
  return 1 - Math.sin(Math.PI * u);
}

/** Total length of one pass in ms (transition + hold per step; ping-pong runs the inner steps back). */
export function animationLength(anim: Animation): number {
  return sequence(anim).reduce((s, st) => s + st.transition + st.hold, 0);
}

function sequence(anim: Animation): Step[] {
  if (anim.mode !== "pingpong" || anim.steps.length < 3) return anim.steps;
  return [...anim.steps, ...anim.steps.slice(1, -1).reverse()];
}

/** The face of `anim` at time `ms`. Each step eases in from the previous step's expression, then holds. */
export function sampleAnimation(anim: Animation, expressions: Expression[], ms: number, baseColor: string): Frame {
  const seq = sequence(anim);
  const find = (id: string) => expressions.find((e) => e.id === id);
  if (!seq.length) return { face: NEUTRAL, color: baseColor };

  const total = animationLength(anim);
  const looping = anim.mode !== "once";
  let t = total > 0 ? (looping ? ((ms % total) + total) % total : clamp(ms, 0, total)) : 0;

  for (let i = 0; i < seq.length; i++) {
    const st = seq[i];
    const span = st.transition + st.hold;
    if (t <= span || i === seq.length - 1) {
      const to = find(st.expressionId);
      // The first step starts from the last one when looping, else from neutral.
      const prevStep = i > 0 ? seq[i - 1] : looping ? seq[seq.length - 1] : undefined;
      const from = prevStep ? find(prevStep.expressionId) : undefined;
      const k = st.transition > 0 ? EASES[st.ease](clamp(t / st.transition, 0, 1)) : 1;
      return {
        face: lerpFace(from ?? NEUTRAL, to ?? NEUTRAL, k),
        color: mixHex(from?.color ?? baseColor, to?.color ?? baseColor, k),
      };
    }
    t -= span;
  }
  return { face: NEUTRAL, color: baseColor };
}

/** Body offsets for a motion at time `ms` (float is in body units, like PlayerFrame.float). */
export function motionAt(motion: Motion | undefined, ms: number): Pick<Face, "yaw" | "pitch" | "roll" | "squash"> & { float: number } {
  const o = { yaw: 0, pitch: 0, roll: 0, squash: 0, float: 0 };
  switch (motion) {
    case "bounce": {
      const hop = Math.abs(Math.sin(ms * 0.006));
      return { ...o, float: hop * 1.8, squash: 0.1 * (1 - hop) ** 6 - 0.04 * hop };
    }
    case "giggle": {
      const hop = Math.abs(Math.sin(ms * 0.016));
      return { ...o, float: hop * 0.7, roll: Math.sin(ms * 0.008) * 4, squash: 0.06 * (1 - hop) ** 4 };
    }
    case "shake":
      return { ...o, yaw: Math.sin(ms * 0.035) * 3, roll: Math.sin(ms * 0.028) * 1.5 };
    case "sway":
      return { ...o, roll: Math.sin(ms * 0.0024) * 7, yaw: Math.sin(ms * 0.0017) * 6 };
    case "nod":
      return { ...o, pitch: Math.max(0, Math.sin(ms * 0.005)) * 8 };
    case "breathe":
      return { ...o, squash: Math.sin(ms * 0.0016) * 0.035, pitch: Math.sin(ms * 0.0016) * 2 };
    default:
      return o;
  }
}

/** Adds an expression (stored relative to neutral) onto an avatar's neutral pose. */
export function poseFace(avatar: Avatar, f: Face): Face {
  return { ...f, yaw: f.yaw + avatar.yaw, pitch: f.pitch + avatar.pitch };
}

export function isProject(x: unknown): x is Project {
  const p = x as Project;
  return !!p && p.version === 1 && Array.isArray(p.avatars) && p.avatars.every((a) => typeof a?.id === "string");
}
