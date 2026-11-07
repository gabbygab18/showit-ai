// Visible "AI cursor" overlay for the Showit editor. Playwright's own mouse is invisible,
// so this draws a macOS-style pointer with a live avatar companion: it breathes and blinks,
// trails the pointer leaning and looking where it goes, hops on clicks, and talks in a bubble.
// Avatar: avatar.svg (exported from avatar-app). Missing file = text tag instead.
const fs = require('fs');
const path = require('path');

const LABEL = 'Showit AI'; // shown only when there's no avatar.svg
const ACCENT = '#0a84ff';  // macOS blue, used for the click ripple
const HUE = 221;           // shifts the orange avatar to the app's periwinkle (0 = original colors)
const VERSION = '6';       // bump when the look changes so open pages swap the old overlay

// A custom avatar in the data folder wins over the bundled one.
const avatarFile = [process.env.SHOWIT_AI_DATA, __dirname].filter(Boolean)
  .map(d => path.join(d, 'avatar.svg')).find(f => fs.existsSync(f)) || '';
// Inlined (not an <img>) so its eyes can be animated on their own.
const AVATAR = avatarFile ? fs.readFileSync(avatarFile, 'utf8').replace(/<\?xml[^>]*>\s*/, '') : null;

async function install(page) {
  await page.evaluate(({ LABEL, ACCENT, VERSION, AVATAR, HUE }) => {
    const old = document.getElementById('ai-cursor');
    if (old?.dataset.v === VERSION) return;
    old?.remove();
    document.getElementById('ai-buddy')?.remove();
    document.getElementById('ai-cursor-css')?.remove();
    const css = document.createElement('style');
    css.id = 'ai-cursor-css';
    css.textContent = `
      #ai-cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;
        transform:translate(50vw,50vh);transition:transform .6s cubic-bezier(.22,.8,.3,1)}
      #ai-cursor .arrow{position:absolute;left:-3px;top:-2px;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45))}
      #ai-cursor .tag{position:absolute;left:18px;top:20px;background:rgba(30,30,30,.85);color:#fff;
        font:600 12px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;padding:5px 9px;border-radius:999px;white-space:nowrap}
      #ai-cursor .say{position:absolute;left:40px;top:20px;width:max-content;max-width:260px;
        background:rgba(246,246,246,.86);backdrop-filter:blur(18px) saturate(1.6);-webkit-backdrop-filter:blur(18px) saturate(1.6);
        color:#1d1d1f;font:13px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;
        padding:8px 12px;border-radius:12px;border:.5px solid rgba(0,0,0,.12);box-shadow:0 6px 20px rgba(0,0,0,.18);
        opacity:0;transform:translateY(-2px);transition:opacity .2s,transform .2s}
      #ai-cursor .say.on{opacity:1;transform:none}
      #ai-cursor.flip .say{left:auto;right:10px}

      /* The buddy is its own layer with a slower glide, so it trails the pointer and catches up. */
      #ai-buddy{position:fixed;left:13px;top:17px;z-index:2147483647;pointer-events:none;width:22px;height:22px;
        transform:translate(50vw,50vh);transition:transform .95s cubic-bezier(.3,.7,.25,1);
        filter:hue-rotate(${HUE}deg) drop-shadow(0 2px 3px rgba(0,0,0,.3))}
      #ai-buddy .body{width:100%;height:100%;transform-origin:50% 90%;rotate:var(--tilt,0deg);
        transition:rotate .35s ease-out;animation:ai-breathe 2.4s ease-in-out infinite}
      #ai-buddy svg{display:block;width:100%;height:100%;overflow:visible}
      #ai-buddy .ai-eye{transform-box:fill-box;transform-origin:center;transition:translate .3s ease-out;
        translate:var(--look,0) 0;animation:ai-blink 3.8s infinite}
      #ai-buddy.moving .body{animation:ai-scoot .32s ease-in-out infinite}
      #ai-buddy.hop .body{animation:ai-hop .45s ease-out}
      @keyframes ai-breathe{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-2px) scale(.96,1.05)}}
      @keyframes ai-scoot{0%,100%{transform:translateY(0) scale(1.04,.96)}50%{transform:translateY(-3px) scale(.95,1.06)}}
      @keyframes ai-hop{35%{transform:translateY(-9px) scale(.9,1.12)}70%{transform:translateY(0) scale(1.12,.88)}}
      @keyframes ai-blink{0%,93%,100%{scale:1 1}96%{scale:1 .08}}

      .ai-ripple{position:fixed;z-index:2147483646;pointer-events:none;width:16px;height:16px;margin:-8px 0 0 -8px;
        border-radius:50%;background:${ACCENT}33;border:1.5px solid ${ACCENT};animation:ai-ripple .45s ease-out forwards}
      @keyframes ai-ripple{to{transform:scale(2.6);opacity:0}}`;
    const c = document.createElement('div');
    c.id = 'ai-cursor';
    c.dataset.v = VERSION;
    // macOS arrow: black fill, white outline; the tip (3,2) sits exactly on the target point.
    c.innerHTML = `<svg class="arrow" width="22" height="28" viewBox="0 0 22 28"><path
        d="M3 2v19.5l4.6-4.4 3.3 7.7 3.3-1.4-3.2-7.5h6.3z"
        fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
      ${AVATAR ? '' : `<div class="tag">${LABEL}</div>`}
      <div class="say"></div>`;
    document.head.append(css);
    document.body.append(c);
    if (AVATAR) {
      const b = document.createElement('div');
      b.id = 'ai-buddy';
      b.innerHTML = `<div class="body">${AVATAR}</div>`;
      // avatar-app draws eyes as <rect>s (the body is paths/ellipses): those blink and look around.
      b.querySelectorAll('svg rect').forEach(r => { if (!r.closest('defs, clipPath, pattern, mask')) r.classList.add('ai-eye'); });
      document.body.append(b);
    }
  }, { LABEL, ACCENT, VERSION, AVATAR, HUE });
}

