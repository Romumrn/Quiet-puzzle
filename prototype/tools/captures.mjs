/**
 * Captures d'écran et animations — `node tools/captures.mjs`
 *
 * Pilote Chrome en mode headless pour photographier le jeu dans des états
 * précis. Chaque capture est REPRODUCTIBLE : on part d'une sauvegarde fabriquée
 * et d'un niveau donné, jamais d'une partie jouée à la main. Relancer l'outil
 * après une modification de l'interface régénère des images à jour, ce qu'un
 * dossier d'images déposées à la main ne permet pas.
 *
 * Le GIF est assemblé image par image : on place les blocs à des positions
 * calculées, on photographie, et ffmpeg recolle le tout. Chrome headless ne
 * sait pas filmer, mais il sait très bien poser.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(RACINE, '..', 'media');
const TEMPO = join(SORTIE, '.frames');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LARGEUR = 420;
const HAUTEUR = 746;   // 9:16 exact, le cadre du jeu remplit alors la fenêtre

/** Sauvegarde type : un joueur qui a déjà avancé, pour des chiffres crédibles. */
const SAUVEGARDE = {
  version: 2, unlockedLevel: 9, coins: 340, xp: 340,
  levels: { 1: { stars: 3, bestScore: 9 }, 2: { stars: 3, bestScore: 11 }, 3: { stars: 2, bestScore: 14 },
            4: { stars: 3, bestScore: 12 }, 5: { stars: 2, bestScore: 16 }, 6: { stars: 1, bestScore: 19 },
            7: { stars: 2, bestScore: 15 }, 8: { stars: 1, bestScore: 18 } },
  noAds: false, musique: true, effets: true, streak: 4,
  lastPlayDay: null, dailyClaimedOn: '2000-01-01',
  createdAt: '2026-01-01T00:00:00.000Z', lastPlayedAt: null,
};

/**
 * Fabrique une page autonome qui se met dans l'état voulu puis se déclare
 * prête. Les animations sont neutralisées : une capture doit montrer un état,
 * pas une transition à moitié jouée.
 */
