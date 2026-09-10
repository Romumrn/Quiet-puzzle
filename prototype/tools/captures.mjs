/**
* Screen captures and animations — `node tools/captures.mjs`
*
* Drives Chrome in headless mode to photograph the game in specific states.
* Each capture is REPRODUCIBLE: it starts from a saved state and a chosen level,
* never from a manually played session. Rerunning the tool after an interface
* change regenerates the images, which a hand-placed image folder cannot do.
*
* The GIF is assembled frame by frame: blocks are moved to calculated positions,
* photographed, and ffmpeg composes the final clip. Chrome headless cannot film,
* but it can place objects precisely.
*/

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, '..', 'media');
const TEMP = join(OUTPUT, '.frames');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = 420;
const HEIGHT = 746;   // 9:16 exact; the game frame fills the window

/** Sample save: a player who has already progressed, to keep numbers believable. */
const SAVE = {
 version: 2, unlockedLevel: 9, coins: 340, xp: 340,
 levels: { 1: { stars: 3, bestScore: 9 }, 2: { stars: 3, bestScore: 11 }, 3: { stars: 2, bestScore: 14 },
            4: { stars: 3, bestScore: 12 }, 5: { stars: 2, bestScore: 16 }, 6: { stars: 1, bestScore: 19 },
            7: { stars: 2, bestScore: 15 }, 8: { stars: 1, bestScore: 18 } },
 noAds: false, music: true, effects: true, streak: 4,
 lastPlayDay: null, dailyClaimedOn: '2000-01-01',
 createdAt: '2026-01-01T00:00:00.000Z', lastPlayedAt: null,
};

/**
* Builds a standalone page that sets the desired state and marks itself ready.
* Animations are neutralized: a capture must show a state, not a half-played transition.
*/
function freezePage(scenario) {
 const game = join(ROOT, 'dist/standalone.html');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>html,body{margin:0}iframe{border:0;width:${WIDTH}px;height:${HEIGHT}px}</style>
</head><body>
<iframe id="game" src="file://${game}"></iframe>
<script>
const f = document.getElementById('game');
f.onload = async () => {
  const w = f.contentWindow, d = f.contentDocument;
  w.localStorage.setItem('puzzlequest.save.v1', ${JSON.stringify(JSON.stringify(SAVE))});
  w.location.reload();
  f.onload = async () => {
    const w = f.contentWindow, d = f.contentDocument;
    const st = d.createElement('style');
    st.textContent = '*{animation:none!important;transition:none!important}';
    d.head.appendChild(st);
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const el = (id) => d.getElementById(id);
    await wait(300);
    ${scenario}
    await wait(400);
    document.title = 'READY';
  };
};
</script></body></html>`;
}

function capture(name, scenario) {
 mkdirSync(OUTPUT, { recursive: true });
 const html = join(OUTPUT, `.scene-${name}.html`);
 writeFileSync(html, freezePage(scenario));
 const png = join(OUTPUT, `${name}.png`);
 execFileSync(CHROME, [
   '--headless=new', '--disable-gpu', '--hide-scrollbars',
   '--force-device-scale-factor=2',          // dense display: crisp images
   `--window-size=${WIDTH},${HEIGHT}`,
   '--virtual-time-budget=9000',
   '--allow-file-access-from-files',
   `--screenshot=${png}`,
   `file://${html}`,
 ], { stdio: 'pipe' });
 rmSync(html, { force: true });
 return png;
}

// --------------------------------------------------------------------------

const SCENES = {
 menu: "el('user-btn') && 0;",

 map: `el('btn-play').click(); await wait(500);
       d.getElementById('map-scroll').scrollTop = 0;`,

 game: `el('btn-play').click(); await wait(300);
       el('debug-toggle').click(); el('debug-level').value = 12; el('debug-go').click();
       await wait(700); el('debug-panel').hidden = true;`,

 profile: `el('user-btn').click(); await wait(300);`,

 // We actually solve the level instead of using the QA shortcut:
 // it empties the grid without consuming moves, so the screen would display a
 // zero score and show nothing meaningful about the play.
 success: `el('btn-play').click(); await wait(300);
           el('debug-toggle').click(); el('debug-level').value = 7; el('debug-go').click();
           await wait(700); el('debug-panel').hidden = true;
           const g = w.__game;
           for (const step of g.level.solution) {
             for (const pos of step.chemin.slice(1)) g.board.dragTowards(step.id, pos.x, pos.y);
             const v = { top:[0,-1], right:[1,0], bottom:[0,1], left:[-1,0] }[step.gate];
             if (g.board.blocks.has(step.id)) g.board.step(step.id, v[0], v[1]);
             g.board.endGesture(true);
           }
           g.view.resync();
           await w.__game.finishForCapture?.();
           el('debug-win').click();
           await wait(2600);`,

 editor: `el('debug-toggle').click(); el('debug-editor').click(); await wait(500);
          el('debug-panel').hidden = true;
          const walls = [...d.querySelectorAll('.ed-wall-top')];
          walls[1].click(); await wait(120);
          const cells = [...d.querySelectorAll('.ed-cell')];
          cells[1].click(); await wait(120);
          d.querySelectorAll('.ed-color')[2].click(); await wait(80);
          d.querySelectorAll('.ed-shape')[5].click(); await wait(80);
          cells[14].click(); await wait(120);
          el('ed-check').click(); await wait(300);`,
};

const images = [];
for (const [name, scenario] of Object.entries(SCENES)) {
 process.stdout.write(`  ${name}… `);
 try {
   capture(name, scenario);
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
 const scenario = `
   el('btn-play').click(); await wait(300);
   el('debug-toggle').click(); el('debug-level').value = 12; el('debug-go').click();
   await wait(700); el('debug-panel').hidden = true;
   const g = w.__game;
   // Replay the reference solution, ${i} move(s) ahead.
   let done = 0;
   loop:
   for (const step of g.level.solution) {
     for (const pos of step.chemin.slice(1)) {
       if (done >= ${i}) break loop;
       g.board.dragTowards(step.id, pos.x, pos.y);
       done++;
     }
     if (done >= ${i}) break;
     const v = { top:[0,-1], right:[1,0], bottom:[0,1], left:[-1,0] }[step.gate];
     if (g.board.blocks.has(step.id)) g.board.step(step.id, v[0], v[1]);
     g.board.endGesture(true);
     done++;
   }
   g.view.resync(); g.view.refreshGates(); g.view.refreshLocks();
 `;
 process.stdout.write(`  ${i + 1}/${GIF_IMAGES}\r`);
 const html = join(TEMP, `.f${i}.html`);
 writeFileSync(html, freezePage(scenario));
 execFileSync(CHROME, [
   '--headless=new', '--disable-gpu', '--hide-scrollbars',
   '--force-device-scale-factor=1',
   `--window-size=${WIDTH},${HEIGHT}`,
   '--virtual-time-budget=9000', '--allow-file-access-from-files',
   `--screenshot=${join(TEMP, `f${String(i).padStart(3, '0')}.png`)}`,
   `file://${html}`,
 ], { stdio: 'pipe' });
 rmSync(html, { force: true });
}

const gif = join(OUTPUT, 'gameplay.gif');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '3',
 '-i', join(TEMP, 'f%03d.png'),
 '-vf', 'scale=380:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer',
 '-loop', '0', gif]);
rmSync(TEMP, { recursive: true, force: true });

console.log(`\n\n${images.length} captures + gameplay.gif dans media/`);