// Glide the pointer + real (invisible) mouse to the centre of a locator (or to an {x, y} point);
// the buddy follows, leaning and looking toward where it's going.
async function moveTo(page, target) {
  await install(page); // editor can re-render the body; cheap to re-check
  let x, y;
  if ('x' in target) ({ x, y } = target);
  else {
    await target.scrollIntoViewIfNeeded();
    const b = await target.boundingBox();
    if (!b) throw new Error('Target not visible');
    x = b.x + b.width / 2; y = b.y + b.height / 2;
  }
  await page.evaluate(([x, y]) => {
    const c = document.getElementById('ai-cursor');
    const from = new DOMMatrix(getComputedStyle(c).transform);
    const dx = x - from.m41;
    c.style.transform = `translate(${x}px,${y}px)`;
    c.classList.toggle('flip', x > innerWidth - 320); // keep the bubble on screen near the right edge
    const bud = document.getElementById('ai-buddy');
    if (!bud) return;
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    bud.style.transform = `translate(${x}px,${y}px)`;
    bud.style.setProperty('--tilt', `${clamp(dx / 25, 14)}deg`);
    bud.style.setProperty('--look', `${clamp(dx / 12, 9)}px`); // svg units: a few screen px at 22px
    bud.classList.add('moving');
    clearTimeout(bud._settle);
    bud._settle = setTimeout(() => {
      bud.classList.remove('moving');
      bud.style.setProperty('--tilt', '0deg');
      bud.style.setProperty('--look', '0px');
    }, 900);
  }, [x, y]);
  // Optional trace of where the cursor goes (used to make demo videos follow the action).
  if (process.env.SHOWIT_AI_TRACE) fs.appendFileSync(process.env.SHOWIT_AI_TRACE, JSON.stringify({ t: Date.now(), x, y }) + '\n');
  await page.mouse.move(x, y, { steps: 15 });
  await page.waitForTimeout(650); // let the glide finish before acting
  return { x, y };
}

async function click(page, target) {
  const { x, y } = await moveTo(page, target);
  await page.evaluate(([x, y]) => {
    const r = document.createElement('div');
    r.className = 'ai-ripple';
    r.style.left = x + 'px'; r.style.top = y + 'px';
    document.body.append(r);
    setTimeout(() => r.remove(), 500);
    const bud = document.getElementById('ai-buddy');
    if (bud) { bud.classList.remove('hop'); void bud.offsetWidth; bud.classList.add('hop'); setTimeout(() => bud.classList.remove('hop'), 460); }
  }, [x, y]);
  await page.mouse.click(x, y);
}

async function say(page, text) {
  await install(page);
  await page.evaluate(t => {
    const s = document.querySelector('#ai-cursor .say');
    s.textContent = t; s.classList.toggle('on', !!t);
  }, text || '');
}

module.exports = { install, moveTo, click, say };
