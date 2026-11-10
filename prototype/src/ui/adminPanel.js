/**
 * Admin panel — the screen behind `src/data/admin.js`.
 *
 * Three tabs, one per thing an administrator actually does with this game:
 * watch the grids players publish (since 2026-11-10 they go live on their own
 * from 6 moves, so the job is taking the odd bad one out), look at and set the
 * puzzle of the day, and look at the attempts the server found implausible.
 *
 * It only ever appears for an account that holds the admin role, and it renders
 * nothing on its own: every list comes from Supabase, filtered server-side by
 * RLS. When a call is refused, the refusal is shown as-is rather than swallowed
 * — an admin tool that hides its errors is worse than no tool.
 */

import * as admin from '../data/admin.js';
import { t } from './i18n.js';
import { toast } from './screens.js';

const el = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);

let currentTab = 'community';
let filter = 'all';
let modes = [];

/** Opens the panel and loads the current tab. */
export async function open() {
  el('overlay-admin').hidden = false;
  const user = await admin.currentUser();
  el('admin-who').textContent = user?.email || user?.id || '—';
  refreshStats();
  if (!modes.length) modes = await admin.gameModes();
  await show(currentTab);
}

export function close() {
  el('overlay-admin').hidden = true;
}

/** Four tiles: what the game holds, at a glance. */
async function refreshStats() {
  const s = await admin.stats();
  const n = (v) => (v === null || v === undefined ? '—' : v);
  el('admin-stats').replaceChildren(...[
    ['admin.stat.levels', s.levels],
    ['admin.stat.players', s.players],
    ['admin.stat.community', s.approved],
    ['admin.stat.flagged', s.flagged],
  ].map(([key, v]) => {
    const tile = node('div', 'admin-stat');
    tile.append(node('b', '', n(v)), node('small', '', t(key)));
    return tile;
  }));
}

/** Switches tab. The body is emptied first: a stale list reads as a fresh one. */
async function show(tab) {
  currentTab = tab;
  for (const b of el('admin-tabs').children) {
    b.classList.toggle('sel', b.dataset.tab === tab);
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  const body = el('admin-body');
  body.replaceChildren(emptyLine('admin.loading'));
  if (tab === 'community') await renderCommunity(body);
  else if (tab === 'daily') await renderDaily(body);
  else await renderFlagged(body);
}

function node(tag, className = '', text = null) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== null) n.textContent = text;
  return n;
}

const emptyLine = (key) => node('p', 'admin-empty', t(key));

const shortDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short' });
  } catch {
    return iso.slice(0, 10);
  }
};

const dailyMode = () => modes.find((m) => m.code === 'daily')?.id ?? modes[0]?.id;

/**
 * A grid drawn small: cells, blocks in their colours, the gates as bars on the
 * border — enough to recognise a grid and spot an obvious mess.
 */
function preview(grid) {
  const W = grid?.width || 0, H = grid?.height || 0;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'admin-thumb');
  svg.setAttribute('aria-hidden', 'true');
  if (!W || !H) return svg;
  const S = 10, P = 2;
  svg.setAttribute('viewBox', `${-P} ${-P} ${W * S + 2 * P} ${H * S + 2 * P}`);
  const rect = (x, y, w, h, fill, rx = 0, cls = '') => {
    const r = document.createElementNS(svg.namespaceURI, 'rect');
    Object.entries({ x, y, width: w, height: h, rx }).forEach(([k, v]) => r.setAttribute(k, v));
    if (fill) r.style.fill = fill;
    if (cls) r.setAttribute('class', cls);
    svg.append(r);
  };
  rect(0, 0, W * S, H * S, null, 2, 'admin-thumb-ground');
  for (const g of grid.gates || []) {
    const fill = `var(--c${g.color})`;
    const a = g.start * S + 1, len = g.length * S - 2;
    if (g.side === 'top') rect(a, -P, len, P, fill);
    else if (g.side === 'bottom') rect(a, H * S, len, P, fill);
    else if (g.side === 'left') rect(-P, a, P, len, fill);
    else rect(W * S, a, P, len, fill);
  }
  for (const b of grid.blocks || []) {
    const fill = b.kind === 'wall' ? 'var(--ink-faint)' : b.kind === 'joker' ? 'var(--ink-soft)' : `var(--c${b.color})`;
    for (const [dx, dy] of b.cells || [[0, 0]]) rect((b.x + dx) * S + 0.8, (b.y + dy) * S + 0.8, S - 1.6, S - 1.6, fill, 2.4);
  }
  return svg;
}

