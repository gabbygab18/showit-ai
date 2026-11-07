import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { LayoutGroup, motion } from "motion/react";
import { AvatarSvg } from "@/avatar/avatar-svg";
import { defaultProject } from "@/avatar/engine";
import { useAvatarPlayer } from "@/avatar/use-player";
import { Button } from "@/components/glint/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/glint/dialog";
import { DynamicIsland, type DynamicIslandState } from "@/components/glint/dynamic-island";
import { useToast } from "@/components/glint/toast";
import { Icon } from "@/icons/icon";
import { cn } from "@/lib/utils";

type Status = { chrome: boolean; showit: boolean; title: string };
type Run = { run: string; at: string; n: number; pages: string[]; notes: string[] };
type JobEvent = { type: "line"; text: string } | { type: "end"; code: number };
type Script = "audit.js" | "fix.js" | "rebuild.js" | "restore.js";
type Mode = "panel" | "island";

declare global {
  interface Window {
    sai?: {
      run: (script: Script, args: string[]) => Promise<boolean>;
      stop: () => Promise<boolean>;
      status: () => Promise<Status>;
      openShowit: () => Promise<boolean>;
      sections: () => Promise<{ page: string; sections: string[] }>;
      runs: () => Promise<Run[]>;
      onJob: (cb: (e: JobEvent) => void) => () => void;
      window: (action: "close" | "minimize" | "pin") => void;
      resize: (dir: string | null) => void;
      mode: (mode?: Mode) => Promise<Mode>;
      onMode: (cb: (mode: Mode) => void) => () => void;
      clickThrough: (on: boolean) => void;
      drag: (on: boolean) => void;
    };
  }
}

const sai = window.sai;
// Ember, in the app's periwinkle (the cursor's avatar gets the same hue).
const ME = { ...defaultProject().avatars.find((a) => a.name === "Ember")!, color: "#7b84ff" };

/** Icon from the icons-website set: filled by default. */
const I = ({ name, className, line }: { name: string; className?: string; line?: boolean }) => (
  <Icon name={name} variant={line ? "line" : "solid"} className={cn("size-4 shrink-0", className)} />
);

// ---- output parsing -----------------------------------------------------------------------------

type Tone = "page" | "block" | "step" | "ok" | "warn" | "error" | "done" | "muted";
type Line = { id: number; text: string; tone: Tone };
const tone = (t: string): Tone =>
  /^STOPPED:/.test(t) ? "error"
  : /reverted|skipped|manual layout|looks intentional|locked|needs a person/.test(t) ? "warn"
  : /^\s+ok$/.test(t) ? "ok"
  : /^#### Page:|, pass \d+:/.test(t) ? "page"
  : /^== /.test(t) ? "block"
  : /^- /.test(t) ? "step"
  : /^(Done|Restored|Tour done|Nothing to fix)|issue\(s\)|section height/.test(t) ? "done"
  : "muted";

