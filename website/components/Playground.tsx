"use client";

import { useRef, useState, type CSSProperties } from "react";
import { audit, measureInk } from "@/lib/rules";
import { LiveAvatar } from "@/components/LiveAvatar";
import { Icon } from "@/components/icons/icon";

/*
 * "Try it": a sample Showit mobile section with real problems, checked and fixed in the browser by the
 * app's own rules (lib/rules.js is generated from the app's audit.js). Text is measured live, exactly
 * like the app measures Showit's preview.
 */

type M = { x: number; y: number; w: number; h: number; size?: number; tA?: string };
type El = { type: "text" | "graphic"; visible: "a"; content?: { text: string }; desktop: object; mobile: M; look?: CSSProperties; photo?: string };
type Block = { id: string; name: string; visible: "a"; mobile: { h: number }; elements: El[] };
type Issue = { id: string; what: string; problem: string; fix: Record<string, unknown> | null };

const T = (text: string, mobile: M, look: CSSProperties = {}): El => ({ type: "text", visible: "a", content: { text }, desktop: {}, mobile: { tA: "left", ...mobile }, look });
const SAMPLE: Block = {
  id: "demo",
  name: "Featured story",
  visible: "a",
  mobile: { h: 520 },
  elements: [
    { type: "graphic", visible: "a", desktop: {}, mobile: { x: 0, y: 0, w: 320, h: 520 }, photo: "linear-gradient(160deg,#3a2f2a 0%,#5b4636 45%,#2a2420 100%)" },
    T("Stories in stillness and light", { x: 24, y: 50, w: 272, h: 16, size: 10 }, { textTransform: "uppercase", letterSpacing: ".16em", fontWeight: 600, color: "#f3d9b8" }),
    T("Where light becomes legacy", { x: -14, y: 74, w: 348, h: 84, size: 34 }, { fontFamily: "var(--font-satoshi)", fontWeight: 700, lineHeight: 1.05, color: "#fff" }),
    T("Photography that feels like memory, styled like art. Stolen glances and sunlit stillness.", { x: 24, y: 178, w: 272, h: 60, size: 13 }, { color: "rgb(255 255 255 / .85)" }),
    T("Location", { x: 24, y: 262, w: 70, h: 14, size: 10 }, { color: "#f3d9b8", fontWeight: 600 }),
    T("Paris, France", { x: 104, y: 262, w: 150, h: 14, size: 10 }, { color: "#fff" }),
    T("Season", { x: 24, y: 286, w: 70, h: 14, size: 10 }, { color: "#f3d9b8", fontWeight: 600 }),
    T("Autumn", { x: 104, y: 286, w: 150, h: 14, size: 10 }, { color: "#fff" }),
    { type: "graphic", visible: "a", desktop: {}, mobile: { x: 214, y: 316, w: 140, h: 150 }, photo: "linear-gradient(150deg,#d9b48f,#8b6a52 60%,#4a3a30)" },
    T("Book a session →", { x: 24, y: 410, w: 160, h: 20, size: 13 }, { color: "#fff", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 4 }),
    T("© 2026 Lūce Photography", { x: 24, y: 488, w: 200, h: 14, size: 9 }, { color: "rgb(255 255 255 / .6)" }),
  ],
};

const clone = (b: Block): Block => JSON.parse(JSON.stringify(b));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const short = (p: string) => p.split(" (")[0].split(";")[0];
const kind = (i: Issue) => (i.fix ? "fixable" : /intentional/.test(i.problem) ? "left" : "person");

