/**
 * History of the grids created in the editor.
 *
 * A drawn level used to be lost when the editor closed: nothing kept it, and a
 * grid you had spent ten minutes on did not survive a trip back to the menu. So
 * every attempt is stored — both when testing it and when submitting it — so it
 * can be picked up again.
 *
 * Local storage, like the rest of the prototype. The list is bounded: beyond
 * that, the oldest drafts fall off. A history that grows forever ends up
 * saturating the browser's storage, and nobody rereads their twentieth draft.
 */

import { track } from '../data/events.js';

// Storage key kept as-is across the English rename: changing it would throw
// away every draft already saved on players' devices.
const KEY = 'puzzlequest.mesniveaux.v1';
const MAX = 12;

const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const write = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch { /* storage full or blocked: the editor carries on without history */ }
};

export const list = () => read();

/**
 * Stores a grid, or updates the one already carrying that id.
 *
 * Two successive attempts at the same grid must not produce two entries: the
 * editor keeps the id of what it loaded and passes it back here. Without that,
 * testing five times in a row filled the history with five near-identical
 * copies.
 *
 * @returns {string} the id, to be kept on the editor's side
 */
export function record(level, { id = null, title = '', submitted = false } = {}) {
  const l = read();
  const existing = id ? l.find((e) => e.id === id) : null;
  const entry = existing || { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` };

  Object.assign(entry, {
    title: (title || entry.title || '').slice(0, 40),
    updatedAt: new Date().toISOString(),
    width: level.width,
    height: level.height,
    blocks: level.blocks.filter((b) => b.kind !== 'wall').length,
    submitted: submitted || entry.submitted === true,
    level,
  });

  if (!existing) l.unshift(entry);
  else {
    // The most recently touched moves to the top: that is the one to resume.
    l.splice(l.indexOf(existing), 1);
    l.unshift(existing);
  }
  write(l);
  track('editor_draft_saved', { id: entry.id, blocks: entry.blocks });
  return entry.id;
}

export function load(id) {
  return read().find((e) => e.id === id) || null;
}

export function remove(id) {
  write(read().filter((e) => e.id !== id));
}

export function clear() {
  write([]);
}