function pageFigee(scenario) {
  const jeu = join(RACINE, 'dist/standalone.html');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<style>html,body{margin:0}iframe{border:0;width:${LARGEUR}px;height:${HAUTEUR}px}</style>
</head><body>
<iframe id="jeu" src="file://${jeu}"></iframe>
<script>
const f = document.getElementById('jeu');
f.onload = async () => {
  const w = f.contentWindow, d = f.contentDocument;
  w.localStorage.setItem('puzzlequest.save.v1', ${JSON.stringify(JSON.stringify(SAUVEGARDE))});
  w.location.reload();
  f.onload = async () => {
    const w = f.contentWindow, d = f.contentDocument;
    const st = d.createElement('style');
    st.textContent = '*{animation:none!important;transition:none!important}';
    d.head.appendChild(st);
    const attendre = (ms) => new Promise(r => setTimeout(r, ms));
    const el = (id) => d.getElementById(id);
    await attendre(300);
    ${scenario}
    await attendre(400);
    document.title = 'PRET';
  };
};
</script></body></html>`;
}

function capturer(nom, scenario) {
  mkdirSync(SORTIE, { recursive: true });
  const html = join(SORTIE, `.scene-${nom}.html`);
  writeFileSync(html, pageFigee(scenario));
  const png = join(SORTIE, `${nom}.png`);
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=2',          // écran dense : images nettes
    `--window-size=${LARGEUR},${HAUTEUR}`,
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

  carte: `el('btn-play').click(); await attendre(500);
          d.getElementById('map-scroll').scrollTop = 0;`,

  jeu: `el('btn-play').click(); await attendre(300);
        el('debug-toggle').click(); el('debug-level').value = 12; el('debug-go').click();
        await attendre(700); el('debug-panel').hidden = true;`,

  profil: `el('user-btn').click(); await attendre(300);`,

  // On RESOUT réellement le niveau plutôt que d'utiliser le raccourci QA :
  // celui-ci vide la grille sans consommer de geste, et l'écran affichait donc
  // un score de zéro, ce qui ne montre rien de la partie.
  reussite: `el('btn-play').click(); await attendre(300);
             el('debug-toggle').click(); el('debug-level').value = 7; el('debug-go').click();
             await attendre(700); el('debug-panel').hidden = true;
             const g = w.__game;
             for (const etape of g.level.solution) {
               for (const pos of etape.chemin.slice(1)) g.board.dragTowards(etape.id, pos.x, pos.y);
               const v = { top:[0,-1], right:[1,0], bottom:[0,1], left:[-1,0] }[etape.gate];
               if (g.board.blocks.has(etape.id)) g.board.step(etape.id, v[0], v[1]);
               g.board.endGesture(true);
             }
             g.view.resync();
             await w.__game.finirPourCapture?.();
             el('debug-win').click();
             await attendre(2600);`,

  editeur: `el('debug-toggle').click(); el('debug-editor').click(); await attendre(500);
            el('debug-panel').hidden = true;
            const murs = [...d.querySelectorAll('.ed-wall-top')];
            murs[1].click(); await attendre(120);
            const cases = [...d.querySelectorAll('.ed-cell')];
            cases[1].click(); await attendre(120);
            d.querySelectorAll('.ed-color')[2].click(); await attendre(80);
            d.querySelectorAll('.ed-shape')[5].click(); await attendre(80);
            cases[14].click(); await attendre(120);
            el('ed-check').click(); await attendre(300);`,
};

const images = [];
for (const [nom, scenario] of Object.entries(SCENES)) {
  process.stdout.write(`  ${nom}… `);
  try {
    capturer(nom, scenario);
    console.log('ok');
    images.push(nom);
  } catch (e) {
    console.log('échec : ' + String(e.message).split('\n')[0]);
  }
}

// --------------------------------------------------------------------------
// Animation : un bloc glisse jusqu'à sa porte et sort
// --------------------------------------------------------------------------

const IMAGES_GIF = 16;
console.log('\nanimation :');
mkdirSync(TEMPO, { recursive: true });

for (let i = 0; i < IMAGES_GIF; i++) {
  const scenario = `
    el('btn-play').click(); await attendre(300);
    el('debug-toggle').click(); el('debug-level').value = 12; el('debug-go').click();
    await attendre(700); el('debug-panel').hidden = true;
    const g = w.__game;
    // On rejoue la solution de référence, ${i} geste(s) d'avance.
    let faits = 0;
    boucle:
    for (const etape of g.level.solution) {
      for (const pos of etape.chemin.slice(1)) {
        if (faits >= ${i}) break boucle;
        g.board.dragTowards(etape.id, pos.x, pos.y);
        faits++;
      }
      if (faits >= ${i}) break;
      const v = { top:[0,-1], right:[1,0], bottom:[0,1], left:[-1,0] }[etape.gate];
      if (g.board.blocks.has(etape.id)) g.board.step(etape.id, v[0], v[1]);
      g.board.endGesture(true);
      faits++;
    }
    g.view.resync(); g.view.refreshGates(); g.view.refreshLocks();
  `;
  process.stdout.write(`  ${i + 1}/${IMAGES_GIF}\r`);
  const html = join(TEMPO, `.f${i}.html`);
  writeFileSync(html, pageFigee(scenario));
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${LARGEUR},${HAUTEUR}`,
    '--virtual-time-budget=9000', '--allow-file-access-from-files',
    `--screenshot=${join(TEMPO, `f${String(i).padStart(3, '0')}.png`)}`,
    `file://${html}`,
  ], { stdio: 'pipe' });
  rmSync(html, { force: true });
}

const gif = join(SORTIE, 'gameplay.gif');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '3',
  '-i', join(TEMPO, 'f%03d.png'),
  '-vf', 'scale=380:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer',
  '-loop', '0', gif]);
rmSync(TEMPO, { recursive: true, force: true });

console.log(`\n\n${images.length} captures + gameplay.gif dans media/`);
