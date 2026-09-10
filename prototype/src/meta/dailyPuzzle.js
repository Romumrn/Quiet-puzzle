/**
 * Daily puzzle: the grids drawn by players.
 *
 * A level submitted from the editor joins a queue. Every day one grid is drawn
 * from it — the same for everybody — and each player runs it once, for a score
 * that mixes speed and economy of gestures. The day's scores form a
 * leaderboard.
 *
 * EVERYTHING IS LOCAL. This module plays the part a backend will hold: the
 * queue, the draw and the leaderboard live in `localStorage`, behind the same
 * signatures the REST routes will have. Two consequences worth knowing:
 *
 *  - the leaderboard only shows the scores from THIS browser. There is no
 *    server to send them to, and the prototype pretends nothing;
 *  - the AUTHOR of a submission and of a score is identified by a token drawn
 *    at random on first launch, not by their IP address. A web page does not
 *    know its own IP: only the server receiving the request sees it. The
 *    `author` field is therefore there, in the right place, ready to receive
 *    the IP server-side; filling it client-side would mean querying a third
 *    party on every game, which would send players off to be tracked elsewhere
 *    for nothing.
 */

import * as store from './../data/save.js';
import { track } from '../data/events.js';

const QUEUE_KEY = 'puzzlequest.dailypuzzle.v1';

const today = () => new Date().toISOString().slice(0, 10);

/** Small seeded RNG, so that the day's draw is the same for everyone. */
function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- Local store -----------------------------------------------------------

const empty = () => ({ version: 1, submissions: [], scores: {} });

function read() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    return empty();
  }
}

function write(data) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(data));
  } catch { /* storage full or blocked: the game carries on without */ }
}

/**
 * Author token, drawn on first use and kept with the save.
 *
 * It stands in for the identifier the backend will assign. See the module
 * header on the IP address question.
 */
export function author() {
  const d = store.load();
  if (!d.authorId) {
    d.authorId = 'p' + Math.random().toString(36).slice(2, 8);
    store.save(d);
  }
  return d.authorId;
}

// --- Submissions -----------------------------------------------------------

/**
 * Drops a level into the queue. The level is assumed VERIFIED: the editor runs
 * the solver before calling in here, and it alone knows whether the grid holds
 * up.
 *
 * @returns {{id:string, rank:number}} the assigned id and the rank in the queue
 */
export function submit(level, title) {
  const data = read();
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  data.submissions.push({
    id,
    title: (title || '').slice(0, 40),
    author: author(),
    submittedOn: today(),
    level,
  });
  write(data);
  track('daily_puzzle_submitted', { id, blocks: level.blocks.length });
  return { id, rank: data.submissions.length };
}

export const submissions = () => read().submissions;

// --- The daily puzzle ------------------------------------------------------

/**
 * Today's submission, or null if the queue is empty.
 *
 * The draw is seeded on the DATE: everybody plays the same grid on the same
 * day, and the result does not depend on the order in which the game was
 * opened. A queue with a single submission serves it up again every day, which
 * is the right behaviour: the same grid beats no grid.
 */
export function ofTheDay(date = today()) {
  const list = read().submissions;
  if (!list.length) return null;
  return list[seedOf(date) % list.length];
}

// --- Score and leaderboard -------------------------------------------------

/**
 * Score for one run of the daily puzzle.
 *
 * Two terms, and the order matters: we start from a base, subtract what the
 * superfluous gestures cost, then what the time costs. A player who thinks for
 * a long time but plays accurately therefore finishes ahead of a fast, sloppy
 * one — that is the hierarchy a puzzle game ought to reward.
 *
 * The score never drops below 100: a finished grid is always worth more than an
 * abandoned one, and a scale returning zero for a slow win would be insulting
 * without being informative.
 */
export const SCORING = Object.freeze({
  BASE: 1000,
  PER_WASTED_GESTURE: 25,
  PER_SECOND: 2,
  FLOOR: 100,
});

export function computeScore({ drags, minDrags, seconds }) {
  const wasted = Math.max(0, drags - minDrags);
  const raw = SCORING.BASE
    - wasted * SCORING.PER_WASTED_GESTURE
    - Math.round(seconds) * SCORING.PER_SECOND;
  return Math.max(SCORING.FLOOR, raw);
}

/**
 * Records a score. A player only keeps their BEST score of the day: replaying
 * must be able to improve it, never to degrade it.
 */
export function recordScore({ score, drags, seconds, date = today() }) {
  const data = read();
  const table = (data.scores[date] ||= []);
  const me = author();
  const existing = table.find((e) => e.author === me);
  if (existing) {
    if (score <= existing.score) return { improved: false, entry: existing };
    Object.assign(existing, { score, drags, seconds, at: Date.now() });
  } else {
    table.push({ author: me, score, drags, seconds, at: Date.now() });
  }
  write(data);
  track('daily_puzzle_scored', { score, drags, seconds });
  return { improved: true, entry: table.find((e) => e.author === me) };
}

/**
 * The day's leaderboard, best first. On equal scores, whoever played first
 * comes out ahead: two players with identical runs cannot be separated any
 * other way without inventing a criterion.
 */
export function leaderboard(date = today()) {
  const table = [...(read().scores[date] || [])];
  table.sort((a, b) => b.score - a.score || a.at - b.at);
  return table.map((e, i) => ({ ...e, rank: i + 1, me: e.author === author() }));
}

/** Has today's puzzle already been played? */
export function alreadyPlayed(date = today()) {
  return leaderboard(date).some((e) => e.me);
}

/** Wipes the queue and the scores — QA panel. */
export function reset() {
  write(empty());
}
