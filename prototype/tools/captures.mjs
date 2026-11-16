/**
* Screen captures and animations — `node tools/captures.mjs [--only name,…] [--langs en,fr,…]`
*
* Drives Chrome in headless mode to photograph the game in specific states.
* Each capture is REPRODUCIBLE: it starts from a fabricated save and a chosen
* level, never from a manually played session. Rerunning the tool after an
* interface change regenerates the images, which a hand-placed image folder
* cannot do.
*
* Writes, under media/ at the repository root:
*   - `<scene>.png`            README screenshots (English)
*   - `gameplay.gif`, `rails.gif`, `worlds.gif`   README animations
*   - `store/<lang>/N-<scene>.png`  Play Store screenshots, 1080×1920, a caption
*                                   above the phone, one folder per language
*
* The animations are FILMED: real pointer drags go through the game's own
* input handler (so blocks lean, glide and leave with their animation), and
* Chrome's screencast records them. `tools/frames_to_gif.py` (Pillow) turns the
* timed frames into a GIF — no ffmpeg needed.
*
* WHY THIS DRIVES http://, NOT file:// (2026-09-15) — boot `await`s a Supabase
* session check before showing anything past the static markup, and under
* file:// that promise never settles: every scene "succeeded" at photographing
* the pre-JS HTML. Serving prototype/ over a throwaway local http server
* sidesteps it — same origin a browser would actually use.
*
* The debug panel is gated behind an admin account, so a capture run reaches a
* level by setting `unlockedLevel` in the fabricated save and pressing Play,
* exactly as a player would (Play opens the brief of the current level).
* `window.__game` (main.js, bottom) is the one hook used, to read the level's
* reference solution and the board's geometry.
*
* The page gets `native-app` on <html>: the packaged app fills the screen
* instead of the 9:16 web mock-up, and hides the banner placeholder — that is
* what a Play Store screenshot must show.
*/

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');   // prototype/
const OUTPUT = join(ROOT, '..', 'media');
const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'google-chrome');
const WIDTH = 393, HEIGHT = 852;     // a plain modern phone size
const SCALE = 2;                     // dense display: crisp images
const GIF_WIDTH = 360;

const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const ONLY = argOf('--only')?.split(',') ?? null;
const STORE_LANGS = (argOf('--langs') ?? 'en,fr,es,it,zh').split(',');

/** Sample save: a player who has already progressed, to keep numbers believable. */
function makeSave(lang, unlockedLevel = 50) {
  const levels = {};
  for (let n = 1; n < unlockedLevel; n++) {
    const stars = [3, 3, 2, 3, 3, 2, 3, 1, 3, 2][n % 10];
    levels[n] = { stars, bestScore: 10 + (n % 7) };
  }
  return {
    version: 2, progressEpoch: 2, unlockedLevel, coins: 340, xp: 340, levels,
    language: lang, noAds: true, music: true, sfx: true, vibration: true,
    streak: 4, levelStreak: 3, bloom: 3, lives: 10, boostersIntro: true,
    lastPlayDay: null, dailyClaimedOn: '2000-01-01',
    createdAt: '2026-01-01T00:00:00.000Z', lastPlayedAt: null,
  };
}

// ---------------------------------------------------------------------------
// A throwaway static server for prototype/.
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webp': 'image/webp',
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(req.url.split('?')[0]);
      const full = join(ROOT, path === '/' ? '/index.html' : path);
      if (!full.startsWith(ROOT)) throw new Error('outside root');
      const data = await readFile(full);
      res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------------
// A minimal Chrome DevTools Protocol client — no dependency, `WebSocket` is a
// Node 22 global.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 15000, interval = 150) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const r = await fn(); if (r) return r; } catch { /* retry */ }
    await sleep(interval);
  }
  throw new Error('timed out waiting');
}