/** A small pill: what state a grid or a day is in. */
const chip = (text, tone) => node('span', `admin-chip ${tone}`, text);

/**
 * A button that runs `action` and says how it went. `action` returns
 * `{ ok, error }`, like every write in admin.js.
 */
function actionButton(label, kind, action, after) {
  const b = node('button', `btn btn-sm ${kind}`, label);
  b.onclick = async () => {
    b.disabled = true;
    const r = await action();
    if (r === null) { b.disabled = false; return; } // cancelled
    if (r.ok) { toast(t('admin.done')); await after?.(); }
    else { b.disabled = false; toast(t('admin.failed', { error: r.error ?? '' }), 3200); }
  };
  return b;
}

// ---------------------------------------------------------------------------
// Community grids
// ---------------------------------------------------------------------------

const FILTERS = {
  all: () => true,
  live: (e, featured) => e.status === 'approved' && !featured.has(e.id),
  featured: (e, featured) => featured.has(e.id),
  pending: (e) => e.status === 'submitted',
  removed: (e) => e.status === 'rejected' || e.status === 'archived',
};

async function renderCommunity(body) {
  const [levels, calendar] = await Promise.all([admin.communityLevels(), admin.dailyCalendar()]);
  // When each grid is, or was, the puzzle of the day.
  const featured = new Map(calendar.filter((r) => r.community_level_id).map((r) => [r.community_level_id, r.puzzle_date]));
  body.replaceChildren();

  const bar = node('div', 'admin-filters');
  for (const key of Object.keys(FILTERS)) {
    const n = levels.filter((e) => FILTERS[key](e, featured)).length;
    const b = node('button', `admin-filter${key === filter ? ' sel' : ''}`, `${t(`admin.filter.${key}`)} · ${n}`);
    b.onclick = () => { filter = key; renderCommunity(body); };
    bar.append(b);
  }
  body.append(bar);

  const shown = levels.filter((e) => FILTERS[filter](e, featured));
  if (!shown.length) { body.append(emptyLine('admin.community.empty')); return; }

  const reload = async () => { refreshStats(); await renderCommunity(body); };
  for (const entry of shown) {
    const grid = entry.grid || {};
    const card = node('article', 'admin-item');
    const text = node('div', 'admin-item-text');
    text.append(node('b', 'admin-item-title', entry.title || t('editor.untitled')));

    const author = entry.creator?.username;
    const facts = [
      author && t('admin.by', { name: author }),
      `${grid.width ?? '?'}×${grid.height ?? '?'}`,
      grid.minDrags && t('admin.moves', { n: grid.minDrags }),
      shortDate(entry.created_at),
    ].filter(Boolean).join(' · ');
    text.append(node('small', 'admin-item-meta', facts));

    const day = featured.get(entry.id);
    const state = node('div', 'admin-item-state');
    if (day) state.append(chip(t(day > today() ? 'admin.status.scheduled' : 'admin.status.featured', { date: shortDate(day) }), 'blue'));
    else state.append(chip(t(`admin.status.${entry.status}`), {
      approved: 'green', submitted: 'amber', rejected: 'red', archived: 'grey', published: 'green',
    }[entry.status] || 'grey'));
    if (entry.moderation_notes) state.append(node('small', 'admin-item-note', entry.moderation_notes));
    text.append(state);

    const actions = node('div', 'admin-actions');
    if (entry.status === 'approved' || entry.status === 'published') {
      actions.append(actionButton(t('admin.unpublish'), 'btn-ghost admin-danger', () => {
        const notes = prompt(t('admin.unpublish.ask'), '');
        return notes === null ? null : admin.moderate(entry.id, 'rejected', notes);
      }, reload));
      if (!day) {
        actions.append(actionButton(t('admin.schedule'), 'btn-ghost', () => {
          const date = prompt(t('admin.schedule.ask'), today());
          return date ? admin.setDailyPuzzle(date.trim(), dailyMode(), { communityLevelId: entry.id }) : null;
        }, reload));
      }
    } else {
      actions.append(actionButton(t('admin.approve'), 'btn-primary', () => admin.moderate(entry.id, 'approved'), reload));
    }
    text.append(actions);
    card.append(preview(grid), text);
    body.append(card);
  }
}

