/**
 * Admin panel — the screen behind `src/data/admin.js`.
 *
 * Three tabs, one per thing an administrator actually does with this game:
 * moderate the grids players submit, decide which one is the puzzle of the day,
 * and look at the attempts the server found implausible.
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

let currentTab = 'moderation';
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

async function refreshStats() {
  const s = await admin.stats();
  const n = (v) => (v === null || v === undefined ? '—' : v);
  el('admin-stats').textContent = [
    t('admin.stat.levels', { n: n(s.levels) }),
    t('admin.stat.players', { n: n(s.players) }),
    t('admin.stat.queue', { n: n(s.submitted) }),
    t('admin.stat.flagged', { n: n(s.flagged) }),
  ].join(' · ');
}

/** Switches tab. The body is emptied first: a stale list reads as a fresh one. */
async function show(tab) {
  currentTab = tab;
  for (const b of el('admin-tabs').children) {
    b.classList.toggle('sel', b.dataset.tab === tab);
  }
  const body = el('admin-body');
  body.replaceChildren(loading());
  if (tab === 'moderation') await renderModeration(body);
  else if (tab === 'daily') await renderDaily(body);
  else await renderFlagged(body);
}

const loading = () => {
  const p = document.createElement('p');
  p.className = 'admin-empty';
  p.textContent = t('admin.loading');
  return p;
};

const emptyLine = (key) => {
  const p = document.createElement('p');
  p.className = 'admin-empty';
  p.textContent = t(key);
  return p;
};

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

async function renderModeration(body) {
  const queue = await admin.moderationQueue();
  body.replaceChildren();
  if (!queue.length) { body.append(emptyLine('admin.queue.empty')); return; }

  for (const entry of queue) {
    const card = document.createElement('article');
    card.className = 'admin-card';

    const title = document.createElement('b');
    title.textContent = entry.title || t('editor.untitled');

    const meta = document.createElement('small');
    const grid = entry.grid || {};
    const blocks = Array.isArray(grid.blocks) ? grid.blocks.length : '?';
    meta.textContent = `${grid.width ?? '?'}×${grid.height ?? '?'} · `
      + t('editor.blocks', { n: blocks }) + ` · ${entry.created_at?.slice(0, 10) ?? ''}`;

    const actions = document.createElement('div');
    actions.className = 'admin-actions';

    const decide = (status, labelKey) => {
      const b = document.createElement('button');
      b.className = 'btn btn-ghost btn-sm';
      b.textContent = t(labelKey);
      b.onclick = async () => {
        b.disabled = true;
        const notes = status === 'rejected' ? (prompt(t('admin.reject.ask'), '') ?? '') : '';
        const r = await admin.moderate(entry.id, status, notes);
        if (r.ok) {
          toast(t('admin.done'));
          card.remove();
          refreshStats();
          if (!body.children.length) body.append(emptyLine('admin.queue.empty'));
        } else {
          b.disabled = false;
          toast(t('admin.failed', { error: r.error ?? '' }), 3200);
        }
      };
      return b;
    };

    actions.append(decide('approved', 'admin.approve'), decide('rejected', 'admin.reject'));
    card.append(title, meta, actions);
    body.append(card);
  }
}

// ---------------------------------------------------------------------------
// Daily puzzle
// ---------------------------------------------------------------------------

async function renderDaily(body) {
  const calendar = await admin.dailyCalendar();
  body.replaceChildren();

  // The form comes first: this tab exists to SET a puzzle, the calendar below
  // is there to check what was set.
  const form = document.createElement('div');
  form.className = 'admin-form';

  const date = document.createElement('input');
  date.type = 'date';
  date.value = new Date().toISOString().slice(0, 10);

  const mode = document.createElement('select');
  mode.append(...modes.map((m) => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.name?.en || m.name?.fr || m.code;
    return o;
  }));

  const levelId = document.createElement('input');
  levelId.type = 'number';
  levelId.min = '1';
  levelId.placeholder = t('admin.daily.levelId');

  const apply = document.createElement('button');
  apply.className = 'btn btn-primary btn-sm';
  apply.textContent = t('admin.daily.apply');
  apply.onclick = async () => {
    apply.disabled = true;
    const id = Number(levelId.value);
    const r = await admin.setDailyPuzzle(date.value, Number(mode.value),
      id > 0 ? { levelId: id } : {});
    apply.disabled = false;
    if (r.ok) { toast(t('admin.done')); await show('daily'); }
    else toast(t('admin.failed', { error: r.error ?? '' }), 3200);
  };

  const note = document.createElement('p');
  note.className = 'admin-note';
  note.textContent = t('admin.daily.note');

  form.append(date, mode, levelId, apply);
  body.append(form, note);

  if (!calendar.length) { body.append(emptyLine('admin.daily.empty')); return; }

  const list = document.createElement('ol');
  list.className = 'admin-list';
  for (const row of calendar) {
    const li = document.createElement('li');
    const when = document.createElement('b');
    when.textContent = row.puzzle_date;
    const what = document.createElement('span');
    what.textContent = `${row.source_type} #${row.level_id ?? row.community_level_id ?? '—'}`
      + ` · ${row.selected_by}`;
    li.append(when, what);
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

  const list = document.createElement('ol');
  list.className = 'admin-list';
  for (const row of rows) {
    const li = document.createElement('li');
    const who = document.createElement('b');
    who.textContent = `#${row.level_id}`;
    const what = document.createElement('span');
    what.textContent = t('admin.flagged.line', {
      moves: row.moves, time: Math.round(row.time_ms / 100) / 10,
      stars: row.stars, date: row.created_at?.slice(0, 10) ?? '',
    });
    li.append(who, what);
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
