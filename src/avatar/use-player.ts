"use client";

import { useEffect, useRef, useState } from "react";
import { blinkAt, clamp, lerpFace, mixHex, motionAt, NEUTRAL, poseFace, sampleAnimation, type Animation, type Avatar, type Face } from "./engine";

export interface PlayerOptions {
  /** Animation to play; when null the avatar holds `still`. */
  animation?: Animation | null;
  playing?: boolean;
  /** Face (relative to neutral) shown when no animation runs. */
  still?: (Face & { color?: string }) | null;
  /** Gentle float, sway and idle blinking. */
  ambient?: boolean;
}

export interface PlayerFrame {
  face: Face;
  color: string;
  blink: number;
  float: number;
  /** Elapsed animation time in ms. */
  time: number;
}

/** Ms to ease from the face on screen to a newly picked expression or animation. */
const BLEND_MS = 400;

/** Drives an avatar frame with requestAnimationFrame while something is moving. */
export function useAvatarPlayer(avatar: Avatar, { animation = null, playing = false, still = null, ambient = true }: PlayerOptions) {
  const [clock, setClock] = useState({ anim: 0, wall: 0 });
  const elapsed = useRef(0);
  const reduce = useReducedMotion();
  const live = ambient && !reduce;
  const running = !!animation && playing;
  const animId = animation?.id;

  // Switching source (expression/animation) blends from whatever is on screen instead of jumping.
  // Derived during render, so the very first frame of the new source is already blended.
  const key = animId ?? (still as { id?: string } | null)?.id ?? "neutral";
  const shown = useRef<{ face: Face; color: string } | null>(null);
  const [blend, setBlend] = useState<{ key: string; from: { face: Face; color: string } | null; start: number }>({ key, from: null, start: 0 });
  if (blend.key !== key) setBlend({ key, from: reduce ? null : shown.current, start: performance.now() });
  const blending = !!blend.from && clock.wall < blend.start + BLEND_MS;

  // Restart from 0 when the animation changes.
  useEffect(() => {
    elapsed.current = 0;
    setClock((c) => ({ ...c, anim: 0 }));
  }, [animId]);

  useEffect(() => {
    if (!running && !live && !blending) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (running) elapsed.current += dt;
      setClock({ anim: elapsed.current, wall: now });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, live, blending]);

  const reset = () => {
    elapsed.current = 0;
    setClock((c) => ({ ...c, anim: 0 }));
  };

  let face: Face;
  let color = avatar.color;
  let hop = 0;
  if (animation) {
    const f = sampleAnimation(animation, avatar.expressions, clock.anim, avatar.color);
    color = f.color;
    const m = reduce ? motionAt("none", 0) : motionAt(animation.motion, clock.anim);
    face = { ...f.face, yaw: f.face.yaw + m.yaw, pitch: f.face.pitch + m.pitch, roll: f.face.roll + m.roll, squash: f.face.squash + m.squash };
    hop = m.float;
  } else {
    face = still ?? NEUTRAL;
    color = still?.color ?? avatar.color;
  }

  if (blend.from) {
    const u = clamp((clock.wall - blend.start) / BLEND_MS, 0, 1);
    if (u < 1) {
      const k = u * u * (3 - 2 * u);
      face = lerpFace(blend.from.face, face, k);
      color = mixHex(blend.from.color, color, k);
    }
  }
  shown.current = { face, color };

  const w = clock.wall;
  const blinkOn = live && (animation ? animation.blink : true);
  const frame: PlayerFrame = {
    face: poseFace(avatar, live ? { ...face, yaw: face.yaw + Math.sin(w * 0.0009) * 3, pitch: face.pitch + Math.sin(w * 0.0013) * 2 } : face),
    color,
    blink: blinkOn ? blinkAt(w, animation?.blinkEvery ?? 4) : 1,
    float: (live ? Math.sin(w * 0.0021) * 0.6 : 0) + hop,
    time: clock.anim,
  };
  return { frame, reset };
}

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}
