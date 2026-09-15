/**
* Screen captures and animations — `node tools/captures.mjs`
*
* Drives Chrome in headless mode to photograph the game in specific states.
* Each capture is REPRODUCIBLE: it starts from a fabricated save and a chosen
* level, never from a manually played session. Rerunning the tool after an
* interface change regenerates the images, which a hand-placed image folder
* cannot do.
*
* The GIF is assembled frame by frame: blocks are moved to calculated positions,
* photographed, and ffmpeg composes the final clip. Chrome headless cannot film,
* but it can place objects precisely.
*
* WHY THIS DRIVES http://, NOT file:// (2026-09-15) — the previous version
* loaded dist/standalone.html through a file:// iframe and single-shot Chrome
* `--screenshot`. That stopped working, silently: boot now `await`s a
* Supabase session check before showing anything past the static markup, and
* under file:// — no network reachable from this sandbox — that promise never
* settles. The page never gets past its pre-JS HTML, which happens to LOOK
* LIKE a valid empty menu (0 stars, 0 coins, level 1, the untranslated English
* fallback text), so every scene "succeeded" at photographing nothing. Serving
* prototype/ over a throwaway local http server sidesteps it entirely — same
* origin a browser would actually use, session check resolves immediately.
*
* This also means the debug panel (`#debug-toggle` and its `debug-level` /
* `debug-go` shortcut) is no longer an option: it is gated behind an admin
* account now (see main.js `updateAdminSection`), not just a hidden
* attribute, and a capture run has no account. To reach a level past 1, the
* fabricated save sets `unlockedLevel` directly and the map is walked for
* real, exactly as a player would. `window.__game` (main.js, bottom) is the
* one hook that stays reachable without an account — used below to replay a
* level's reference solution for the win-screen and GIF captures.
*/

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');   // prototype/
const OUTPUT = join(ROOT, '..', 'media');
const TEMP = join(OUTPUT, '.frames');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = 393, HEIGHT = 852;     // a plain modern phone size
const SCALE = 2;                     // dense display: crisp images

/** Sample save: a player who has already progressed, to keep numbers believable. */
const SAVE = {
  version: 2, unlockedLevel: 50, coins: 340, xp: 340,
  levels: { 1: { stars: 3, bestScore: 9 }, 2: { stars: 3, bestScore: 11 }, 3: { stars: 2, bestScore: 14 },
            4: { stars: 3, bestScore: 12 }, 5: { stars: 2, bestScore: 16 }, 6: { stars: 1, bestScore: 19 },
            7: { stars: 2, bestScore: 15 }, 8: { stars: 1, bestScore: 18 } },
  noAds: false, music: true, sfx: true, vibration: true, streak: 4,
  lastPlayDay: null, dailyClaimedOn: '2000-01-01',
  createdAt: '2026-01-01T00:00:00.000Z', lastPlayedAt: null,
};

// ---------------------------------------------------------------------------
// A throwaway static server for prototype/ — the same files `python3 -m
// http.server` would serve, just started and stopped by this script so a
// capture run needs nothing pre-started.
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm',
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
// Node 22 global. One tab, reused across every scene; each scene starts by
// clearing storage so it boots from a clean, fabricated state.
// ---------------------------------------------------------------------------

async function waitFor(fn, timeout = 15000, interval = 150) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const r = await fn(); if (r) return r; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('timed out waiting');
}

async function openSession(port, url) {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok);
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => {
    const id = ++seq;
    return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: true });

  async function evalJs(expression, awaitPromise = false) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
    }
    return r.result?.result?.value;
  }

  async function boot() {
    // Fresh state for this scene: clear whatever the previous one left, seed
    // the fabricated save, then load for real.
    await send('Page.navigate', { url });
    await waitFor(async () => await evalJs('document.readyState === "complete"'));
    await evalJs(`localStorage.clear(); localStorage.setItem('puzzlequest.save.v1', ${JSON.stringify(JSON.stringify(SAVE))});`);
    await send('Page.reload', {});
    await waitFor(async () => await evalJs('document.readyState === "complete"'));
    // A capture must show a state, not a half-played transition.
    await evalJs(`(() => { const s = document.createElement('style'); s.textContent = '*{animation:none!important;transition:none!important}'; document.head.appendChild(s); })()`);
  }

  async function click(selector) {
    await waitFor(async () => await evalJs(`!!document.querySelector(${JSON.stringify(selector)})`));
    await evalJs(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }

  async function clickLevel(n) {
    await waitFor(async () => await evalJs(
      `[...document.querySelectorAll('.map-node')].some(b => b.querySelector('b')?.textContent === '${n}')`
    ));
    await evalJs(
      `[...document.querySelectorAll('.map-node')].find(b => b.querySelector('b')?.textContent === '${n}').click()`
    );
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function screenshot(path) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(r.result.data, 'base64'));
  }

  /** Login (offline route — this game must stay playable without an account, see loginScreen.js), then Play. */
  async function loginAndPlay() {
    await click('#btn-offline');
    await sleep(500);
    await click('#btn-play');
    await sleep(400);
  }

  /** Enters a specific level from the map and waits for the board to settle. */
  async function enterLevel(n) {
    await clickLevel(n);
    await sleep(300);
    await click('#btn-start');
    await sleep(900);
  }

  /**
   * Replays a level's reference solution through `window.__game` (main.js) —
   * the same `dragTowards` / `step` / `endGesture` sequence a real drag
   * produces, just driven from outside. `finishForCapture()` exists
   * specifically for this: it ends the level without needing a human to have
   * dragged anything.
   */
  async function solveCurrentLevel(stepLimit = Infinity) {
    return evalJs(`(function() {
      const g = window.__game;
      const DIR = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
      let done = 0;
      outer:
      for (const step of (g.level.solution || [])) {
        const path = Array.isArray(step.path) ? step.path : Array.isArray(step.chemin) ? step.chemin : [];
        for (const pos of path.slice(1)) {
          if (done >= ${stepLimit}) break outer;
          g.board.dragTowards(step.id, pos.x, pos.y);
          done++;
        }
        if (done >= ${stepLimit}) break;
        const v = DIR[step.gate];
        if (g.board.blocks.has(step.id) && v) g.board.step(step.id, v[0], v[1]);
        g.board.endGesture(true);
        done++;
      }
      g.view.resync();
      g.view.refreshGates?.();
      g.view.refreshLocks?.();
      return done;
    })()`);
  }

  async function finishForCapture() {
    await evalJs('window.__game.finishForCapture && window.__game.finishForCapture()', true);
  }

  return { evalJs, boot, click, clickLevel, enterLevel, loginAndPlay, solveCurrentLevel, finishForCapture, screenshot, sleep, close: () => ws.close() };
}

