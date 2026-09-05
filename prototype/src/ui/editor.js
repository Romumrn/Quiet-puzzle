/**
 * Éditeur de niveaux.
 *
 * Permet de dessiner une grille à la main : poser des formes, choisir leur
 * couleur et leur nature, ouvrir des portes sur les murs, puis VERIFIER que le
 * résultat est jouable avant de le donner à qui que ce soit. La vérification
 * s'appuie sur le solveur (src/core/solver.js), pas sur une intuition.
 *
 * Modèle : on choisit une forme dans la palette, on la dépose sur la grille.
 * Un appui sur un bloc existant le retire. Un appui sur un mur fait défiler la
 * couleur de la porte à cet endroit ; les cases voisines de même couleur sont
 * fusionnées en une seule porte à l'export.
 */

import { SHAPES, COLORS, KIND } from '../core/block.js';
import { Board } from '../core/board.js';
import { resoudre } from '../core/solver.js';

const COTES = ['top', 'right', 'bottom', 'left'];
/**
 * Une ancre a besoin de sa direction, d'où les quatre entrées : c'est la
 * direction qui la définit, comme l'axe définit une glissière.
 */
const NATURES = [
  { kind: KIND.NORMAL, label: 'Normal' },
  { kind: KIND.RAIL, label: 'Glissière', axis: 'h' },
  { kind: KIND.RAIL, label: 'Glissière ↕', axis: 'v' },
  { kind: KIND.JOKER, label: 'Joker' },
  { kind: KIND.LOCKED, label: 'Verrou' },
  { kind: KIND.WALL, label: 'Scellé' },
  { kind: KIND.ENCOMBRANT, label: 'Encombrant ×2' },
  { kind: KIND.ANCRE, label: 'Ancre ▲', dir: 'top' },
  { kind: KIND.ANCRE, label: 'Ancre ▶', dir: 'right' },
  { kind: KIND.ANCRE, label: 'Ancre ▼', dir: 'bottom' },
  { kind: KIND.ANCRE, label: 'Ancre ◀', dir: 'left' },
];

const el = (id) => document.getElementById(id);

let etat = null;
let choix = { shape: 0, color: 0, nature: 0, verrouCount: 2 };
let onTester = null;

const vide = (W, H) => ({
  W, H,
  blocks: [],
  portes: {
    top: new Array(W).fill(null),
    bottom: new Array(W).fill(null),
    left: new Array(H).fill(null),
    right: new Array(H).fill(null),
  },
});

export function init({ onTest }) {
  onTester = onTest;
  etat = vide(6, 7);
  construirePalettes();
  brancherBoutons();
  dessiner();
}

// ---------------------------------------------------------------------------
// Conversion vers le format de niveau
// ---------------------------------------------------------------------------

/** Fusionne les cases de mur voisines de même couleur en portes. */
function portesFusionnees() {
  const gates = [];
  for (const side of COTES) {
    const cells = etat.portes[side];
    let i = 0;
    while (i < cells.length) {
      if (cells[i] === null) { i++; continue; }
      let len = 1;
      while (i + len < cells.length && cells[i + len] === cells[i]) len++;
      gates.push({ side, start: i, length: len, color: cells[i] });
      i += len;
    }
  }
  return gates;
}