// ---------------------------------------------------------------------------
// Daily puzzle
// ---------------------------------------------------------------------------

async function renderDaily(body) {
  const [calendar, levels] = await Promise.all([admin.dailyCalendar(), admin.communityLevels()]);
  const titles = new Map(levels.map((e) => [e.id, e.title]));
  body.replaceChildren();

  // The form comes first: this tab exists to SET a puzzle, the calendar below
  // is there to check what was set.
  const form = node('div', 'admin-form');
  const field = (labelKey, input) => {
    const label = node('label', 'admin-field');
    label.append(node('span', '', t(labelKey)), input);
    return label;
  };

  const date = node('input');
  date.type = 'date';
  date.value = today();

  const levelId = node('input');
  levelId.type = 'number';
  levelId.min = '1';
  levelId.inputMode = 'numeric';
  levelId.placeholder = t('admin.daily.auto');

  const apply = actionButton(t('admin.daily.apply'), 'btn-primary', () => {
    const id = Number(levelId.value);
    return admin.setDailyPuzzle(date.value, dailyMode(), id > 0 ? { levelId: id } : {});
  }, () => show('daily'));

  form.append(field('admin.daily.date', date), field('admin.daily.levelId', levelId), apply);
  body.append(form, node('p', 'admin-note', t('admin.daily.note')));

  if (!calendar.length) { body.append(emptyLine('admin.daily.empty')); return; }

  const list = node('ol', 'admin-days');
  for (const row of [...calendar].sort((a, b) => b.puzzle_date.localeCompare(a.puzzle_date))) {
    const li = node('li', row.puzzle_date === today() ? 'today' : row.puzzle_date > today() ? 'future' : '');
    const community = row.source_type === 'community_level';
    const when = node('b', 'admin-day-date', row.puzzle_date === today() ? t('admin.daily.today') : shortDate(row.puzzle_date));
    const what = node('span', 'admin-day-what', community
      ? (titles.get(row.community_level_id) || t('editor.untitled'))
      : t('admin.daily.level', { id: row.level_id }));
    li.append(when, chip(t(community ? 'admin.daily.community' : 'admin.daily.official'), community ? 'blue' : 'grey'), what,
      node('small', 'admin-day-by', row.selected_by));
    list.append(li);
  }
  body.append(list);
}

// ---------------------------------------------------------------------------
// Flagged attempts
// ---------------------------------------------------------------------------

async function renderFlagged(body) {
  const rows = await admin.flaggedAttempts();
  body.replaceChildren();
  if (!rows.length) { body.append(emptyLine('admin.flagged.empty')); return; }

  body.append(node('p', 'admin-note', t('admin.flagged.note')));
  const list = node('ol', 'admin-days');
  for (const row of rows) {
    const li = node('li');
    li.append(
      node('b', 'admin-day-date', `#${row.level_id}`),
      node('span', 'admin-day-what', t('admin.flagged.line', {
        moves: row.moves, time: Math.round(row.time_ms / 100) / 10,
        stars: row.stars, date: shortDate(row.created_at),
      })),
    );
    list.append(li);
  }
  body.append(list);
}

// ---------------------------------------------------------------------------
// Wiring — done once, at module load
// ---------------------------------------------------------------------------

export function wire() {
  el('admin-close').onclick = close;
  for (const b of el('admin-tabs').children) {
    b.onclick = () => show(b.dataset.tab);
  }
}