// ---------------------------------------------------------------------------

const SCENES = {
  menu: async (s) => {
    await s.click('#btn-offline');
    await s.sleep(500);
  },

  map: async (s) => {
    await s.loginAndPlay();
    await s.evalJs("document.getElementById('map-scroll').scrollTop = 0");
    await s.sleep(200);
  },

  board: async (s) => {
    await s.loginAndPlay();
    await s.enterLevel(12);
  },

  profile: async (s) => {
    await s.loginAndPlay();
    await s.click('#user-btn');
    await s.sleep(300);
  },

  // We actually solve the level instead of a shortcut: an emptied grid with a
  // zero score would show nothing meaningful about the play.
  result: async (s) => {
    await s.loginAndPlay();
    await s.enterLevel(7);
    await s.solveCurrentLevel();
    await s.finishForCapture();
    await s.sleep(900);
  },

  editor: async (s) => {
    await s.loginAndPlay();
    await s.click('#user-btn');
    await s.sleep(300);
    await s.click('#btn-editor');
    await s.sleep(400);
    await s.evalJs(`(() => {
      const walls = [...document.querySelectorAll('.ed-wall-top')];
      walls[1]?.click();
    })()`);
    await s.sleep(120);
    await s.evalJs(`document.querySelectorAll('.ed-cell')[1]?.click()`);
    await s.sleep(120);
    await s.evalJs(`document.querySelectorAll('.ed-color')[2]?.click()`);
    await s.sleep(80);
    await s.evalJs(`document.querySelectorAll('.ed-shape')[5]?.click()`);
    await s.sleep(80);
    await s.evalJs(`document.querySelectorAll('.ed-cell')[14]?.click()`);
    await s.sleep(120);
    await s.click('#ed-check');
    await s.sleep(300);
  },
};

async function run() {
  mkdirSync(OUTPUT, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/index.html`;

  const userDataDir = mkdtempSync(join(tmpdir(), 'quiet-puzzle-captures-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--remote-debugging-port=0`, `--user-data-dir=${userDataDir}`,
    `--window-size=${WIDTH},${HEIGHT}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // Chrome prints its DevTools port to stderr when asked for port 0.
  const cdpPort = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not report a DevTools port')), 10000);
    chrome.stderr.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
  });

  const session = await openSession(cdpPort, url);
  const images = [];
  for (const [name, scenario] of Object.entries(SCENES)) {
    process.stdout.write(`  ${name}… `);
    try {
      await session.boot();
      await scenario(session);
      await session.screenshot(join(OUTPUT, `${name}.png`));
      console.log('ok');
      images.push(name);
    } catch (e) {
      console.log('failed : ' + String(e.message).split('\n')[0]);
    }
  }

  // --------------------------------------------------------------------------
  // Animation: a block slides to its gate and exits
  // --------------------------------------------------------------------------

  const GIF_IMAGES = 16;
  console.log('\nanimation :');
  mkdirSync(TEMP, { recursive: true });

  for (let i = 0; i < GIF_IMAGES; i++) {
    process.stdout.write(`  ${i + 1}/${GIF_IMAGES}\r`);
    await session.boot();
    await session.loginAndPlay();
    await session.enterLevel(12);
    await session.solveCurrentLevel(i);
    await session.screenshot(join(TEMP, `f${String(i).padStart(3, '0')}.png`));
  }
  console.log('');

  session.close();
  chrome.kill();
  server.close();

  const gif = join(OUTPUT, 'gameplay.gif');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '3',
    '-i', join(TEMP, 'f%03d.png'),
    '-vf', 'scale=380:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer',
    '-loop', '0', gif]);
  rmSync(TEMP, { recursive: true, force: true });

  console.log(`\n${images.length}/${Object.keys(SCENES).length} captures + gameplay.gif dans media/`);
  if (images.length < Object.keys(SCENES).length) process.exitCode = 1;
}

run();