type Issue = { page: string; block: string; what: string; problem: string; fixable: boolean };
/** Issues from audit.js output ("#### Page:", "== Section", "  what: problem  [fixable]   [id]"). */
function parseIssues(lines: Line[]): Issue[] {
  const out: Issue[] = [];
  let page = "", block = "";
  for (const { text } of lines) {
    const p = text.match(/^#### Page: (.+) \(\d+ issue/);
    if (p) { page = p[1]; continue; }
    const b = text.match(/^== (.+?)( \(shared|$)/);
    if (b) { block = b[1]; continue; }
    const i = text.match(/^ {2}(.+?): (.+?)(\s+\[fixable\])?\s+\[[^\]]+\]$/);
    if (i) out.push({ page, block, what: i[1], problem: i[2], fixable: !!i[3] });
  }
  return out;
}

// ---- mood ---------------------------------------------------------------------------------------

type Mood = "offline" | "noeditor" | "ready" | "checking" | "working" | "done" | "stopped";
const ANIM: Record<Mood, string> = {
  offline: "sleeping", noeditor: "waking", ready: "idle", checking: "searching", working: "working", done: "celebrate", stopped: "sad",
};
const LABEL: Record<Mood, string> = {
  offline: "Showit closed", noeditor: "Open your site", ready: "Ready", checking: "Checking", working: "Working", done: "Done", stopped: "Stopped",
};
/** Short line above the mascot, and the big two-tone sentence below it (black, then grey). */
const SAY: Record<Mood, [string, string, string]> = {
  offline: ["Waking up…", "Hi! Open Showit and", "I'll check your phone layout."],
  noeditor: ["Almost there…", "Log in and open your site", "in the Showit window."],
  ready: ["I'm ready to help…", "Hi! Let's make your site", "look great on phones."],
  checking: ["Checking…", "Reading your page", "the way a phone sees it."],
  working: ["Working…", "Making careful edits.", "Each one can be undone."],
  done: ["All done!", "Have a look in Preview,", "then publish when happy."],
  stopped: ["Stopped", "Nothing is lost:", "History can undo it all."],
};

function Live({ anim, className }: { anim: string; className?: string }) {
  const animation = ME.animations.find((a) => a.id === anim);
  const { frame } = useAvatarPlayer(ME, { animation, playing: true });
  return <AvatarSvg avatar={ME} face={frame.face} color={frame.color} blink={frame.blink} float={frame.float} className={className} />;
}

const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const runTitle = (r: Run) => (r.notes[0]?.startsWith("restore") ? "Undo" : r.notes[0]?.startsWith("rebuild") ? r.notes[0].replace(/^rebuild/, "Rebuilt") : "Mobile fixes");

// ---- app ----------------------------------------------------------------------------------------

type Screen = "home" | "fix" | "issues" | "history";
type Job = { title: string; edits: boolean; running: boolean; code?: number };
type Ask = { title: string; body: ReactNode; go: string; run: () => void; danger?: boolean };
type Target = "page" | "all" | "section";

export function App() {
  const [status, setStatus] = useState<Status>({ chrome: false, showit: false, title: "" });
  const [job, setJob] = useState<Job>();
  const [lines, setLines] = useState<Line[]>([]);
  const [issues, setIssues] = useState<Issue[] | null>(null); // null = no check yet
  const [runs, setRuns] = useState<Run[]>([]);
  const [ask, setAsk] = useState<Ask>();
  const [screen, setScreen] = useState<Screen>("home");
  const [target, setTarget] = useState<Target>("page");
  const [mode, setMode] = useState<Mode | undefined>(sai ? undefined : "panel");
  const { toast } = useToast();
  const nextId = useRef(0);
  const jobRef = useRef<Job>(undefined);
  jobRef.current = job;
  const island = useRef(false);
  island.current = mode === "island";

  useEffect(() => {
    sai?.mode().then(setMode);
    return sai?.onMode(setMode); // the tray menu can switch too
  }, []);
  const switchTo = (m: Mode) => sai?.mode(m).then(setMode);

  const refreshRuns = useCallback(() => sai?.runs().then(setRuns), []);
  useEffect(() => {
    if (!sai) return;
    const poll = () => sai.status().then(setStatus);
    poll();
    refreshRuns();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [refreshRuns]);

  useEffect(
    () =>
      sai?.onJob((e) => {
        if (e.type === "line") {
          if (!e.text.trim()) return;
          setLines((l) => [...l.slice(-800), { id: nextId.current++, text: e.text, tone: tone(e.text) }]);
          return;
        }
        setJob((j) => j && { ...j, running: false, code: e.code });
        refreshRuns();
        if (island.current) return; // the island shows the result itself
        const j = jobRef.current;
        if (e.code === 0) toast({ variant: "success", title: `${j?.title ?? "Job"} finished`, description: j?.edits ? "Preview in Showit before you publish." : undefined });
        else toast({ variant: "error", title: `${j?.title ?? "Job"} stopped`, description: "Anything it changed is in History and can be undone." });
      }),
    [refreshRuns, toast],
  );

  // The Issues screen follows the latest check.
  useEffect(() => {
    if (job && !job.running && job.title.startsWith("Check")) setIssues(parseIssues(lines));
  }, [job, lines]);

  const start = (script: Script, args: string[], title: string, edits = false) => {
    if (!sai || job?.running) return;
    setLines([]);
    setJob({ title, edits, running: true });
    sai.run(script, args).catch((err) => {
      setJob(undefined);
      toast({ variant: "error", title: "Couldn't start", description: String(err?.message ?? err) });
    });
  };
  const stop = () => sai?.stop().then(() => !island.current && toast({ variant: "info", title: "Stopping after the current step" }));

  const running = !!job?.running;
  const mood: Mood = running ? (job!.edits ? "working" : "checking")
    : job?.code !== undefined && job.code !== 0 ? "stopped"
    : job?.code === 0 ? "done"
    : !status.chrome ? "offline"
    : !status.showit ? "noeditor"
    : "ready";
  const last = [...lines].reverse().find((l) => /\S/.test(l.text))?.text.trim();
  const fixedToday = runs.filter((r) => sameDay(r.at) && runTitle(r) !== "Undo").reduce((n, r) => n + r.n, 0);
  const ctx: Ctx = { status, job, lines, issues, runs, mood, last, running, fixedToday, start, stop, confirm: setAsk, go: setScreen, target, setTarget };

  if (!mode) return null;
  if (mode === "island") return <IslandView {...ctx} onPanel={() => switchTo("panel")} />;

  return (
    <>
      <ResizeHandles />
      <div className="relative flex h-full flex-col overflow-hidden rounded-[30px] border border-black/5 bg-background shadow-xl">
        <TopBar status={status} screen={screen} go={setScreen} onIsland={() => switchTo("island")} />
        <main key={screen} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3">
          {screen === "home" && <Home {...ctx} />}
          {screen === "fix" && <Fix {...ctx} />}
          {screen === "issues" && <IssuesScreen {...ctx} />}
          {screen === "history" && <HistoryScreen {...ctx} />}
        </main>
        {/* Home and Fix show the running job themselves; elsewhere a slim bar keeps it visible and stoppable. */}
        {running && (screen === "issues" || screen === "history") && (
          <div className="mx-4 mb-2 flex items-center gap-3 rounded-full bg-ink py-1.5 pl-2 pr-1.5 text-white shadow-lg">
            <Live anim={ANIM[mood]} className="size-7 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
              {job?.title}
              <span className="text-white/55"> · {last?.replace(/^- /, "") ?? "starting…"}</span>
            </span>
            <button type="button" onClick={stop} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-xs font-semibold">
              <I name="stop" className="size-3.5" />
              Stop
            </button>
          </div>
        )}
        <BottomNav screen={screen} go={setScreen} issues={issues?.length ?? 0} />
      </div>

      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ask?.title}</DialogTitle>
            <DialogDescription>{ask?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setAsk(undefined)}>Cancel</Button>
            <Button
              variant={ask?.danger ? "destructive" : "default"}
              className={cn("rounded-full", !ask?.danger && "bg-ink text-white hover:bg-ink/85")}
              onClick={() => { ask?.run(); setAsk(undefined); }}
            >
              {ask?.go}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Ctx = {
  status: Status; job?: Job; lines: Line[]; issues: Issue[] | null; runs: Run[]; mood: Mood; last?: string; running: boolean; fixedToday: number;
  start: (script: Script, args: string[], title: string, edits?: boolean) => void; stop: () => void; confirm: (a: Ask) => void; go: (s: Screen) => void;
  target: Target; setTarget: (t: Target) => void;
};

// ---- building blocks ----------------------------------------------------------------------------

type TileTone = "blue" | "gold" | "violet" | "mint";
// Written out in full so Tailwind generates them (it can't see class names built at runtime).
const TILE: Record<TileTone, string> = { blue: "tile-blue", gold: "tile-gold", violet: "tile-violet", mint: "tile-mint" };
/** Glossy 3D tile with a white filled icon. */
function Tile({ icon, tone = "blue", className, iconSize = "50%" }: { icon: string; tone?: TileTone; className?: string; iconSize?: string }) {
  return (
    <span aria-hidden className={cn("tile size-11 shrink-0", TILE[tone], className)}>
      <Icon name={icon} variant="solid" size={iconSize} className="text-white drop-shadow-[0_3px_6px_rgb(30_20_90/.3)]" />
    </span>
  );
}

/** Round white icon button (header actions). */
function Round({ icon, title, onClick, className }: { icon: string; title: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={cn("no-drag grid size-10 place-items-center rounded-full bg-card shadow-sm transition-transform hover:scale-105 active:scale-95", className)}>
      <I name={icon} className="size-[18px]" />
    </button>
  );
}

/** "View all →": underline sweeps in and the arrow nudges on hover (demo-website's Hyperlink). */
function MoreLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="hyperlink rounded-sm text-[13px] font-semibold text-brand outline-none" style={{ "--hl": "var(--brand)" } as CSSProperties}>
      {children}
      <span className="hyperlink-arrow ml-0.5 align-[-0.12em]">
        <Icon name="arrow-up-right" className="size-[1em]" />
      </span>
    </button>
  );
}

/** Black segmented tabs with a sliding selection (animated). */
function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div role="tablist" className="flex rounded-full bg-card p-1 shadow-sm">
        {options.map(([v, label]) => (
          <button key={v} role="tab" type="button" aria-selected={value === v} onClick={() => onChange(v)} className="relative flex-1 rounded-full px-2 py-2 text-[13px] font-medium">
            {value === v && <motion.span layoutId="seg" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className={cn("relative transition-colors", value === v ? "text-white" : "text-muted-foreground")}>{label}</span>
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}

const Muted = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cn("text-[13px] text-muted-foreground", className)}>{children}</p>;

/** Row: grey round icon, title, subtitle, optional trailing. */
function Row({ icon, title, sub, onClick, trailing, disabled }: { icon: string; title: string; sub: string; onClick?: () => void; trailing?: ReactNode; disabled?: boolean }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn("surface flex w-full items-center gap-3.5 px-4 py-3.5 text-left", onClick && "transition-transform hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-50")}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-ink/80">
        <I name={icon} className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      {trailing}
    </Tag>
  );
}

// ---- screens ------------------------------------------------------------------------------------

function Home({ status, job, lines, issues, runs, mood, running, fixedToday, start, stop, confirm, go, setTarget }: Ctx) {
  const ready = status.showit && !running;
  const fixPage = () =>
    confirm({ title: "Fix this page?", body: "Edits the mobile layout of the page open in Showit. Desktop isn't touched, and you can undo it from History.", go: "Fix this page", run: () => start("fix.js", ["--apply"], "Fix this page", true) });
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[27px] text-ink">
          Mobile-ready
          <br />
          every page
        </h1>
        <Live anim={ANIM[mood]} className="size-20 shrink-0 drop-shadow-[0_10px_18px_rgb(90_100_235/.35)]" />
      </div>

      {!status.showit ? (
        <Row icon="external-link" title={status.chrome ? "Bring up Showit" : "Open Showit"} sub="Log in and open your site in its window" onClick={() => sai?.openShowit()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 pt-3">
          <Feature tone="blue" icon="scan" title={running && !job?.edits ? "Checking…" : "Check page"} sub="Find mobile issues" onClick={() => ready && start("audit.js", [], "Check this page")} disabled={!ready} />
          <Feature tone="gold" icon="magic-wand" title={running && job?.edits ? "Fixing…" : "Fix page"} sub="Safe, undoable fixes" onClick={() => ready && fixPage()} disabled={!ready} />
        </div>
      )}

      {job && (
        <section className="surface p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="truncate text-[15px] font-semibold text-ink">{job.title}</p>
            {running ? (
              <button type="button" onClick={stop} className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-xs font-semibold text-white">
                <I name="stop" className="size-3.5" /> Stop
              </button>
            ) : (
              <MoreLink onClick={() => go("fix")}>Full log</MoreLink>
            )}
          </div>
          <Log lines={lines} compact />
        </section>
      )}

      <div className="space-y-2.5">
        <Row icon="layers" title="Check all pages" sub="Every page and blog template" onClick={() => start("audit.js", ["--all"], "Check all pages")} disabled={!ready} />
        <Row icon="eye" title="Preview fixes" sub="Cursor tour in Showit, no edits" onClick={() => start("fix.js", [], "Preview fixes")} disabled={!ready} />
        <Row icon="layout" title="Rebuild a section" sub="Lay it out from the desktop design" onClick={() => { setTarget("section"); go("fix"); }} />
        <Row
          icon="alert-circle"
          title="Issues"
          sub={issues ? `${issues.length} found · ${issues.filter((i) => i.fixable).length} fixable` : "Run a check to see them"}
          onClick={() => go("issues")}
        />
      </div>

      <section>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-[17px] text-ink">Recent changes</h2>
          <MoreLink onClick={() => go("history")}>View all</MoreLink>
        </div>
        {runs.length ? (
          <div className="space-y-2.5">
            {runs.slice(0, 2).map((r) => (
              <Row key={r.run} icon={runTitle(r) === "Undo" ? "undo" : "check-circle"} title={runTitle(r)} sub={`${r.n} change${r.n === 1 ? "" : "s"} · ${r.pages.join(", ")}`} />
            ))}
          </div>
        ) : (
          <Muted>{fixedToday ? `${fixedToday} fixed today.` : "Your fixes and undos will show up here."}</Muted>
        )}
      </section>
    </div>
  );
}

/** Feature card with a glossy tile sitting over its top edge. */
function Feature({ tone, icon, title, sub, onClick, disabled }: { tone: TileTone; icon: string; title: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="surface relative px-4 pb-4 pt-12 text-left transition-transform hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60">
      <Tile icon={icon} tone={tone} className="absolute -top-4 left-4 size-14 -rotate-6 rounded-[18px]" />
      <span className="block text-[15px] font-semibold text-ink">{title}</span>
      <span className="block text-xs text-muted-foreground">{sub}</span>
    </button>
  );
}

function Fix({ status, job, lines, mood, running, start, stop, confirm, target, setTarget }: Ctx) {
  const [sections, setSections] = useState<{ page: string; list: string[] } | "loading" | null>(null);
  const [section, setSection] = useState("");
  const { toast } = useToast();
  const [hi, ink, grey] = SAY[mood];

  useEffect(() => {
    if (target !== "section" || !status.showit || sections) return;
    setSections("loading");
    sai?.sections().then(
      (r) => { setSections({ page: r.page, list: r.sections }); setSection(r.sections[0] ?? ""); },
      (err) => { setSections(null); setTarget("page"); toast({ variant: "error", title: "Couldn't read sections", description: String(err?.message ?? err).slice(0, 200) }); },
    );
  }, [target, status.showit, sections, setTarget, toast]);

  const preview = () => {
    if (target === "section") return section && start("rebuild.js", [section], `Plan for ${section}`);
    start("fix.js", target === "all" ? ["--all"] : [], target === "all" ? "Preview all pages" : "Preview fixes");
  };
  const apply = () => {
    if (target === "section") {
      if (!section) return;
      return confirm({
        title: `Rebuild "${section}"?`,
        body: "Lays this section out for phones from its desktop layout: one column, reading order. Desktop isn't touched. Undo from History.",
        go: "Rebuild",
        run: () => start("rebuild.js", [section, "--apply"], `Rebuild ${section}`, true),
      });
    }
    const all = target === "all";
    confirm({
      title: all ? "Fix every page?" : "Fix this page?",
      body: `Edits the mobile layout ${all ? "of every page (takes a while; leave the Showit window alone)" : "of the page open in Showit"}. Desktop isn't touched. Undo from History.`,
      go: all ? "Fix all pages" : "Fix this page",
      run: () => start("fix.js", all ? ["--all", "--apply"] : ["--apply"], all ? "Fix all pages" : "Fix this page", true),
    });
  };

  return (
    <div className="flex min-h-full flex-col">
      <p className="text-center text-[13px] font-medium text-brand">{hi}</p>
      <div className="mx-auto mt-2 drop-shadow-[0_24px_30px_rgb(90_100_235/.35)]">
        <Live anim={ANIM[mood]} className="size-40" />
      </div>
      <p className="mt-3 text-center text-[19px] font-semibold leading-snug text-ink">
        {running && job ? job.title : ink} <span className="text-muted-foreground">{running && job ? "in progress…" : grey}</span>
      </p>

      {status.showit ? (
        <div className="mt-5 space-y-3">
          <Segmented<Target> value={target} onChange={setTarget} options={[["page", "This page"], ["all", "All pages"], ["section", "A section"]]} />
          {target === "section" && (
            <div className="surface p-3">
              {sections === "loading" ? (
                <Muted className="text-xs">Reading sections…</Muted>
              ) : sections ? (
                <>
                  <Muted className="mb-2 text-xs">Sections on {sections.page}</Muted>
                  <div className="flex flex-wrap gap-1.5">
                    {sections.list.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSection(s)}
                        className={cn("rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors", section === s ? "bg-brand text-white" : "bg-muted text-ink hover:bg-secondary")}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5">
          <Row icon="external-link" title={status.chrome ? "Bring up Showit" : "Open Showit"} sub="Log in and open your site in its window" onClick={() => sai?.openShowit()} />
        </div>
      )}

      {job && (
        <section className="surface mt-4 p-4">
          <p className="mb-2 truncate text-[15px] font-semibold text-ink">{job.title}</p>
          <Log lines={lines} />
        </section>
      )}

      {status.showit && (
        <div className="mt-auto flex items-end justify-between px-2 pt-6">
          <SmallAction icon="eye" label={target === "section" ? "Plan" : "Preview"} onClick={preview} disabled={running} />
          <BigAction running={running} onClick={running ? stop : apply} label={running ? "Stop" : target === "section" ? "Rebuild" : "Fix"} />
          <SmallAction icon="scan" label="Check" onClick={() => start("audit.js", target === "all" ? ["--all"] : [], target === "all" ? "Check all pages" : "Check this page")} disabled={running} />
        </div>
      )}
    </div>
  );
}

function SmallAction({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="grid justify-items-center gap-1 text-[11px] font-medium text-muted-foreground disabled:opacity-40">
      <span className="grid size-12 place-items-center rounded-full bg-card text-ink shadow-sm">
        <I name={icon} className="size-5" />
      </span>
      {label}
    </button>
  );
}

/** The big round button with a pulsing halo (start / stop). */
function BigAction({ running, onClick, label }: { running: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="grid justify-items-center gap-1.5 text-xs font-semibold text-ink">
      <span className="relative grid size-24 place-items-center">
        <span className="absolute inset-0 rounded-full bg-card shadow-[0_10px_30px_-10px_rgb(90_100_235/.5)]" />
        <span className={cn("absolute inset-3 rounded-full", running ? "bg-destructive/40" : "bg-brand/35")} style={{ animation: "sai-halo 1.8s ease-out infinite" }} />
        <span className={cn("tile relative size-16 rounded-full", running ? "bg-destructive" : "tile-blue")}>
          <Icon name={running ? "stop" : "magic-wand"} variant="solid" size="42%" className="text-white" />
        </span>
      </span>
      {label}
    </button>
  );
}

function IssuesScreen({ issues, status, running, start }: Ctx) {
  const [show, setShow] = useState<"all" | "fix" | "manual">("all");
  const list = (issues ?? []).filter((i) => show === "all" || (show === "fix") === i.fixable);
  const pages = [...new Set((issues ?? []).map((i) => i.page))];
  return (
    <div className="space-y-4">
      <Segmented value={show} onChange={setShow} options={[["all", "All"], ["fix", "Fixable"], ["manual", "Manual"]]} />
      <Banner
        eyebrow={issues ? (pages.length === 1 ? pages[0] : `${pages.length} pages`) : "No check yet"}
        title={issues ? `${issues.length} issue${issues.length === 1 ? "" : "s"} found` : "Run a check"}
        sub={issues ? `${issues.filter((i) => i.fixable).length} the app can fix` : "Find mobile problems on this page"}
        pill={issues ? (issues.length ? "To review" : "All clear") : "Ready"}
        icon={issues?.length ? "alert-circle" : "check-circle"}
      />
      {issues && (
        <section className="surface p-4">
          <p className="text-xs text-muted-foreground">{show === "all" ? "Everything found" : show === "fix" ? "The app can fix these" : "These need a person in Showit"}</p>
          <p className="text-[15px] font-semibold text-ink">{list.length ? `${list.length} item${list.length === 1 ? "" : "s"}` : "Nothing here"}</p>
          <Path items={list.map((i) => ({ icon: i.fixable ? "magic-wand" : "alert-circle", tone: i.fixable ? "blue" : "gold", title: i.what.replace(/^text /, ""), sub: i.problem.split(";")[0] }))} />
        </section>
      )}
      {status.showit && !running && (
        <button type="button" onClick={() => start("audit.js", [], "Check this page")} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-medium text-white transition-transform active:scale-[0.98]">
          <I name="scan" /> Check again
        </button>
      )}
    </div>
  );
}

/** Blue gradient banner with a white pill (the "Unit 1 / Locked" card). */
function Banner({ eyebrow, title, sub, pill, icon }: { eyebrow: string; title: string; sub: string; pill: string; icon: string }) {
  return (
    <section className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#a7b1ff] via-[#8390fa] to-[#6672f2] p-4 text-white shadow-[0_14px_30px_-14px_rgb(90_100_235/.7)]">
      <span aria-hidden className="absolute -right-6 -top-8 size-32 rounded-full bg-white/15 blur-sm" />
      <span aria-hidden className="absolute -bottom-10 right-16 size-28 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-2">
        <span className="rounded-full bg-white/25 px-3 py-1 text-[11px] font-medium backdrop-blur">{eyebrow}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-ink">
          <I name={icon} className="size-3.5 text-brand" /> {pill}
        </span>
      </div>
      <p className="relative mt-7 text-lg font-semibold">{title}</p>
      <p className="relative text-xs text-white/80">{sub}</p>
    </section>
  );
}

/** Zig-zag path of 3D tiles linked by dots (the learning-path list). */
function Path({ items }: { items: { icon: string; tone: TileTone; title: string; sub: string; action?: ReactNode }[] }) {
  return (
    <ol className="mt-3">
      {items.map((it, k) => (
        <li key={k}>
          {k > 0 && (
            <span aria-hidden className={cn("my-1 flex gap-1.5", k % 2 ? "justify-center pl-6" : "justify-center pr-6")}>
              {[0, 1, 2].map((d) => <span key={d} className="size-1.5 rounded-full bg-[#c9ceff]" />)}
            </span>
          )}
          <div className={cn("flex items-center gap-3", k % 2 && "flex-row-reverse text-right")}>
            <Tile icon={it.icon} tone={it.tone} className="size-12 rounded-[16px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{it.title}</p>
              <p className="line-clamp-2 text-[11px] text-muted-foreground">{it.sub}</p>
            </div>
            {it.action}
          </div>
        </li>
      ))}
    </ol>
  );
}

function HistoryScreen({ runs, status, running, start, confirm, fixedToday }: Ctx) {
  const [show, setShow] = useState<"all" | "fixes" | "undos">("all");
  const list = runs.filter((r) => show === "all" || (show === "undos") === (runTitle(r) === "Undo"));
  return (
    <div className="space-y-4">
      <Segmented value={show} onChange={setShow} options={[["all", "All"], ["fixes", "Fixes"], ["undos", "Undos"]]} />
      <Banner eyebrow="Today" title={`${fixedToday} change${fixedToday === 1 ? "" : "s"} made`} sub="Every run can be undone in one click" pill={`${runs.length} runs`} icon="history" />
      <section className="surface p-4">
        <p className="text-xs text-muted-foreground">Undo puts a run back; hand edits since are left alone</p>
        <p className="text-[15px] font-semibold text-ink">{list.length ? "Your changes" : "Nothing here yet"}</p>
        <Path
          items={list.map((r) => ({
            icon: runTitle(r) === "Undo" ? "undo" : r.notes[0]?.startsWith("rebuild") ? "layout" : "magic-wand",
            tone: runTitle(r) === "Undo" ? "violet" : r.notes[0]?.startsWith("rebuild") ? "gold" : "blue",
            title: runTitle(r),
            sub: `${r.n} change${r.n === 1 ? "" : "s"} · ${r.pages.join(", ")} · ${new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
            action: (
              <button
                type="button"
                disabled={!status.showit || running}
                title="Undo this run"
                onClick={() =>
                  confirm({
                    title: "Undo this run?",
                    body: `Puts back ${r.n} change(s) on ${r.pages.join(", ")}. Anything edited by hand since is left alone.`,
                    go: "Undo",
                    danger: true,
                    run: () => start("restore.js", [r.run], "Undo", true),
                  })
                }
                className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-ink transition-colors hover:bg-secondary disabled:opacity-40"
              >
                <I name="undo" className="size-3.5" />
              </button>
            ),
          }))}
        />
      </section>
    </div>
  );
}

const LINE_TONE: Record<Tone, string> = {
  page: "mt-1.5 font-semibold text-ink",
  block: "text-ink/80",
  step: "text-ink",
  ok: "text-emerald-600",
  warn: "text-amber-600",
  error: "font-semibold text-destructive",
  done: "mt-1 font-semibold text-emerald-600",
  muted: "text-muted-foreground",
};

function Log({ lines, compact }: { lines: Line[]; compact?: boolean }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [lines.length]);
  const shown = compact ? lines.slice(-4) : lines;
  if (!shown.length) return <Muted>Starting…</Muted>;
  return (
    <ul className={cn("overflow-y-auto rounded-2xl bg-muted p-3 font-mono text-[11px] leading-relaxed", compact ? "max-h-28" : "max-h-64")}>
      {shown.map((l) => (
        <li key={l.id} className={cn("whitespace-pre-wrap break-words", LINE_TONE[l.tone])}>
          {l.tone === "ok" ? "✓ ok" : l.text.replace(/^#### /, "")}
        </li>
      ))}
      <li ref={end} />
    </ul>
  );
}

/** Top bar: avatar (or back) on the left; status pill and round buttons on the right. */
function TopBar({ status, screen, go, onIsland }: { status: Status; screen: Screen; go: (s: Screen) => void; onIsland: () => void }) {
  return (
    <header className="drag flex shrink-0 items-center gap-2 px-5 pb-1 pt-4">
      {screen === "home" ? (
        <span className="grid size-10 place-items-center rounded-full bg-card shadow-sm">
          <AvatarSvg avatar={ME} className="size-8" />
        </span>
      ) : (
        <Round icon="chevron-left" title="Back" onClick={() => go("home")} />
      )}
      <p className="min-w-0 flex-1 truncate pl-1 text-[17px] font-semibold text-ink">
        {screen === "home" ? "" : screen === "fix" ? "" : screen === "issues" ? "Issues" : "History"}
      </p>
      <span className="no-drag inline-flex h-10 items-center gap-1.5 rounded-full bg-card px-3.5 text-[13px] font-medium shadow-sm">
        <span className={cn("size-2 rounded-full", status.showit ? "bg-emerald-500" : status.chrome ? "bg-amber-400" : "bg-stone-300")} />
        {status.showit ? "Showit" : status.chrome ? "Open site" : "Offline"}
      </span>
      <Round icon="shrink" title="Island mode" onClick={onIsland} />
      <Round icon="minus" title="Minimize" onClick={() => sai?.window("minimize")} />
    </header>
  );
}

/** Bottom tabs: filled black icon for the active one, outlined grey for the rest; the highlight slides. */
function BottomNav({ screen, go, issues }: { screen: Screen; go: (s: Screen) => void; issues: number }) {
  const items: [Screen, string, string][] = [
    ["home", "Home", "home"],
    ["fix", "Fix", "magic-wand"],
    ["issues", "Issues", "alert-circle"],
    ["history", "History", "history"],
  ];
  return (
    <LayoutGroup id="bottom-nav">
      <nav className="grid shrink-0 grid-cols-4 gap-1 border-t border-border bg-card px-3 pb-3 pt-2">
        {items.map(([id, label, icon]) => {
          const on = screen === id;
          return (
            <button key={id} type="button" onClick={() => go(id)} className="relative grid justify-items-center gap-0.5 rounded-2xl py-1.5 text-[11px] font-medium">
              {on && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-2xl bg-muted" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
              <span className={cn("relative transition-colors", on ? "text-ink" : "text-muted-foreground")}>
                <I name={icon} line={!on} className="size-5" />
              </span>
              <span className={cn("relative transition-colors", on ? "font-semibold text-ink" : "text-muted-foreground")}>{label}</span>
              {id === "issues" && issues > 0 && (
                <span className="absolute right-[20%] top-0.5 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[9px] font-bold text-white">{issues}</span>
              )}
            </button>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}

// ---- island -------------------------------------------------------------------------------------

/** Equalizer bars: bounce while a job runs. */
function Bars({ live }: { live: boolean }) {
  return (
    <span aria-hidden className="flex h-3.5 items-end gap-[3px]">
      {[0.9, 0.55, 1, 0.7].map((h, i) => (
        <span
          key={i}
          className="w-[3px] origin-bottom rounded-full"
          style={{ background: ME.color, height: `${h * 100}%`, animation: live ? `sai-eq ${0.7 + i * 0.13}s ease-in-out ${i * -0.21}s infinite` : undefined, transform: live ? undefined : "scaleY(.35)" }}
        />
      ))}
    </span>
  );
}

/** The pill at the top of the screen: idle when nothing runs, compact while working, alert on a stop, expanded on click. */
function IslandView({ status, job, mood, last, running, start, stop, onPanel }: Ctx & { onPanel: () => void }) {
  const [open, setOpen] = useState(false);
  const pill = useRef<HTMLDivElement>(null);

  // Clicks pass through the window except over the pill (hit-test every forwarded move; steadier than enter/leave).
  useEffect(() => {
    if (!sai) return;
    let over = false;
    const move = (e: MouseEvent) => {
      const hit = !!pill.current?.contains(e.target as Node);
      if (hit !== over) sai.clickThrough(!(over = hit));
    };
    window.addEventListener("mousemove", move);
    return () => {
      window.removeEventListener("mousemove", move);
      sai.clickThrough(true);
    };
  }, []);

  // Drag the pill to move the island; a drag doesn't count as a click.
  useEffect(() => {
    const el = pill.current;
    if (!el || !sai) return;
    let from: { x: number; y: number } | null = null;
    let dragging = false;
    let swallow = false;
    const down = (e: globalThis.PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest("button:not([role])")) return;
      from = { x: e.screenX, y: e.screenY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: globalThis.PointerEvent) => {
      if (!from || dragging || Math.hypot(e.screenX - from.x, e.screenY - from.y) < 4) return;
      dragging = true;
      sai.drag(true);
    };
    const up = () => {
      if (dragging) { sai.drag(false); swallow = true; }
      from = null;
      dragging = false;
    };
    const click = (e: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("lostpointercapture", up);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("lostpointercapture", up);
      el.removeEventListener("click", click, true);
      sai.drag(false);
    };
  }, []);

  const state: DynamicIslandState = open ? "expanded" : mood === "stopped" ? "alert" : running || mood === "done" ? "compact" : "idle";
  const btn = "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors";

  return (
    <div className="flex h-full justify-center">
      <DynamicIsland
        ref={pill}
        variant="midnight"
        className="items-start"
        state={state}
        onStateChange={(s) => setOpen(s === "expanded")}
        label="Showit AI status"
        leading={<Live anim={ANIM[mood]} className={state === "idle" ? "size-6" : "size-8"} />}
        title={<span className="text-[13px]">{state === "idle" ? "Showit AI" : running ? job?.title : LABEL[mood]}</span>}
        trailing={state === "idle" ? null : mood === "done" ? <I name="check-circle" className="text-emerald-400" /> : <Bars live={running} />}
        expandedContent={
          <>
            <div className="flex items-center gap-3">
              <Live anim={ANIM[mood]} className="size-14 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">{running ? job?.title : LABEL[mood]}</p>
                <p className="truncate text-xs text-white/60">{last?.replace(/^- /, "") ?? (status.showit ? "Connected to Showit" : "Showit isn't open")}</p>
              </div>
              <Bars live={running} />
            </div>
            <div className="flex items-center gap-2">
              {running ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); stop(); }} className={cn(btn, "bg-destructive text-white")}>
                  <I name="stop" className="size-3.5" /> Stop
                </button>
              ) : status.showit ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); start("audit.js", [], "Check this page"); }} className={cn(btn, "bg-white text-black")}>
                  <I name="scan" className="size-3.5" /> Check page
                </button>
              ) : (
                <button type="button" onClick={(e) => { e.stopPropagation(); sai?.openShowit(); }} className={cn(btn, "bg-white text-black")}>
                  <I name="external-link" className="size-3.5" /> Open Showit
                </button>
              )}
              <span className="flex-1" />
              <button type="button" onClick={(e) => { e.stopPropagation(); onPanel(); }} className={cn(btn, "bg-white/10 hover:bg-white/20")}>
                <I name="expand" className="size-3.5" /> Open panel
              </button>
            </div>
          </>
        }
      />
    </div>
  );
}

// Transparent frameless windows have no native resize edges on Windows; these strips stand in (from Orbit).
const EDGES = {
  n: "inset-x-4 top-0 h-1.5 cursor-ns-resize",
  s: "inset-x-4 bottom-0 h-1.5 cursor-ns-resize",
  e: "inset-y-4 right-0 w-1.5 cursor-ew-resize",
  w: "inset-y-4 left-0 w-1.5 cursor-ew-resize",
  nw: "left-0 top-0 size-4 cursor-nwse-resize",
  ne: "right-0 top-0 size-4 cursor-nesw-resize",
  sw: "bottom-0 left-0 size-4 cursor-nesw-resize",
  se: "bottom-0 right-0 size-4 cursor-nwse-resize",
};

function ResizeHandles() {
  if (!sai) return null;
  const grab = (dir: string) => (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    sai.resize(dir);
  };
  const release = () => sai.resize(null);
  return (
    <>
      {Object.entries(EDGES).map(([dir, cls]) => (
        <div key={dir} aria-hidden onPointerDown={grab(dir)} onPointerUp={release} onLostPointerCapture={release} className={`no-drag fixed z-50 bg-black/[0.01] ${cls}`} />
      ))}
    </>
  );
}
