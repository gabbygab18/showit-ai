import type { CSSProperties, ReactNode } from "react";
import { LiveAvatar } from "@/components/LiveAvatar";
import { DownloadInline, PrimaryDownload, REL, WIN_URL, WinLogo } from "@/components/Download";
import { Playground } from "@/components/Playground";
import { Icon } from "@/components/icons/icon";
import { GlassIcon } from "@/components/GlassIcon";

const I = ({ name, className = "size-5" }: { name: string; className?: string }) => <Icon name={name} variant="solid" className={className} />;

/** Navy heading with the last words in blue. */
function Heading({ children, accent, className = "" }: { children: ReactNode; accent: string; className?: string }) {
  return (
    <h2 className={`display text-4xl text-ink sm:text-5xl ${className}`}>
      {children} <span className="text-accent">{accent}</span>
    </h2>
  );
}
const Tag = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex rounded-full border border-border bg-card px-3.5 py-1 text-xs font-medium text-ink shadow-sm">{children}</span>
);

/** Tilted floating card with a little bar chart (hero decoration). */
function ChartCard({ title, side, bars }: { title: string; side: "left" | "right"; bars: number[] }) {
  return (
    <div
      className={`float surface absolute bottom-[-46px] hidden w-[300px] p-5 md:block ${side === "left" ? "left-[-34px]" : "right-[-34px]"}`}
      style={{ "--r": side === "left" ? "-9deg" : "9deg" } as CSSProperties}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <span className="text-[11px] text-ink-soft">This page</span>
      </div>
      <div className="mt-5 flex h-24 items-end gap-2">
        {bars.map((h, i) => (
          <span key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%`, background: `linear-gradient(180deg, #7d97ff, #3b5bf6 ${60 + i * 4}%)` }} />
        ))}
      </div>
    </div>
  );
}

// [glass icon, label]
const CHECKS = [
  ["text", "Text under 12px"],
  ["offscreen", "Text off the screen"],
  ["rows", "Crowded rows"],
  ["box", "Text past its box"],
  ["height", "Section heights"],
  ["lock", "Locked elements"],
  ["image", "Bleeding images"],
  ["layers", "Shared header & footer"],
  ["blog", "Blog templates"],
  ["pages", "Every page at once"],
];

const COMPARE = [
  "Checks every page in minutes",
  "Measures where the letters really sit",
  "Re-checks after every single edit",
  "Never changes the desktop design",
  "Logs every change with what it replaced",
  "One click undoes a whole run",
];

export default function Page() {
  return (
    <main className="overflow-x-clip">
      {/* ANNOUNCEMENT */}
      <div className="bg-gradient-to-r from-[#ffe4f1] via-[#eef1ff] to-[#dfe8ff] px-4 py-2 text-center text-xs font-medium text-ink">
        New: Showit AI 1.0 for Windows. Check and fix your mobile layout in minutes.{" "}
        <a href={WIN_URL} className="font-semibold underline underline-offset-2">Download</a>
      </div>

      {/* HERO */}
      <section className="relative isolate overflow-hidden px-4 pb-40 pt-5">
        <div aria-hidden className="hero-sky absolute inset-x-3 top-0 -z-10 h-full rounded-b-[36px] sm:inset-x-6" />
        <div aria-hidden className="grid-lines absolute inset-x-3 top-0 -z-10 h-full rounded-b-[36px] [mask-image:linear-gradient(to_bottom,#000,transparent_85%)] sm:inset-x-6" />

        <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 py-3">
          <a href="#" className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-ink">
              <LiveAvatar size={26} shadow={false} />
            </span>
            <span className="display text-lg text-ink">Showit AI</span>
          </a>
          <nav className="hidden items-center gap-7 text-sm text-ink md:flex">
            <a href="#checks" className="hover:text-accent">Checks</a>
            <a href="#try" className="hover:text-accent">Try it</a>
            <a href="#compare" className="hover:text-accent">Compare</a>
            <a href="#features" className="hover:text-accent">Features</a>
            <a href="#demo" className="hover:text-accent">Demo</a>
          </nav>
          <div className="flex items-center gap-2">
            <a href="https://github.com/gabbygab18/showit-ai" className="btn-white hidden h-10 items-center rounded-full px-4 text-sm font-semibold sm:inline-flex">
              GitHub
            </a>
            <DownloadInline />
          </div>
        </header>

        <div className="mx-auto mt-16 flex max-w-3xl flex-col items-center text-center sm:mt-20">
          <Tag>Showit mobile helper</Tag>
          <h1 className="display mt-6 text-[44px] text-ink sm:text-6xl lg:text-[68px]">
            Make Every Showit Page <span className="text-accent">Look Right On Phones</span>
          </h1>
          <p className="mt-5 max-w-xl text-ink-soft">
            Showit AI checks your mobile layout the way a phone sees it, then fixes small text, spills and crowding right inside the
            Showit editor. Desktop is never touched, and every change can be undone.
          </p>
          <div className="mt-8 flex flex-wrap items-start justify-center gap-3">
            <PrimaryDownload />
            <a href="#try" className="btn-white inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold">
              Try it live
            </a>
          </div>
        </div>

        <ChartCard title="Issues fixed" side="left" bars={[30, 42, 38, 55, 62, 70, 84, 92]} />
        <ChartCard title="Mobile check" side="right" bars={[90, 72, 66, 50, 44, 31, 22, 12]} />
      </section>

      {/* WHAT IT CHECKS (in place of a logo wall) */}
      <section id="checks" className="mx-auto max-w-5xl px-6 pt-20">
        <p className="text-center text-sm text-ink-soft">Everything it checks, on every page</p>
        <div className="mt-6 grid grid-cols-2 border-l border-t border-border sm:grid-cols-5">
          {CHECKS.map(([icon, label]) => (
            <div key={label} className="flex flex-col items-center justify-center gap-3 border-b border-r border-border bg-card/40 px-3 py-6 text-center text-sm font-semibold text-ink">
              <GlassIcon name={icon} size={52} />
              {label}
            </div>
          ))}
        </div>
      </section>

      {/* TRY IT (the "calculator") */}
      <section id="try" className="mx-auto max-w-6xl px-3 pt-28 sm:px-6">
        <div className="text-center">
          <Heading accent="Right Here" className="mx-auto max-w-2xl">See What It Can Fix,</Heading>
          <p className="mx-auto mt-4 max-w-lg text-ink-soft">
            A sample Showit section with real mobile problems. Press Check, then Fix, and watch Ember work. Undo puts it all back.
          </p>
        </div>
        <div className="panel relative mt-12 p-2 sm:p-5">
          <span className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b-xl border border-t-0 border-[#d9e1ff] bg-card px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">
            Try it live
          </span>
          <div className="surface mt-6 pb-4 sm:p-8">
            <Playground />
          </div>
          <div className="surface mt-4 flex flex-col items-center justify-between gap-4 px-6 py-5 sm:flex-row">
            <div>
              <p className="font-semibold text-ink">
                Get Started With <span className="text-accent">Showit AI</span>, Fix Mobile Layouts Like Never Before
              </p>
              <p className="text-sm text-ink-soft">The same checks, on your real site, inside the Showit editor.</p>
            </div>
            <DownloadInline />
          </div>
        </div>
      </section>

      {/* DIFFERENCE (screens, like the team cards) */}
      <section id="features" className="mx-auto max-w-6xl px-6 pt-28 text-center">
        <Tag>Inside the app</Tag>
        <Heading accent="Difference" className="mt-5">
          The <span className="text-accent">Showit AI</span>
        </Heading>
        <p className="mx-auto mt-4 max-w-lg text-ink-soft">
          A small panel beside the Showit editor, with a visible cursor and a little mascot that tells you what it&apos;s doing.
        </p>
        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {[
            ["/shots/home.png", "Check & fix", "Two clicks for the page you're on"],
            ["/shots/issues.png", "Knows what to leave", "Deliberate design is reported, not changed"],
            ["/shots/history.png", "Undo anything", "Every run, one click to put it back"],
          ].map(([src, title, sub]) => (
            <div key={src} className="surface overflow-hidden text-left">
              <div className="h-72 overflow-hidden bg-gradient-to-b from-[#eef2ff] to-[#dde5ff] px-8 pt-8">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={title} className="mx-auto w-full max-w-[230px] rounded-t-[26px] shadow-xl shadow-[#2440d8]/20" />
              </div>
              <div className="p-5">
                <p className="font-semibold text-ink">{title}</p>
                <p className="text-sm text-ink-soft">{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* COMPARE */}
      <section id="compare" className="mx-auto max-w-4xl px-6 pt-28">
        <Heading accent="By Hand?" className="text-center">Why Not Just Do It</Heading>
        <div className="surface mt-10 overflow-hidden p-3 sm:p-4">
          <div className="grid grid-cols-[1fr_88px_120px] items-center gap-2 rounded-2xl bg-card-muted px-4 py-3 text-sm sm:grid-cols-[1fr_120px_160px]">
            <span className="font-medium text-ink-soft">Features</span>
            <span className="text-center font-medium text-ink-soft">By hand</span>
            <span className="flex items-center justify-center gap-1.5 rounded-xl bg-accent-soft py-2 font-semibold text-accent-deep">
              <LiveAvatar size={18} shadow={false} /> Showit AI
            </span>
          </div>
          <div className="relative">
            <div aria-hidden className="absolute bottom-0 right-4 top-2 w-[120px] rounded-2xl bg-gradient-to-b from-[#5b78ff] to-[#2f4fe8] shadow-[0_14px_30px_-12px_rgb(47_79_232/.7)] sm:w-[160px]" />
            {COMPARE.map((row) => (
              <div key={row} className="relative grid grid-cols-[1fr_88px_120px] items-center gap-2 border-b border-border px-4 py-4 text-sm last:border-0 sm:grid-cols-[1fr_120px_160px]">
                <span className="text-ink">{row}</span>
                <span className="mx-auto grid size-6 place-items-center rounded-full bg-[#ff5b5b] text-white">
                  <Icon name="close" className="size-3.5" />
                </span>
                <span className="mx-auto grid size-6 place-items-center rounded-full bg-white/25 text-white">
                  <Icon name="check" className="size-3.5" />
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BUILT IN (the "add-ons") */}
      <section className="mx-auto max-w-5xl px-6 pt-28">
        <div className="text-center">
          <Heading accent="Built In">Extras,</Heading>
          <p className="mt-3 text-sm text-ink-soft">No add-ons to buy. Everything ships in the one app.</p>
        </div>
        <div className="mt-10 space-y-5">
          {[
            {
              tag: "Rebuild",
              icon: "layers",
              title: "Rebuild A Section",
              desc: "Lays a whole section out for phones from its desktop design: one column, reading order, heights measured live. Shows the plan first.",
              img: "/shots/fix.png",
            },
            {
              tag: "Island",
              icon: "offscreen",
              title: "Island Mode",
              desc: "Fold the app into a small pill at the top of your screen. It shows progress, and a tap opens a quick check or the full panel.",
              img: "/shots/island.png",
            },
          ].map((c) => (
            <div key={c.title} className="surface grid items-center gap-6 overflow-hidden p-6 sm:grid-cols-2 sm:p-8">
              <div>
                <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-deep">{c.tag}</span>
                <p className="display mt-3 flex items-center gap-3 text-2xl text-ink">
                  <GlassIcon name={c.icon} size={40} /> {c.title}
                </p>
                <p className="mt-2 text-sm text-ink-soft">{c.desc}</p>
                <div className="mt-5">
                  <DownloadInline />
                </div>
              </div>
              <div className={`grid h-64 justify-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#eef2ff] to-[#dbe4ff] p-6 ${c.tag === "Island" ? "items-center" : "items-start"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.img} alt={c.title} className={c.tag === "Island" ? "w-full max-w-[300px] rounded-[26px] bg-black" : "mt-2 w-[210px] rounded-[24px] shadow-xl"} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* DEMO (in place of testimonials) */}
      <section id="demo" className="mx-auto max-w-5xl px-6 pt-28 text-center">
        <Heading accent="Work">Watch It</Heading>
        <p className="mx-auto mt-3 max-w-md text-sm text-ink-soft">A three-minute tour: check, fix, rebuild, undo, and the island.</p>
        <div className="surface mt-10 overflow-hidden p-2">
          <video controls preload="none" poster="/shots/tour.jpg" className="block aspect-video w-full rounded-2xl bg-ink">
            <source src={`${REL}/showit-ai-demo-small.mp4`} type="video/mp4" />
          </video>
        </div>
      </section>

      {/* CTA over the footer */}
      <section className="relative mt-28 px-6">
        <div aria-hidden className="absolute inset-x-0 bottom-0 top-1/2 bg-[#2f4fe8]" />
        <div className="relative mx-auto grid max-w-5xl items-center gap-8 overflow-hidden rounded-[28px] border border-white bg-gradient-to-br from-white to-[#e6ecff] p-8 shadow-2xl shadow-[#1b2fa8]/30 sm:grid-cols-[1.3fr_1fr] sm:p-12">
          <div>
            <h2 className="display text-3xl text-ink sm:text-4xl">
              Save Time, Ship
              <br />A Better Mobile Site.
            </h2>
            <p className="mt-3 max-w-sm text-sm text-ink-soft">
              Install it, open your site in the Showit editor, and press Check. Requires Windows 10 or 11, Google Chrome and a Showit
              account.
            </p>
            <div className="mt-6">
              <PrimaryDownload />
            </div>
          </div>
          <div className="relative hidden h-56 sm:block">
            {[
              ["scan", "left-6 top-0", "-8deg"],
              ["wand", "left-32 top-12", "6deg"],
              ["undo", "right-4 top-2", "10deg"],
              ["history", "right-24 bottom-4", "-6deg"],
              ["shield", "left-2 bottom-2", "4deg"],
            ].map(([icon, pos, r]) => (
              <span key={icon} className={`float absolute ${pos}`} style={{ "--r": r } as CSSProperties}>
                <GlassIcon name={icon} size={64} />
              </span>
            ))}
            <LiveAvatar anim="happy" size={92} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative overflow-hidden bg-[#2f4fe8] px-6 pb-8 pt-10 text-white">
        {/* Watermark: a soft blurred glow behind, gradient lettering in front, both fading out downward. */}
        <div aria-hidden className="pointer-events-none relative select-none text-center text-[19vw] leading-none">
          {/* The glow isn't masked: a mask would clip the blur into a visible box. */}
          <p className="display absolute inset-x-0 top-0 text-white/20 blur-2xl">SHOWIT AI</p>
          <p className="display relative bg-gradient-to-b from-white/60 via-white/20 to-white/0 bg-clip-text text-transparent [mask-image:linear-gradient(to_bottom,#000_40%,transparent_95%)]">
            SHOWIT AI
          </p>
        </div>
        <div className="mx-auto mt-6 grid max-w-6xl gap-8 text-sm sm:grid-cols-4">
          {[
            ["Product", [["Checks", "#checks"], ["Try it", "#try"], ["Compare", "#compare"], ["Demo", "#demo"]]],
            ["Download", [["Windows installer", WIN_URL], ["Releases", "https://github.com/gabbygab18/showit-ai/releases"], ["Source on GitHub", "https://github.com/gabbygab18/showit-ai"]]],
            ["Help", [["Requirements", "#try"], ["What it changes", "#compare"], ["Island mode", "#features"]]],
          ].map(([title, links]) => (
            <div key={title as string}>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">{title as string}</p>
              <ul className="mt-3 space-y-2">
                {(links as string[][]).map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className="text-white/90 hover:text-white">{label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex items-start sm:justify-end">
            <a href={WIN_URL} className="btn-white inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold">
              <WinLogo className="size-4" /> Download
            </a>
          </div>
        </div>
        <div className="mx-auto mt-10 flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-white/20 pt-6 text-xs text-white/70 sm:flex-row">
          <span>© {new Date().getFullYear()} Showit AI</span>
          <span>Independent tool. Not affiliated with or endorsed by Showit.</span>
        </div>
      </footer>
    </main>
  );
}