async function openSession(port, url) {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok);
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) listeners.get(msg.method)?.(msg.params);
  };
  const send = (method, params = {}) => {
    const id = ++seq;
    return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  };

  await send('Page.enable');
  await send('Runtime.enable');

  async function setViewport(width, height, scale = SCALE, mobile = true) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  }
  await setViewport(WIDTH, HEIGHT);

  async function evalJs(expression, awaitPromise = false) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
    }
    return r.result?.result?.value;
  }

  /**
   * Fresh state for a scene: clear whatever the previous one left, seed the
   * fabricated save, then load for real. `still` freezes CSS motion — a still
   * capture must show a state, not a half-played transition.
   */
  async function boot({ lang = 'en', level = 50, still = true } = {}) {
    await setViewport(WIDTH, HEIGHT);
    await send('Page.navigate', { url });
    await waitFor(async () => await evalJs('document.readyState === "complete"'));
    await evalJs(`localStorage.clear(); localStorage.setItem('puzzlequest.save.v1', ${JSON.stringify(JSON.stringify(makeSave(lang, level)))});`);
    await send('Page.reload', {});
    await waitFor(async () => await evalJs('document.readyState === "complete"'));
    await evalJs(`(() => {
      document.documentElement.classList.add('native-app');
      const s = document.createElement('style');
      s.textContent = ${JSON.stringify(still ? '*{animation:none!important;transition:none!important}' : '')};
      document.head.appendChild(s);
    })()`);
    await evalJs('document.fonts.ready.then(() => true)', true);
  }

  async function click(selector) {
    await waitFor(async () => await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && e.offsetParent !== null; })()`));
    await evalJs(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }

  async function screenshot(path) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(r.result.data, 'base64'));
  }

  /** Login (offline route — the game must stay playable without an account). */
  async function login() {
    await click('#btn-offline');
    await sleep(600);
  }

  /** Home → Play opens the brief of the current level → Start. */
  async function playCurrent() {
    await click('#btn-play');
    await sleep(500);
    await click('#btn-start');
    await waitFor(async () => await evalJs('!!window.__game.board && window.__game.view.cell > 0'));
    await sleep(900);
  }

  // --- Pointer -------------------------------------------------------------

  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse',
  });

  /** Screen point of grid cell (x, y)'s centre, from the board view's own geometry. */
  async function cellCenter(x, y) {
    return evalJs(`(() => {
      const v = window.__game.view, o = v._origin();
      return { x: o.left + (${x} + 0.5) * v.cell, y: o.top + (${y} + 0.5) * v.cell };
    })()`);
  }

  /**
   * Plays a level's reference solution with real drags: press on a cell of the
   * block, glide the pointer cell after cell along the solution's path, push
   * on through the gate, release. `msPerCell` sets the pace.
   */
  async function playSolution({ steps = Infinity, msPerCell = 120, pause = 260 } = {}) {
    const solution = await evalJs('window.__game.level.solution');
    const DIR = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
    let done = 0;
    for (const step of solution) {
      if (done++ >= steps) break;
      const path = step.path ?? step.chemin ?? [];
      const grab = await evalJs(`(() => {
        const b = window.__game.board.blocks.get(${step.id});
        if (!b) return null;
        const [dx, dy] = b.cells[0];
        return { x: b.x + dx, y: b.y + dy, ox: b.x, oy: b.y };
      })()`);
      if (!grab) continue;
      const points = path.slice(1).map((p) => [grab.x + p.x - grab.ox, grab.y + p.y - grab.oy]);
      const last = points.at(-1) ?? [grab.x, grab.y];
      if (step.gate && DIR[step.gate]) {
        const [vx, vy] = DIR[step.gate];
        points.push([last[0] + vx * 1.2, last[1] + vy * 1.2]);
      }

      let at = await cellCenter(grab.x, grab.y);
      await mouse('mouseMoved', at.x, at.y);
      await mouse('mousePressed', at.x, at.y);
      await sleep(90);
      for (const [cx, cy] of points) {
        const to = await cellCenter(cx, cy);
        const n = 5;
        for (let i = 1; i <= n; i++) {
          await mouse('mouseMoved', at.x + (to.x - at.x) * i / n, at.y + (to.y - at.y) * i / n);
          await sleep(msPerCell / n);
        }
        at = to;
      }
      await sleep(40);
      await mouse('mouseReleased', at.x, at.y);
      await sleep(pause);
    }
  }

  // --- Filming -------------------------------------------------------------

  /** Records the page while `action` runs; returns the timed frames. */
  async function film(action, { tail = 1200 } = {}) {
    const frames = [];
    listeners.set('Page.screencastFrame', (p) => {
      frames.push({ data: p.data, t: p.metadata.timestamp });
      send('Page.screencastFrameAck', { sessionId: p.sessionId });
    });
    await send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: WIDTH * SCALE, maxHeight: HEIGHT * SCALE });
    await sleep(300);
    await action();
    await sleep(tail);
    await send('Page.stopScreencast');
    listeners.delete('Page.screencastFrame');
    return frames;
  }

  return {
    send, evalJs, boot, click, login, playCurrent, playSolution, film, screenshot, setViewport, mouse,
    close: () => ws.close(),
  };
}

/** Timed screencast frames → GIF, through tools/frames_to_gif.py (Pillow). */
function writeGif(frames, out, { fps = 15, width = GIF_WIDTH, crop = null, colors = 255, dither = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'quiet-puzzle-frames-'));
  const list = frames.map((f, i) => {
    const file = join(dir, `f${String(i).padStart(5, '0')}.png`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    return { file, t: f.t };
  });
  writeFileSync(join(dir, 'frames.json'), JSON.stringify({ frames: list, fps, width, crop, colors, dither }));
  execFileSync('python3', [join(ROOT, 'tools', 'frames_to_gif.py'), join(dir, 'frames.json'), out], { stdio: 'inherit' });
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Still scenes. Each starts from `boot()`; the README gets the English set,
// the store gets every language.
// ---------------------------------------------------------------------------

/** The levels shown: early enough to read, late enough to show mechanics. */
const BOARD_LEVEL = 23;      // Wisteria Veil — blocks on rails
const RESULT_LEVEL = 1;
const MAP_LEVEL = 50;

const SCENES = {
  menu: async (s, lang) => {
    await s.boot({ lang, level: MAP_LEVEL });
    await s.login();
  },

  board: async (s, lang) => {
    await s.boot({ lang, level: BOARD_LEVEL });
    await s.login();
    await s.playCurrent();
    await s.playSolution({ steps: 2 });
    await sleep(500);
  },

  brief: async (s, lang) => {
    await s.boot({ lang, level: 61 });
    await s.login();
    await s.click('#btn-play');
    await sleep(600);
  },

  map: async (s, lang) => {
    await s.boot({ lang, level: MAP_LEVEL });
    await s.login();
    await s.click('#btn-play');
    await sleep(400);
    await s.click('#screen-brief [data-nav="map"]');
    await sleep(600);
  },

  // The level is really solved: an emptied grid with a zero score would show
  // nothing meaningful.
  result: async (s, lang) => {
    await s.boot({ lang, level: RESULT_LEVEL });
    await s.login();
    await s.playCurrent();
    await s.playSolution({ msPerCell: 30, pause: 120 });
    await waitFor(async () => await s.evalJs(`!!document.querySelector('#screen-result.active, #screen-result:not([hidden])')`), 8000).catch(() => {});
    await sleep(1800);
  },

  daily: async (s, lang) => {
    await s.boot({ lang, level: MAP_LEVEL });
    await s.login();
    await s.click('#btn-daily-puzzle');
    await sleep(1500);
  },

  profile: async (s, lang) => {
    await s.boot({ lang, level: MAP_LEVEL });
    await s.login();
    await s.click('#user-btn');
    await sleep(400);
  },

  // The editor opened on a draft: a real level of the second world, stored in
  // "My levels" (meta/myLevels.js) and resumed from there, then Checked.
  editor: async (s, lang) => {
    await s.boot({ lang, level: MAP_LEVEL });
    await s.evalJs(`fetch('levels/monde-1.json').then(r => r.json()).then(w => {
      const level = w.levels.find(l => l.number === ${BOARD_LEVEL - 1});
      localStorage.setItem('puzzlequest.mesniveaux.v1', JSON.stringify([{ id: 'capture', title: 'Rails', updatedAt: new Date().toISOString(),
        width: level.width, height: level.height, blocks: level.blocks.length, submitted: false, level }]));
      return true;
    })`, true);
    await s.login();
    await s.click('#user-btn');
    await sleep(300);
    await s.click('#btn-editor');
    await sleep(400);
    await s.click('#ed-mine');
    await sleep(300);
    await s.click('.mine-open');
    await sleep(400);
    await s.click('#ed-check');
    await waitFor(async () => await s.evalJs(`/ok/.test(document.querySelector('.ed-status')?.className || '')`), 20000).catch(() => {});
    await sleep(600);
  },
};

// ---------------------------------------------------------------------------
// Animations, filmed with real motion.
// ---------------------------------------------------------------------------

const ANIMATIONS = {
  /** A whole first level, block after block, to the win screen. */
  gameplay: async (s) => {
    await s.boot({ level: 1, still: false });
    await s.login();
    await s.playCurrent();
    return s.film(() => s.playSolution({ msPerCell: 110, pause: 220 }), { tail: 2200 });
  },

  /** Blocks on rails, in the second world — a taste of the later mechanics. */
  rails: async (s) => {
    await s.boot({ level: BOARD_LEVEL, still: false });
    await s.login();
    await s.playCurrent();
    return s.film(() => s.playSolution({ steps: 7, msPerCell: 110, pause: 240 }), { tail: 600 });
  },

  /** The map scrolled up through the worlds, their branches and colours. */
  worlds: async (s) => {
    await s.boot({ level: 300, still: false });
    await s.login();
    await s.click('#btn-play');
    await sleep(400);
    await s.click('#screen-brief [data-nav="map"]');
    await sleep(900);
    return s.film(async () => {
      const total = await s.evalJs(`(() => { const m = document.getElementById('map-scroll'); return m.scrollHeight - m.clientHeight; })()`);
      const from = await s.evalJs(`document.getElementById('map-scroll').scrollTop`);
      const span = Math.min(from, 5200);
      const steps = 150;
      for (let i = 1; i <= steps; i++) {
        const e = 0.5 - Math.cos(Math.PI * i / steps) / 2;
        await s.evalJs(`document.getElementById('map-scroll').scrollTop = ${Math.round(from - span * e)}`);
        await sleep(33);
      }
      void total;
    }, { tail: 500 });
  },
};

/** Per-clip GIF settings: the map is mostly texture, which dithering makes heavy. */
const GIF_OPTIONS = {
  gameplay: { fps: 15, width: 320, colors: 160, dither: false },
  rails: { fps: 15, width: 320, colors: 160, dither: false },
  worlds: { fps: 12, width: 280, colors: 128, dither: false },
};

// ---------------------------------------------------------------------------
// Store screenshots: the phone capture under a caption, 1080×1920.
// ---------------------------------------------------------------------------

const STORE = [
  // [scene, caption key]
  ['board', 'drag'],
  ['result', 'chime'],
  ['map', 'worlds'],
  ['brief', 'mechanics'],
  ['daily', 'daily'],
  ['editor', 'editor'],
];

const CAPTIONS = JSON.parse(readFileSync(join(ROOT, 'tools', 'store-captions.json'), 'utf8'));

function storePage(png, title, sub, hue) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Outfit:wght@300;400&family=Noto+Sans+SC:wght@300;500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:540px;height:960px;overflow:hidden}
  body{background:linear-gradient(170deg,hsl(${hue} 70% 95%) 0%,hsl(${(hue + 40) % 360} 55% 90%) 100%);
       font-family:Outfit,'Noto Sans SC',sans-serif;color:#4a3542;display:flex;flex-direction:column;align-items:center}
  h1{font:500 38px/1.12 Fraunces,'Noto Sans SC',serif;margin:56px 36px 10px;text-align:center;letter-spacing:-.01em;text-wrap:balance}
  p{font:300 19px/1.35 Outfit,'Noto Sans SC',sans-serif;margin:0 44px;text-align:center;color:#7a6070;text-wrap:balance}
  .phone{margin-top:34px;width:356px;height:772px;border-radius:44px;overflow:hidden;
         box-shadow:0 30px 70px rgba(90,50,80,.28),0 0 0 9px #fff,0 0 0 10px rgba(90,50,80,.10)}
  .phone img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
</style></head><body>
<h1>${title}</h1><p>${sub}</p>
<div class="phone"><img src="data:image/png;base64,${png.toString('base64')}"></div>
</body></html>`;
}