/** Objet niveau au format `GET /api/level/{n}` (doc §6.1). */
export function versNiveau() {
  const jouables = etat.blocks.filter((b) => b.kind !== KIND.WALL).length;
  const base = Math.max(4, jouables);
  return {
    levelId: 'custom',
    number: 0,
    realm: 'Éditeur',
    difficulty: 'sur mesure',
    width: etat.W,
    height: etat.H,
    colorCount: COLORS.length,
    moveLimit: Math.round(base * 2.2) + 3,
    timeLimit: Math.max(45, base * 10),
    minDrags: base,
    objective: { type: 'clear_all', target: jouables },
    starDrags: [Math.ceil(base * 1.3), Math.ceil(base * 1.8)],
    estimatedTime: Math.max(45, base * 10),
    gates: portesFusionnees(),
    blocks: etat.blocks.map((b) => ({ ...b })),
    solution: [], // pas de solution de référence : l'indice passe par le solveur
  };
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

function construirePalettes() {
  const formes = el('ed-shapes');
  formes.replaceChildren(...SHAPES.map((sh, i) => {
    const b = document.createElement('button');
    b.className = 'ed-shape';
    b.title = sh.key;
    const g = document.createElement('span');
    g.style.gridTemplateColumns = `repeat(${sh.w}, 7px)`;
    g.style.gridTemplateRows = `repeat(${sh.h}, 7px)`;
    for (let y = 0; y < sh.h; y++) {
      for (let x = 0; x < sh.w; x++) {
        const c = document.createElement('i');
        if (sh.cells.some(([a, d]) => a === x && d === y)) c.className = 'on';
        g.appendChild(c);
      }
    }
    b.appendChild(g);
    b.onclick = () => { choix.shape = i; majPalettes(); };
    return b;
  }));

  const couleurs = el('ed-colors');
  couleurs.replaceChildren(...COLORS.map((c, i) => {
    const b = document.createElement('button');
    b.className = `ed-color c${i}`;
    b.title = c.name;
    b.textContent = c.glyph;
    b.onclick = () => { choix.color = i; majPalettes(); };
    return b;
  }));

  const natures = el('ed-kinds');
  natures.replaceChildren(...NATURES.map((n, i) => {
    const b = document.createElement('button');
    b.className = 'ed-kind';
    b.textContent = n.label;
    b.onclick = () => { choix.nature = i; majPalettes(); };
    return b;
  }));

  majPalettes();
}

function majPalettes() {
  [...el('ed-shapes').children].forEach((b, i) => b.classList.toggle('sel', i === choix.shape));
  [...el('ed-colors').children].forEach((b, i) => b.classList.toggle('sel', i === choix.color));
  [...el('ed-kinds').children].forEach((b, i) => b.classList.toggle('sel', i === choix.nature));
}

// ---------------------------------------------------------------------------
// Grille
// ---------------------------------------------------------------------------

function occupe(x, y) {
  return etat.blocks.find((b) => b.cells.some(([dx, dy]) => b.x + dx === x && b.y + dy === y));
}

function dessiner() {
  const grille = el('ed-grid');
  grille.style.setProperty('--ew', etat.W);
  grille.style.setProperty('--eh', etat.H);
  grille.replaceChildren();

  // Cases de mur : un appui fait défiler la couleur de la porte.
  for (const side of COTES) {
    etat.portes[side].forEach((color, i) => {
      const m = document.createElement('button');
      m.className = `ed-wall ed-wall-${side}` + (color !== null ? ` c${color} ouvert` : '');
      m.style.setProperty('--i', i);
      m.textContent = color !== null ? COLORS[color].glyph : '';
      m.onclick = () => {
        const suite = color === null ? choix.color : null;
        etat.portes[side][i] = suite;
        dessiner();
      };
      grille.appendChild(m);
    });
  }

  for (let y = 0; y < etat.H; y++) {
    for (let x = 0; x < etat.W; x++) {
      const bloc = occupe(x, y);
      const c = document.createElement('button');
      c.className = 'ed-cell';
      c.style.setProperty('--x', x);
      c.style.setProperty('--y', y);
      if (bloc) {
        c.classList.add('plein', `k-${bloc.kind}`);
        if (bloc.color >= 0 && bloc.kind !== KIND.JOKER) c.classList.add(`c${bloc.color}`);
        c.textContent = bloc.kind === KIND.WALL ? '' : bloc.kind === KIND.JOKER ? '✳'
          : bloc.kind === KIND.LOCKED ? '🔒'
          : bloc.kind === KIND.ANCRE ? { top: '▲', right: '▶', bottom: '▼', left: '◀' }[bloc.dir]
          : COLORS[bloc.color].glyph;
      }
      c.onclick = () => (bloc ? retirer(bloc) : poser(x, y));
      grille.appendChild(c);
    }
  }
  majEtat('');
}

function poser(x, y) {
  const forme = SHAPES[choix.shape];
  const nature = NATURES[choix.nature];
  if (x + forme.w > etat.W || y + forme.h > etat.H) { majEtat('La forme dépasse de la grille'); return; }
  if (forme.cells.some(([dx, dy]) => occupe(x + dx, y + dy))) { majEtat('Emplacement déjà occupé'); return; }

  etat.blocks.push({
    id: (etat.blocks.at(-1)?.id ?? 0) + 1,
    color: nature.kind === KIND.WALL ? -1 : choix.color,
    cells: forme.cells.map(([a, b]) => [a, b]),
    x, y,
    kind: nature.kind,
    axis: nature.axis || null,
    dir: nature.dir || null,
    condition: nature.kind === KIND.LOCKED ? { type: 'exits', count: choix.verrouCount } : null,
  });
  dessiner();
}

function retirer(bloc) {
  etat.blocks = etat.blocks.filter((b) => b !== bloc);
  dessiner();
}

// ---------------------------------------------------------------------------
// Boutons
// ---------------------------------------------------------------------------

function majEtat(message, ton = '') {
  const z = el('ed-status');
  z.textContent = message;
  z.className = 'ed-status' + (ton ? ` ${ton}` : '');
}

function brancherBoutons() {
  el('ed-w').onchange = () => redimensionner(Number(el('ed-w').value), etat.H);
  el('ed-h').onchange = () => redimensionner(etat.W, Number(el('ed-h').value));

  el('ed-clear').onclick = () => { etat = vide(etat.W, etat.H); dessiner(); };

  el('ed-check').onclick = () => {
    const niveau = versNiveau();
    if (!niveau.gates.length) { majEtat('Aucune porte : ouvrez au moins un passage', 'ko'); return; }
    if (!niveau.objective.target) { majEtat('Aucun bloc à sortir', 'ko'); return; }
    const r = resoudre(new Board({ ...niveau, moveLimit: 9999, timeLimit: 9999 }));
    if (r.resoluble) {
      majEtat(`Résoluble en ${r.ordre.length} sortie${r.ordre.length > 1 ? 's' : ''}`
        + ` (${r.etats} état${r.etats > 1 ? 's' : ''} exploré${r.etats > 1 ? 's' : ''})`, 'ok');
    } else if (r.abandon) {
      majEtat('Recherche interrompue : grille trop vaste pour être tranchée', 'ko');
    } else {
      majEtat('Non résolu. Le solveur ne déplace pas les blocs sans les sortir : '
        + 'une solution demandant de pousser un bloc de côté lui échappe.', 'ko');
    }
  };

  el('ed-test').onclick = () => {
    const niveau = versNiveau();
    if (!niveau.gates.length || !niveau.objective.target) {
      majEtat('Il faut au moins une porte et un bloc', 'ko');
      return;
    }
    onTester?.(niveau);
  };

  el('ed-export').onclick = async () => {
    const json = JSON.stringify(versNiveau(), null, 2);
    el('ed-json').value = json;
    el('ed-json').hidden = false;
    try {
      await navigator.clipboard.writeText(json);
      majEtat('JSON copié dans le presse-papiers', 'ok');
    } catch {
      majEtat('JSON affiché ci-dessous (copie manuelle)', 'ok');
    }
  };

  el('ed-import').onclick = () => {
    const zone = el('ed-json');
    zone.hidden = false;
    if (!zone.value.trim()) { majEtat('Collez un JSON de niveau dans la zone puis réappuyez'); return; }
    try {
      const n = JSON.parse(zone.value);
      etat = vide(n.width, n.height);
      etat.blocks = n.blocks.map((b) => ({ ...b }));
      for (const g of n.gates) {
        for (let k = 0; k < g.length; k++) etat.portes[g.side][g.start + k] = g.color;
      }
      el('ed-w').value = n.width;
      el('ed-h').value = n.height;
      dessiner();
      majEtat('Niveau importé', 'ok');
    } catch (e) {
      majEtat('JSON illisible : ' + e.message, 'ko');
    }
  };
}

function redimensionner(W, H) {
  W = Math.max(4, Math.min(8, W));
  H = Math.max(4, Math.min(9, H));
  const ancien = etat;
  etat = vide(W, H);
  // On garde ce qui tient encore dans la nouvelle grille.
  etat.blocks = ancien.blocks.filter((b) => {
    const maxX = Math.max(...b.cells.map((c) => c[0])) + b.x;
    const maxY = Math.max(...b.cells.map((c) => c[1])) + b.y;
    return maxX < W && maxY < H;
  });
  for (const side of COTES) {
    ancien.portes[side].forEach((c, i) => { if (i < etat.portes[side].length) etat.portes[side][i] = c; });
  }
  el('ed-w').value = W;
  el('ed-h').value = H;
  dessiner();
}
