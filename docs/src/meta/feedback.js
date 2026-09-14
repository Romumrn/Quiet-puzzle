/**
 * Reports: bugs, suggestions, remarks.
 *
 * The player writes, attaches screenshots if they want, and leaves with a
 * complete report. What this module does NOT do, and this is the part to
 * understand: it sends nothing. The prototype has no server, and nothing leaves
 * a browser without a recipient.
 *
 * So it prepares the report and lets the player choose their route: copy it,
 * download it, or open their mail client with the text already written.
 * Screenshots can only travel through the downloaded file — no `mailto:` knows
 * how to attach anything.
 *
 * The TECHNICAL CONTEXT is attached automatically: version, language, screen,
 * current level, window size, browser. That is what is always missing from a
 * bug report, and what nobody thinks to provide.
 */

import * as store from '../data/save.js';
import { track } from '../data/events.js';

const KEY = 'puzzlequest.feedback.v1';
const MAX = 20;

/** Offered categories. The id goes into the report, not the label. */
export const CATEGORIES = ['bug', 'idea', 'other'];

/**
 * Screenshots are NOT kept in local storage: a few phone images in base64
 * exceed a browser's quota on their own, and the history would become the
 * reason the game stops saving. They live for the duration of the writing, and
 * travel in the exported file.
 */
const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const l = raw ? JSON.parse(raw) : [];
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
};

const write = (l) => {
  try { localStorage.setItem(KEY, JSON.stringify(l.slice(0, MAX))); } catch { /* quota */ }
};

/** What the developer will want to know and the player will not think to say. */
export function context(extra = {}) {
  const d = store.load();
  return {
    version: 'prototype',
    date: new Date().toISOString(),
    language: d.language || 'auto',
    unlockedLevel: d.unlockedLevel,
    coins: d.coins,
    glyphs: d.glyphs === true,
    screen: typeof window === 'undefined' ? null
      : `${window.innerWidth}×${window.innerHeight}`,
    browser: typeof navigator === 'undefined' ? null : navigator.userAgent,
    ...extra,
  };
}

/**
 * Composes the report. `screenshots` is a list of { name, type, size, data },
 * `data` being a `data:` URI — that is the form in which whoever receives the
 * file can read them back.
 */
export function compose({ category, message, screenshots = [], extra = {} }) {
  return {
    category: CATEGORIES.includes(category) ? category : 'other',
    message: String(message || '').slice(0, 4000),
    context: context(extra),
    screenshots,
  };
}

/** Stores the report, without its screenshots. @returns {string} id */
export function record(report) {
  const l = read();
  const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  l.unshift({
    id,
    category: report.category,
    message: report.message,
    context: report.context,
    screenshots: report.screenshots.length,   // the count, not the images
  });
  write(l);
  track('feedback_submitted', { id, category: report.category, screenshots: report.screenshots.length });
  return id;
}

export const list = () => read();
export const clear = () => write([]);

/** The report as readable text — this is what goes into an e-mail. */
export function asText(report) {
  const lines = [
    `[${report.category}] Quiet Puzzle`,
    '',
    report.message,
    '',
    '--- context ---',
    ...Object.entries(report.context).map(([k, v]) => `${k}: ${v}`),
  ];
  if (report.screenshots.length) {
    lines.push('', `${report.screenshots.length} screenshot(s) in the attached file.`);
  }
  return lines.join('\n');
}