async function storeShot(s, png, caption, hue, out) {
  await s.setViewport(540, 960, 2, false);
  await s.send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  const frame = await s.send('Page.getFrameTree');
  await s.send('Page.setDocumentContent', { frameId: frame.result.frameTree.frame.id, html: storePage(png, caption.title, caption.sub, hue) });
  await s.evalJs('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 400)))', true);
  await s.screenshot(out);
}

// ---------------------------------------------------------------------------

async function run() {
  mkdirSync(OUTPUT, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/index.html`;

  const userDataDir = mkdtempSync(join(tmpdir(), 'quiet-puzzle-captures-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--hide-scrollbars', '--no-first-run', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=0`, `--user-data-dir=${userDataDir}`,
    `--window-size=${WIDTH},${HEIGHT}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const cdpPort = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not report a DevTools port')), 10000);
    chrome.stderr.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
  });

  const s = await openSession(cdpPort, url);
  const want = (name) => !ONLY || ONLY.includes(name);
  let failures = 0;

  const step = async (label, fn) => {
    process.stdout.write(`  ${label}… `);
    try { await fn(); console.log('ok'); } catch (e) { failures++; console.log('failed: ' + String(e.message).split('\n')[0]); }
  };

  console.log('README captures:');
  for (const [name, scene] of Object.entries(SCENES)) {
    if (!want(name)) continue;
    await step(name, async () => { await scene(s, 'en'); await s.screenshot(join(OUTPUT, `${name}.png`)); });
  }

  console.log('\nanimations:');
  for (const [name, anim] of Object.entries(ANIMATIONS)) {
    if (!want(name)) continue;
    await step(name, async () => writeGif(await anim(s), join(OUTPUT, `${name}.gif`), GIF_OPTIONS[name]));
  }

  if (want('store')) {
    console.log('\nstore:');
    const hues = [345, 30, 275, 200, 145, 225];
    for (const lang of STORE_LANGS) {
      const dir = join(OUTPUT, 'store', lang);
      mkdirSync(dir, { recursive: true });
      for (const [i, [scene, key]] of STORE.entries()) {
        await step(`${lang}/${scene}`, async () => {
          await SCENES[scene](s, lang);
          const shot = Buffer.from((await s.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
          await storeShot(s, shot, CAPTIONS[lang][key], hues[i], join(dir, `${i + 1}-${scene}.png`));
        });
      }
    }
  }

  s.close();
  chrome.kill();
  server.close();
  if (failures) { console.log(`\n${failures} failed`); process.exitCode = 1; }
}

run();
