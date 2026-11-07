"use client";

import { useMemo } from "react";
import { AvatarSvg } from "@/components/avatar/avatar-svg";
import { useAvatarPlayer } from "@/components/avatar/use-player";
import { defaultProject, type Animation } from "@/components/avatar/engine";

// Ember in the app's periwinkle: the same mascot as the app and its cursor.
const EMBER = { ...defaultProject().avatars.find((a) => a.name === "Ember")!, color: "#7b84ff" };

/** The app's mascot, moving: ambient float and blinks plus one of its looping animations. */
export function LiveAvatar({ anim = "idle", size = 120, shadow = true, className }: { anim?: string; size?: number; shadow?: boolean; className?: string }) {
  const animation: Animation | null = useMemo(() => EMBER.animations.find((a) => a.id === anim) ?? null, [anim]);
  const { frame } = useAvatarPlayer(EMBER, { animation, playing: true, ambient: true });
  return (
    <span style={{ width: size, height: size }} className={`block shrink-0 ${className ?? ""}`}>
      <AvatarSvg
        avatar={EMBER}
        face={frame.face}
        color={frame.color}
        blink={frame.blink}
        float={frame.float}
        className={`h-full w-full ${shadow ? "drop-shadow-[0_18px_24px_rgb(90_100_235/.35)]" : ""}`}
      />
    </span>
  );
}
