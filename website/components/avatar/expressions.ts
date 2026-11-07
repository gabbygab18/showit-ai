// Built-in expressions, stored as offsets from NEUTRAL (missing keys stay neutral).
import type { Face, Motion } from "./engine";

export type ExpressionPreset = Partial<Face> & { id: string; name: string; group: string; color?: string };

const g = (group: string, list: Omit<ExpressionPreset, "group">[]): ExpressionPreset[] => list.map((e) => ({ ...e, group }));

export const EXTRA_EXPRESSIONS: ExpressionPreset[] = [
  ...g("Moods", [
    { id: "smiling", name: "Smiling", smile: 0.8, pitch: -4, squash: 0.05 },
    { id: "beaming", name: "Beaming", smile: 1, open: 1.1, wideL: 1.15, wideR: 1.15, pitch: -8, squash: 0.1 },
    { id: "content", name: "Content", smile: 0.5, open: 0.7, roll: 6 },
    { id: "grateful", name: "Grateful", smile: 0.7, open: 0.8, pitch: 6, roll: -8 },
    { id: "sad", name: "Sad", brow: -0.8, open: 0.85, pitch: 10, shiftY: 0.05 },
    { id: "heartbroken", name: "Heartbroken", brow: -1, open: 1.1, tallL: 1.15, tallR: 1.15, lookY: 0.4, pitch: 14, squash: 0.06, color: "#7f9cf5" },
    { id: "worried", name: "Worried", brow: -0.6, open: 1.15, lookX: 0.3, shiftY: -0.03, squash: -0.04 },
    { id: "annoyed", name: "Annoyed", brow: 0.6, open: 0.7, lookX: 0.6, yaw: -8 },
    { id: "furious", name: "Furious", brow: 1, open: 0.9, wideL: 1.2, wideR: 1.2, squash: 0.12, color: "#e5484d" },
    { id: "determined", name: "Determined", brow: 0.5, open: 0.85, pitch: 6, squash: 0.04 },
    { id: "embarrassed", name: "Embarrassed", smile: 0.4, lookX: -0.4, lookY: 0.7, pitch: 12, roll: 10, color: "#ff7a9a" },
    { id: "shocked", name: "Shocked", open: 1.5, wideL: 1.3, wideR: 1.3, tallL: 1.2, tallR: 1.2, pitch: -8, squash: -0.18 },
    { id: "starstruck", name: "Starstruck", smile: 0.2, open: 1.3, wideL: 1.4, wideR: 1.4, tallL: 1.4, tallR: 1.4, shiftY: -0.05, squash: -0.1 },
    { id: "puzzled", name: "Puzzled", brow: 0.2, wideL: 0.8, tallL: 1.2, wideR: 1.2, tallR: 0.7, yaw: 10, roll: 14 },
  ]),
  ...g("Glances", [
    { id: "look-left", name: "Look left", lookX: -1, yaw: -18 },
    { id: "look-right", name: "Look right", lookX: 1, yaw: 18 },
    { id: "look-up", name: "Look up", lookY: -1, pitch: -14, shiftY: -0.06 },
    { id: "look-down", name: "Look down", lookY: 1, pitch: 14 },
    { id: "side-eye", name: "Side eye", lookX: 1, open: 0.55, brow: 0.3, yaw: -6 },
    { id: "focused", name: "Focused", gap: 0.7, wideL: 0.9, wideR: 0.9, open: 0.9, pitch: 4 },
    { id: "unimpressed", name: "Unimpressed", brow: 0.2, wideL: 1.25, wideR: 1.25, tallL: 0.55, tallR: 0.55 },
  ]),
  ...g("Playful", [
    { id: "wink-right", name: "Wink right", smile: 0.15, tallR: 0.12, wideR: 1.4, roll: 8 },
    { id: "wink-left", name: "Wink left", smile: 0.15, tallL: 0.12, wideL: 1.4, roll: -8 },
    { id: "mischievous", name: "Mischievous", smile: 0.6, brow: 0.7, lookX: -0.6, yaw: -12, roll: -6 },
    { id: "dizzy", name: "Dizzy", open: 0.8, tiltL: 32, tiltR: -24, wideL: 0.8, tallL: 1.25, wideR: 1.25, tallR: 0.75, gap: 1.1, roll: -12 },
    { id: "sleepy", name: "Sleepy", open: 0.2, wideL: 1.3, wideR: 1.3, pitch: 10, roll: -8, squash: 0.06 },
    { id: "yawn", name: "Yawn", open: 0.1, wideL: 1.4, wideR: 1.4, pitch: -12, squash: -0.15 },
    { id: "bored", name: "Bored", brow: -0.1, open: 0.45, lookX: 0.8, roll: 10 },
    { id: "squish", name: "Squish", smile: 0.9, open: 0.9, squash: 0.3 },
    { id: "stretch", name: "Stretch", open: 1.25, pitch: -6, squash: -0.3 },
  ]),
];

/** Body motion for each preset animation (by id), so long holds don't feel frozen. */
export const PRESET_MOTION: Record<string, Motion> = {
  sleeping: "breathe",
  waking: "breathe",
  idle: "sway",
  listening: "nod",
  thinking: "sway",
  working: "nod",
  excited: "bounce",
  bored: "breathe",
  angry: "shake",
  drowsy: "breathe",
  happy: "bounce",
  curious: "sway",
  confused: "sway",
  surprised: "shake",
  proud: "sway",
  shy: "sway",
  sad: "breathe",
  laughing: "giggle",
  scared: "shake",
  playful: "bounce",
  celebrate: "bounce",
};
