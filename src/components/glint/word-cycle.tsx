"use client";

// Glint UI WordCycle, extended: the outgoing word blurs away while the next one blurs in,
// and the box eases to the new word's width instead of snapping.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const css = `@keyframes word-cycle-in{from{transform:translateY(45%);opacity:0;filter:blur(8px)}to{transform:none;opacity:1;filter:blur(0)}}
@keyframes word-cycle-out{from{transform:none;opacity:1;filter:blur(0)}to{transform:translateY(-45%);opacity:0;filter:blur(8px)}}
@media (prefers-reduced-motion:reduce){.word-cycle-word{animation:none!important}.word-cycle-out{display:none}}`;

export interface WordCycleProps {
  words: string[];
  /** Ms each word stays on screen. */
  interval?: number;
  /** Ms for the crossfade and width change. */
  duration?: number;
  className?: string;
  /** Classes for each word, e.g. a gradient (`bg-clip-text` works here, unlike on the animated wrapper). */
  wordClassName?: string;
}

export function WordCycle({ words, interval = 2000, duration = 700, className, wordClassName }: WordCycleProps) {
  const [[index, prev], setPair] = useState<[number, number | null]>([0, null]);
  const [width, setWidth] = useState<number>();
  const current = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (words.length < 2) return;
    const id = window.setInterval(() => setPair(([i]) => [(i + 1) % words.length, i]), interval);
    return () => window.clearInterval(id);
  }, [words.length, interval]);

  // Transforms don't affect layout width, so the incoming word can be measured mid-animation.
  useLayoutEffect(() => setWidth(current.current?.offsetWidth), [index, words]);

  const ease = "cubic-bezier(.2,.7,.2,1)";
  // justifySelf: start keeps grid stretch from inflating the measured width.
  const word = { gridArea: "1 / 1", justifySelf: "start", display: "inline-block", whiteSpace: "nowrap" } as const;

  return (
    <span
      className={className}
      style={{ display: "inline-grid", verticalAlign: "bottom", width, transition: `width ${duration}ms ${ease}` }}
    >
      <style href="word-cycle" precedence="default">
        {css}
      </style>
      <span className="sr-only">{words.join(", ")}</span>
      {prev !== null && (
        <span
          key={`out-${index}`}
          aria-hidden
          className={`word-cycle-word word-cycle-out ${wordClassName ?? ""}`}
          style={{ ...word, animation: `word-cycle-out ${duration}ms ${ease} forwards` }}
        >
          {words[prev]}
        </span>
      )}
      <span
        key={`in-${index}`}
        ref={current}
        aria-hidden
        className={`word-cycle-word ${wordClassName ?? ""}`}
        style={{ ...word, animation: prev === null ? undefined : `word-cycle-in ${duration}ms ${ease} both` }}
      >
        {words[index]}
      </span>
    </span>
  );
}