export function Playground() {
  const [block, setBlock] = useState<Block>(() => clone(SAMPLE));
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [fixed, setFixed] = useState(0);
  const [say, setSay] = useState("Press Check and I'll read this section the way a phone sees it.");
  const [cur, setCur] = useState({ x: 250, y: 470, moving: false });
  const [hot, setHot] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const live = useRef(block);
  live.current = block;

  // The same check the app runs: measure where the letters really are, then apply the rules.
  const check = async (): Promise<Issue[]> => {
    await frames();
    return audit({ blocks: [live.current], theme: { styles: {} }, ink: measureInk() }) as Issue[];
  };

  /** Glide the cursor (and Ember) to an element. */
  const goTo = async (id: string) => {
    const el = document.getElementById(`si_element_${id.replace(/\./g, "_")}`);
    const box = wrap.current?.getBoundingClientRect();
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + Math.min(r.width, 300) / 2 - box.left, 8), box.width - 8);
    setCur({ x, y: r.top + Math.min(r.height, 40) / 2 - box.top, moving: true });
    setHot(id);
    await sleep(650);
    setCur((c) => ({ ...c, moving: false }));
  };

  const runCheck = async () => {
    setBusy(true);
    setSay("Checking…");
    const found = await check();
    setIssues(found);
    for (const i of found) {
      await goTo(i.id);
      setSay(`${short(i.problem)}${i.fix ? "" : kind(i) === "left" ? ". Looks deliberate, leaving it." : ". Needs a person."}`);
      await sleep(900);
    }
    setHot(null);
    const n = found.filter((i) => i.fix).length;
    setSay(found.length ? `${found.length} issue${found.length === 1 ? "" : "s"}: ${n} I can fix. Press Fix.` : "No mobile problems found.");
    setBusy(false);
  };

  const runFix = async () => {
    setBusy(true);
    let done = 0;
    // Like the app: several passes, because one fix can reveal the next.
    for (let pass = 0; pass < 4; pass++) {
      const seen = new Set<string>();
      const todo = (await check()).filter((i) => i.fix && !seen.has(i.id) && seen.add(i.id));
      if (!todo.length) break;
      for (const i of todo) {
        await goTo(i.id);
        const { also = [], ...main } = i.fix as { also?: { id: string; fix: Record<string, number> }[] } & Record<string, number>;
        setSay(`Fixing: ${short(i.problem)}`);
        setBlock((b) => {
          const next = clone(b);
          for (const g of [{ id: i.id, fix: main }, ...also]) {
            if ("sectionH" in g.fix) next.mobile.h = g.fix.sectionH;
            else Object.assign(next.elements[+g.id.split(".").pop()!].mobile, g.fix);
          }
          return next;
        });
        done++;
        setFixed(done);
        await sleep(800); // let the change animate before the next measurement
      }
    }
    setHot(null);
    const left = await check();
    setIssues(left);
    setSay(`Done: ${done} fix${done === 1 ? "" : "es"}. ${left.length ? `${left.length} left for you to decide.` : "All clear."} Desktop untouched.`);
    setCur({ x: 250, y: 470, moving: false });
    setBusy(false);
  };

  const undo = async () => {
    setBlock(clone(SAMPLE));
    setIssues(null);
    setFixed(0);
    setHot(null);
    setSay("Back to exactly how it was. That's what Undo does in the app too.");
  };

  const fixable = issues?.filter((i) => i.fix).length ?? 0;
  const btn = "inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[1fr_auto] lg:gap-12">
      <div className="px-4 pt-5 sm:p-0">
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={runCheck} disabled={busy} className={`${btn} bg-ink text-bg hover:bg-ink/85`}>
            <Icon name="scan" variant="solid" className="size-4" /> Check
          </button>
          <button type="button" onClick={runFix} disabled={busy || !fixable || fixed > 0} className={`${btn} bg-accent text-ink hover:bg-accent-deep hover:text-white`}>
            <Icon name="magic-wand" variant="solid" className="size-4" /> Fix {fixable && !fixed ? `${fixable}` : ""}
          </button>
          <button type="button" onClick={undo} disabled={busy || (!fixed && !issues)} className={`${btn} border border-ink/15 bg-card hover:bg-bg`}>
            <Icon name="undo" variant="solid" className="size-4" /> Undo
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-card-muted px-4 py-2 font-medium">Issues found: <b>{issues ? issues.length : "–"}</b></span>
          <span className="rounded-full bg-card-muted px-4 py-2 font-medium">Fixed: <b>{fixed}</b></span>
          <span className="rounded-full bg-card-muted px-4 py-2 font-medium">Desktop changes: <b>0</b></span>
        </div>

        <ol className="mt-6 space-y-2">
          {(issues ?? []).map((i, n) => (
            <li
              key={i.id + i.problem}
              onMouseEnter={() => setHot(i.id)}
              onMouseLeave={() => setHot(null)}
              className={`flex items-start gap-3 rounded-2xl p-3 transition ${hot === i.id ? "bg-card shadow-sm" : "bg-card-muted"}`}
            >
              <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${kind(i) === "fixable" ? "bg-accent text-ink" : "bg-amber-300 text-ink"}`}>{n + 1}</span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{i.what.replace(/^text /, "")}</span>
                <span className="block text-ink-soft">{short(i.problem)}</span>
              </span>
              <span className="shrink-0 rounded-full bg-bg px-2.5 py-1 text-[11px] font-semibold">
                {kind(i) === "fixable" ? "Fixable" : kind(i) === "left" ? "Left as is" : "Needs a person"}
              </span>
            </li>
          ))}
          {!issues && <li className="rounded-2xl bg-card-muted p-4 text-sm text-ink-soft">Nothing checked yet. The list fills in as Ember finds things.</li>}
        </ol>
        <p className="mt-6 max-w-md text-xs text-ink-soft">
          A sample section, not a real site. The checks are the app&apos;s own rules, running in your browser and measuring the real text.
        </p>
      </div>

      {/* Phone with the sample section; the cursor layer sits outside the clipped screen. */}
      <div ref={wrap} className="relative mx-auto w-[340px]">
        <div className="rounded-[46px] bg-ink p-[10px] shadow-2xl shadow-black/30">
          <div className="relative overflow-hidden rounded-[36px] bg-black" style={{ height: block.mobile.h, transition: "height .6s" }}>
            {block.elements.map((e, i) => {
              const id = `demo.elements.${i}`;
              const m = e.mobile;
              const style: CSSProperties = {
                position: "absolute",
                left: m.x,
                top: m.y,
                width: m.w,
                height: m.h,
                transition: "left .6s, top .6s, width .6s, height .6s, font-size .6s, outline-color .2s",
                outline: `2px dashed ${hot === id ? "var(--accent)" : "transparent"}`,
                outlineOffset: 3,
                borderRadius: 4,
              };
              return e.type === "graphic" ? (
                <div key={i} style={{ ...style, background: e.photo, borderRadius: i === 0 ? 0 : 10 }} />
              ) : (
                <div key={i} id={`si_element_demo_elements_${i}`} style={{ ...style, fontSize: m.size, lineHeight: 1.35, textAlign: m.tA as CSSProperties["textAlign"], ...e.look }}>
                  {e.content!.text}
                </div>
              );
            })}
            {issues?.map((i, n) => {
              const m = block.elements[+i.id.split(".").pop()!]?.mobile;
              if (!m) return null;
              return (
                <span
                  key={"pin" + i.id + i.problem}
                  className={`pointer-events-none absolute grid size-5 place-items-center rounded-full text-[10px] font-bold text-ink shadow ${kind(i) === "fixable" ? "bg-accent" : "bg-amber-300"}`}
                  style={{ left: Math.min(Math.max(m.x, 0), 296) + (n % 2) * 6, top: m.y - 10, transition: "left .6s, top .6s" }}
                >
                  {n + 1}
                </span>
              );
            })}
          </div>
        </div>

        {/* macOS-style cursor with Ember and a speech bubble, like the app's cursor in Showit */}
        <div className="pointer-events-none absolute left-0 top-0 z-10" style={{ transform: `translate(${cur.x}px, ${cur.y}px)`, transition: "transform .6s cubic-bezier(.22,.8,.3,1)" }}>
          <svg width="22" height="28" viewBox="0 0 22 28" className="absolute -left-[3px] -top-[2px] drop-shadow">
            <path d="M3 2v19.5l4.6-4.4 3.3 7.7 3.3-1.4-3.2-7.5h6.3z" fill="#000" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <LiveAvatar anim={busy ? "working" : "idle"} size={26} shadow={false} className={`absolute left-[12px] top-[16px] transition-transform ${cur.moving ? "rotate-12" : ""}`} />
          <span className={`absolute top-[20px] w-max max-w-[230px] rounded-xl border border-black/10 bg-white/95 px-3 py-2 text-xs leading-snug text-ink shadow-lg backdrop-blur ${cur.x > 180 ? "right-[10px]" : "left-[42px]"}`}>
            {say}
          </span>
        </div>
      </div>
    </div>
  );
}
