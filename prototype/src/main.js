/**
 * GameManager — equivalent of Scripts/Managers/GameManager.cs (tech doc §4)
 *
 * Entry point and coordinator: sequences the screens, instantiates the board,
 * relays the player's gestures to the logic and then the events to the
 * rendering, and runs the clock. All the game rules live in core/, all the
 * board's DOM in render/: this file only wires them together.
 */

import { Board } from './core/board.js';
import { GameState } from './core/gameState.js';
import * as levels from './data/levelStore.js';
import * as i18n from './ui/i18n.js';
const { t } = i18n;
import { KIND } from './core/block.js';
import { BoardView, setSpeed } from './render/boardView.js';
import { InputHandler } from './input/input.js';
import * as api from './data/api.js';
import * as lives from './meta/lives.js';
import * as livesUI from './ui/livesUI.js';
import * as store from './data/save.js';
import * as screens from './ui/screens.js';
import * as mapScreen from './ui/mapScreen.js';
import * as theme from './ui/theme.js';
import * as bloom from './meta/bloom.js';
import * as editor from './ui/editor.js';
import { solve } from './core/solver.js';
import * as hud from './ui/gameplayUI.js';
import * as result from './ui/resultScreen.js';
import * as realmComplete from './ui/realmComplete.js';
import { AdBroker, PLACEMENT } from './monetization/brokerManager.js';
import * as currency from './monetization/currency.js';
import * as failOffer from './monetization/failOffer.js';
import * as daily from './meta/daily.js';
import * as dailyPuzzle from './meta/dailyPuzzle.js';
import * as streakBonus from './meta/streakBonus.js';
import * as leaderboard from './meta/leaderboard.js';
import * as quests from './meta/quests.js';
import * as blockInfo from './ui/blockInfo.js';
import { EVENTS as EV, levelContext } from './data/analytics.js';
import * as feedback from './meta/feedback.js';
import { track, recent, subscribe } from './data/events.js';
import { AudioManager } from './audio/audioManager.js';
import * as haptics from './audio/haptics.js';
import { supabase } from './data/supabaseClient.js';
import { createLoginScreen } from './ui/loginScreen.js';
import * as admin from './data/admin.js';
import * as adminPanel from './ui/adminPanel.js';
import { isNative } from './native/capacitor.js';
import { registerBackHandler, registerLifecycle } from './native/lifecycle.js';
import * as confetti from './render/confetti.js';
import { Browser } from '../vendor/capacitor-browser.esm.js';
import { Share } from '../vendor/capacitor-share.esm.js';

const el = (id) => document.getElementById(id);

// The "device frame" look (styles/main.css `.device`) simulates a phone on
// the published desktop web page. Inside the packaged app there is no page
// to frame — the app IS the whole screen, of whatever aspect ratio the
// device has, so that look must be dropped before first paint.
if (isNative()) document.documentElement.classList.add('native-app');

let view = null;
let input = null;
let board = null;
let level = null;
/** The current submission when playing the daily puzzle, otherwise null. */
let dailyEntry = null;
/** The current draft when trying out a grid from the editor, otherwise null. */
let editorTrial = null;
let clock = null;
/** The shortest clock a level ever starts with, in seconds. */
const MIN_TIME_S = 60;
let busy = false;
let offerUsed = false;    // the continue offer is worth one use per attempt
let levelFailures = 0;    // used so the very first defeat is never cut by an ad
let levelStartedAt = 0;
let lastContact = null; // the wall the dragged block last squashed against (feelContact)
let freebies = streakBonus.bonusFor(0); // boosters the win streak brought into this level

/**
 * Breathing room between the last block cleared and the success screen.
 *
 * Cutting straight there crushes the most rewarding moment of the game: the
 * player sees their last block cross the gate, hears its chime, and the screen
 * lands on them before they have had time to enjoy it. So we let the sound and
 * the animation settle, punctuate with the victory arpeggio, and only then
 * display.
 */
const PAUSE_BEFORE_SUCCESS = 780;   // ms, after the last block leaves
const PAUSE_AFTER_ARPEGGIO = 420;   // ms, between the arpeggio and the screen

/** In the background we do not wait: timers there are throttled to one second. */
const pause = (ms) => (document.hidden ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
let gestureRemembered = false;   // one snapshot per gesture, for undo
let directionBlockShown = false; // one "wrong way" toast per gesture, not one per pointermove
let hammerMode = false;

const audio = new AudioManager();

const ads = new AdBroker({
  overlay: el('overlay-ad'),
  banner: el('banner'),
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

async function showMenu() {
  stopClock();
  const p = await api.getProfile();
  // The colour first, before the calls below that may wait on the network.
  theme.apply(p.currentLevel, { remember: true }); // the menu takes the colour of where the player is
  paintPlayLevel(p.currentLevel);
  el('menu-stars').textContent = p.totalStars;
  el('menu-coins').textContent = p.coins;
  await updateDailyPuzzleButton();
  updateQuestButton();
  updateStreakBadge();
  updateMuteDot();
  await updateGreeting();
  livesUI.refresh();
  screens.show('menu');
  theme.endBoot();
  audio.startMusic();
  updateBanner('menu');
}

/**
 * Streak badge, on the home screen — it also carries the daily gift, which
 * used to be a card of its own under the counters. While today's gift waits,
 * the badge lights up with its amount ("🔥 3 j · +12") and a tap claims it;
 * afterwards it just states the streak, and only from the second day: "1 day
 * streak" rewards nothing, it states that you are here.
 */
function updateStreakBadge() {
  const badge = el('streak-badge');
  const days = daily.streak();
  const gift = daily.canClaim();
  badge.classList.toggle('gift', gift);
  badge.hidden = !gift && days < 2;
  if (badge.hidden) return;
  const tier = daily.tierFor(days);
  const streak = `${tier?.badge || '🔥'} ${t('streak.badge', { n: Math.max(days, 1) })}`;
  badge.textContent = gift ? `${streak} · +${daily.todaysReward()}` : streak;
  badge.setAttribute('aria-label', gift ? t('menu.daily') : streak);
}

/** A tap on the badge: claims the gift if it waits, else says what comes next. */
function onStreakBadge() {
  if (daily.canClaim()) { claimDailyGift(); return; }
  const days = daily.streak();
  const next = daily.nextTier(days);
  if (next) screens.toast(t('streak.next', { n: next.days - days, what: rewardLabel(next.reward) }), 2200);
}

const rewardLabel = (r) => (r
  ? t(`streak.reward.${r.type}`, { n: r.amount ?? '' })
  : '');

/**
 * Pays out the streak rewards still owed.
 *
 * They are paid when the session opens rather than at the exact moment of the
 * tier: a player who opens the game on the eighth day without having opened it
 * on the seventh must get what they earned, otherwise the streak punishes what
 * it claims to reward.
 */
function payStreakRewards() {
  for (const tier of daily.rewardsDue()) {
    const r = tier.reward;
    if (r.type === 'coins') currency.credit(r.amount, 'streak_reward');
    else if (r.type === 'hints') {
      const d = store.load();
      d.hints = (d.hints || 0) + r.amount;
      store.save(d);
    } else if (r.type === 'badge') {
      const d = store.load();
      d.badges = [...new Set([...(d.badges || []), r.id])];
      store.save(d);
    }
    daily.markTierPaid(tier.days);
    screens.toast(t('streak.granted', { days: tier.days, what: rewardLabel(r) }));
  }
}

/**
 * Claims the gift. The badge pops (`claimed`) and settles back into a plain
 * streak counter: a control that vanished under the finger left the player
 * unsure of what happened.
 */
const GIFT_EXIT_MS = 420;

function claimDailyGift() {
  const badge = el('streak-badge');
  const amount = daily.claim();
  if (!amount) { updateStreakBadge(); return; }
  badge.classList.add('claimed');
  screens.toast(t('toast.daily', { n: amount, days: daily.streak() }), 2000);
  updateMenuCounters();
  setTimeout(() => {
    badge.classList.remove('claimed');
    updateStreakBadge();
  }, GIFT_EXIT_MS);
}

/** The banner only lives outside a game — the policy decides, not the caller. */
function updateBanner(screen) {
  ads.updateBanner(screen);
  el('app').classList.toggle('with-banner', !el('banner').hidden);
}

/**
 * The levels won for the first time since the map was last shown — one, or a
 * whole run of "Next". The next `showMap()` plays them all (stars, a line of
 * light through the run, each unlock), then forgets them: reopening the map
 * later does not replay anything.
 */
let mapRun = [];

/** Sounds and buzzes for the map's unlock (mapScreen.js). */
const MAP_FX = {
  star: (i) => { audio.chime(1 + i, 0.55); haptics.tick(); },
  // Unlock i of n: a long run climbs the scale and lands on the top note,
  // which a single unlock plays straight away.
  unlock: (i = 0, n = 1) => { audio.chime(5 - Math.min(3, n - 1 - i), 0.8); haptics.tick(); },
};

/**
 * Buzzes and sounds for the win sequence (resultScreen.js). The stars and the
 * counters are silent — a note per star and a ticking count, on top of the
 * victory arpeggio, were too much (playtest, 2026-09-30); a star still buzzes.
 */
const RESULT_FX = {
  star: () => haptics.tick(),
  pop: () => audio.chime(4, 0.5),
};

function showMap() {
  stopClock();
  result.hide();
  realmComplete.hide();
  const reveal = mapRun.length ? { run: mapRun, fx: MAP_FX } : null;
  mapRun = [];
  mapScreen.render(showBrief, reveal);
  livesUI.refresh();
  screens.show('map');
  updateBanner('map');
}

/**
 * Scenery behind the level brief and the result screen: 'branch' (the realm's
 * map branch), 'petals' (slow petals in the level's hue), or both.
 */
const BRIEF_DECOR = 'branch petals';

/**
 * Dresses `host` (which holds a `.brief-art`) with the scenery of level `n`'s
 * realm: the same branch image its stretch of the map carries. The path is
 * relative to styles/main.css, where the variable is used.
 */
function applyScenery(host, n) {
  const branch = String(levels.realmOf(Math.max(1, n || 1)).id % 50 + 1).padStart(2, '0');
  host.style.setProperty('--brief-branch', `url('../images/branches/branche-${branch}.webp')`);
  host.dataset.decor = BRIEF_DECOR;
}

async function showBrief(n) {
  stopClock();
  // Every map level comes through here. A daily puzzle or an editor trial the
  // player walked out of (back arrow) used to leave its flag set, since only
  // `finishLevel` cleared it: the next map level won was then scored as the
  // daily puzzle — the daily ranking popped up out of nowhere and the level's
  // own progress was never saved.
  dailyEntry = null;
  editorTrial = null;
  level = await api.getLevel(n);
  const rec = store.levelRecord(n);
  // The realm name comes from the CATALOGUE, not from the level: the database
  // stores it in every language, whereas `level.realm` is frozen at generation.
  el('brief-realm').textContent = i18n.realmText(levels.realmOf(n), 'name');
  applyScenery(el('screen-brief'), n);
  el('brief-number').textContent = n;
  screens.renderStars(el('brief-stars'), rec.stars);
  el('brief-objective').textContent = hud.labelFor(level);
  // No move limit any more: what the briefing shows is the 3-star target.
  // …and before the clock stops: the third star asks for both.
  const limit = Math.max(level.timeLimit || 0, MIN_TIME_S);
  el('brief-moves').textContent = level.starDrags?.[0]
    ? `${level.starDrags[0]} · ${Math.floor(limit / 60)}:${String(limit % 60).padStart(2, '0')}` : '—';
  el('brief-difficulty').textContent = i18n.realmText(levels.realmOf(n), 'difficulty');
  // The realm's novelty, announced at its first level only. A block kind never
  // seen must be named once; repeating it across the next nineteen levels would
  // turn the callout into scenery nobody reads any more.
  const novelty = el('brief-novelty');
  const realmEntry = (n - 1) % levels.levelsPerRealm() === 0 && levels.realmOf(n).introduces;
  novelty.hidden = !realmEntry;
  if (realmEntry) novelty.textContent = t('brief.new', { what: i18n.realmText(levels.realmOf(n), 'introduces') });
  el('brief-best').textContent = rec.bestScore ? t('brief.best', { n: rec.bestScore }) : '—';
  // The sawtooth's peaks — "hard" at the end of each cycle, "super hard" for
  // the realm's last level (see tierOf): the briefing screen says so before the player commits,
  // rather than letting them find out mid-game.
  const tier = levels.tierOf(n);
  el('brief-final').hidden = !tier;
  if (tier) el('brief-final').textContent = t(tier === 'superhard' ? 'brief.superhard' : 'brief.hard');
  el('brief-card').classList.toggle('final', tier === 'superhard');
  el('brief-card').classList.toggle('hard', tier === 'hard');
  showStreakBonus();
  theme.apply(n);
  livesUI.refresh();
  screens.show('brief');
  updateBanner('brief');
}

/**
 * The win streak on the briefing screen: the boosters it brings into this
 * level, or what one more win would bring. Map levels only — the streak is
 * theirs (see `usesLives`).
 */
function showStreakBonus() {
  const line = el('brief-streak');
  const streak = store.load().levelStreak || 0;
  const bonus = streakBonus.bonusFor(streak);
  const next = streakBonus.nextTier(streak);
  line.hidden = !level?.number || (streakBonus.isEmpty(bonus) && !streak);
  if (line.hidden) return;
  if (!streakBonus.isEmpty(bonus)) {
    line.textContent = t('brief.streak', { n: streak, what: streakBonus.describe(bonus) });
  } else {
    line.textContent = t('brief.streak.next', { n: next.at - streak, what: streakBonus.describe(streakBonus.bonusFor(next.at)) });
  }
  line.classList.toggle('on', !streakBonus.isEmpty(bonus));
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

/**
 * Interstitial when a level OPENS, and no longer when it ends.
 *
 * An ad landing on the success screen arrives at the exact moment the player
 * may decide they are done for the session: it cuts off their reward, and they
 * leave. Placed before the next grid, it catches somebody who has already
 * decided to carry on — the same inventory sold at the moment it costs least.
 *
 * Two kinds of level never show one: the editor's and the daily puzzle. They
 * are not part of the progression, and an ad in front of a grid you have just
 * drawn yourself would be absurd. A plain retry after a failure is exempt too:
 * we do not charge for a second go.
 */
async function adBeforeLevel() {
  if (!level?.number || editorTrial || dailyEntry) return;
  if (levelFailures > 0) return;
  // Best effort: `startLevel()` has already hidden the result screen, so an ad
  // failing here must not stop the new board from being built.
  try {
    await ads.showInterstitial({
      level: level.number,
      noAds: currency.hasRemovedAds(),
      firstFailureOfLevel: false,
    });
  } catch (e) {
    console.warn('interstitial failed, level starts anyway', e);
  }
}

/**
 * Whether the level being played spends hearts: map levels only. The daily
 * puzzle and the editor's trials sit outside the progression, and so outside
 * the lives.
 */
function usesLives() {
  return !editorTrial && !dailyEntry && level?.number > 0;
}

async function startLevel() {
  // No heart left: the "short break" card, and back to the map if the player
  // would rather wait.
  if (usesLives() && !lives.canPlay() && !await livesUI.pause()) {
    showMap();
    return;
  }
  openPanel(false);
  result.hide();
  realmComplete.hide();
  await adBeforeLevel();
  theme.apply(level.number);
  audio.resetRun();
  offerUsed = false;
  levelStartedAt = Date.now();
  // Read BEFORE anything can break the streak: it is what the player won.
  freebies = streakBonus.bonusFor(usesLives() ? store.load().levelStreak || 0 : 0);
  const retry = levelFailures > 0;
  track(retry ? EV.LEVEL_RESTARTED : EV.LEVEL_STARTED,
    levelContext(level, { attempt: levelFailures + 1 }));
  // The first level doubles as the tutorial: this game has no other, and the
  // acquisition funnel needs that landmark.
  if (level.number === 1 && !retry) track(EV.TUTORIAL_STARTED, levelContext(level));
  // Never under a minute on the clock, whatever the level says — the map's
  // levels all start above it already; the editor's and the daily puzzle's
  // grids could go down to 45 s.
  if (!(level.timeLimit >= MIN_TIME_S)) level = { ...level, timeLimit: MIN_TIME_S };
  board = new Board(level);
  board._solver = { solve }; // editor levels: no reference solution
  hud.mount(level, usesLives() ? store.load().levelStreak || 0 : 0);
  hud.update(board);
  screens.show('game');

  // Mounted synchronously: certainly not inside a requestAnimationFrame, which
  // does not fire while the tab is in the background — the board would stay
  // empty.
  if (!view) {
    view = new BoardView(el('board'));
    input = new InputHandler(view, { onDrag, onEnd, canGrab, onRefused });
  }
  view.mount(board);
  hud.update(board);
  const boosters = boostersUnlocked();
  el('btn-hint').parentElement.classList.toggle('no-boosters', !boosters);
  updateBoosters();
  if (boosters) await introduceBoosters();
  busy = false;
  input.locked = false;
  updateBanner('game');
  startClock();
}

/**
 * State of the booster bar. A hint is paid in coins while there are any, and
 * falls back on a rewarded ad when the player is broke — better an ad than a
 * stuck player who uninstalls. The other three boosters are only ever obtained
 * in exchange for a rewarded ad.
 */
function updateBoosters() {
  const broke = !currency.canAfford(currency.PRICES.HINT);
  badge('hint-cost', freebies.hint + stock('hint'), broke ? t('ad.badge') : currency.PRICES.HINT, broke);
  badge('hammer-cost', freebies.hammer + stock('hammer'), t('ad.badge'), true);
  badge('undo-cost', freebies.undo, t('ad.badge'), true);
  el('btn-undo').disabled = !board || !board.canUndo();
}

/** A booster's price tag — or "×n" while the win streak still pays for it. */
function badge(id, free, price, isAd) {
  const cost = el(id);
  cost.textContent = free ? `×${free}` : price;
  cost.classList.toggle('free', free > 0);
  cost.classList.toggle('ad', !free && isAd);
}

/**
 * Boosters the player OWNS, kept in the save across levels — won on the daily
 * puzzle (`dailyReward()`) or on a daily-streak tier. Undo has no stock.
 */
const STOCK = { hint: 'hints', hammer: 'hammers' };
const stock = (kind) => (STOCK[kind] && store.load()[STOCK[kind]]) || 0;

/** Spends one free booster of this kind: the streak's first, then the stock. */
function useFreebie(kind) {
  if (freebies[kind]) {
    freebies[kind]--;
    track('streak_bonus_used', { type: kind, level: level?.number });
    return true;
  }
  if (!stock(kind)) return false;
  const d = store.load();
  d[STOCK[kind]]--;
  store.save(d);
  track('stock_booster_used', { type: kind, level: level?.number });
  return true;
}

/**
 * Boosters show up from this level on. Before it, the bar holds Restart alone:
 * a first-time player has the board to learn, and four unexplained buttons
 * with ad badges were the first thing testers asked about.
 */
const BOOSTERS_FROM = 5;

function boostersUnlocked() {
  return (level?.number || store.load().unlockedLevel || 1) >= BOOSTERS_FROM;
}

/**
 * The day the boosters appear: one card that says what each one does. Resolves
 * once it is closed, so the clock does not run while the player reads.
 */
async function introduceBoosters() {
  const d = store.load();
  if (d.boostersIntro) return;
  d.boostersIntro = true;
  store.save(d);
  el('info-icon').replaceChildren(el('btn-hint').querySelector('svg').cloneNode(true));
  el('info-title').textContent = t('boosters.intro.title');
  el('info-text').textContent = t('boosters.intro.text');
  el('overlay-info').hidden = false;
  track('boosters_introduced', { level: level?.number });
  await new Promise((resolve) => {
    const close = () => { el('overlay-info').hidden = true; resolve(); };
    el('btn-info-ok').onclick = close;
    el('overlay-info').onclick = (ev) => { if (!el('info-card').contains(ev.target)) close(); };
  });
}

/**
 * Watches a rewarded ad for a booster. The clock is suspended meanwhile.
 *
 * A real AdMob rewarded unit can fail to load for reasons that have nothing
 * to do with this code — no fill, a brand new ad unit still ramping up,
 * network trouble — and used to fail SILENTLY: the button just did nothing,
 * indistinguishable from being broken. Same toast the coin shop already uses
 * for its own rewarded ad (`shop.ad.failed`).
 */
async function boosterByAd(placement) {
  stopClock();
  const watched = await ads.showRewarded(placement);
  if (board?.gameState === GameState.PLAYING) startClock();
  if (!watched) screens.toast(t('shop.ad.failed'));
  return watched;
}

function canGrab(id) {
  const b = board.blocks.get(id);
  return !!b && board.canMove(b);
}

/** Grab refused: explain why rather than doing nothing. */
function onRefused(id) {
  const b = board.blocks.get(id);
  if (!b) return;
  view.bump(id);
  haptics.refused();
  // A sealed or locked block cannot be dragged at all: pressing it is asking
  // what it is. Same card as a tap on any other special block.
  showBlockInfo(id);
}

/**
 * A copy of the block as drawn on the board — its colour, its arrows, its
 * speed lines — shrunk to fit the card: the explanation must show THE block
 * the player tapped, not a symbol of it.
 */
function blockPreview(id) {
  const source = view?.nodes.get(id);
  if (!source) return null;
  const w = source.offsetWidth, h = source.offsetHeight;
  const scale = Math.min(1, 84 / Math.max(w, h));
  const copy = source.cloneNode(true);
  copy.classList.remove('grabbed', 'selected', 'hint');
  Object.assign(copy.style, { position: 'relative', transform: 'none', animation: 'none' });
  const frame = document.createElement('div');
  frame.className = 'info-preview';
  frame.style.setProperty('--cell', `${view.cell}px`);
  Object.assign(frame.style, { width: `${w * scale}px`, height: `${h * scale}px` });
  const inner = document.createElement('div');
  Object.assign(inner.style, { width: `${w}px`, height: `${h}px`, transform: `scale(${scale})`, transformOrigin: '0 0' });
  inner.append(copy);
  frame.append(inner);
  return frame;
}

/**
 * What a special block does (ui/blockInfo.js), on a tap. The clock stops while
 * the card is open: reading the rules is not playing.
 */
function showBlockInfo(id) {
  const b = board?.blocks.get(id);
  const info = b && blockInfo.describe(b, board);
  if (!info || !el('overlay-info').hidden) return;
  el('info-icon').replaceChildren(blockPreview(id) || document.createTextNode(info.icon));
  el('info-title').textContent = info.title;
  el('info-text').textContent = info.text;
  const running = board.gameState === GameState.PLAYING;
  if (running) stopClock();
  el('overlay-info').hidden = false;
  track('block_info_shown', { kind: b.kind, level: level?.number });
  const close = () => {
    el('overlay-info').hidden = true;
    if (running && board?.gameState === GameState.PLAYING) startClock();
  };
  // The little cross, or a tap anywhere outside the card — but not the tap
  // that opened it: its `click` lands on the overlay a moment after `pointerup`.
  const openedAt = performance.now();
  el('btn-info-ok').onclick = close;
  el('overlay-info').onclick = (ev) => {
    if (performance.now() - openedAt < 300 || el('info-card').contains(ev.target)) return;
    close();
  };
}

/**
 * A rail/anchor/one-way block nudged the way it refuses. Shown once per
 * gesture (see `directionBlockShown`): a pointer drag fires this on every
 * move event, and repeating the sound and toast for as long as the finger
 * stays pressed the wrong way would turn one honest "no" into a buzzer.
 */
function onDirectionBlocked(id, reason) {
  if (directionBlockShown) return;
  directionBlockShown = true;
  view.bump(id);
  haptics.refused();
  audio.blocked();
  screens.toast(t(`toast.blocked.${reason}`), 1400, 'alert');
}

/** One finger movement: returns true if the block actually advanced. */
function onDrag(id, x, y) {
  if (busy || board.gameState !== GameState.PLAYING) return false;
  const before = gestureRemembered ? null : board.snapshot();
  const { events, blockedReason } = board.dragTowards(id, x, y);
  if (!events.length) {
    if (blockedReason) onDirectionBlocked(id, blockedReason);
    else feelContact(id, x, y, false);
    return false;
  }
  chimeExits(events);
  if (!gestureRemembered) { board.remember(before); gestureRemembered = true; }
  view.apply(events);
  feelContact(id, x, y, true);
  hud.update(board);
  return true;
}

/**
 * Each exit rings the rising chime and carries the run it belongs to, which
 * the board turns into a fuller burst of sparks (boardView `_burst`).
 */
function chimeExits(events) {
  for (const e of events) if (e.type === 'exit') { audio.exit(); e.chain = audio.chain; haptics.tick(); }
  return events;
}

/**
 * The finger asks for (x, y) and the block stopped short of it: it has come up
 * against a wall or a block. A small squash says so — once per contact, not on
 * every pointer move while the finger keeps pushing.
 */
function feelContact(id, x, y, moved) {
  const b = board.blocks.get(id);
  if (!b || (b.x === x && b.y === y)) { lastContact = null; return; }
  const horiz = Math.abs(x - b.x) >= Math.abs(y - b.y);
  const dx = horiz ? Math.sign(x - b.x) : 0, dy = horiz ? 0 : Math.sign(y - b.y);
  const key = `${b.x},${b.y},${dx},${dy}`;
  if (key === lastContact) return;
  lastContact = key;
  view.squash(id, dx, dy, moved);
}

/** End of gesture: this is where a move is spent. */
async function onEnd(id, hasMoved, tap) {
  gestureRemembered = false;
  lastContact = null;
  directionBlockShown = false;
  updateBoosters();
  if (tap && board.gameState === GameState.PLAYING) showBlockInfo(id);
  if (!hasMoved || board.gameState !== GameState.PLAYING) return;
  const events = board.endGesture(true, id);
  await view.apply(events);
  view.refreshLocks();
  view.refreshGates();
  hud.update(board);
  updateBoosters();
  if (board.gameState !== GameState.PLAYING) await finishLevel();
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

function startClock() {
  stopClock();
  clock = setInterval(async () => {
    if (!board || board.gameState !== GameState.PLAYING) return;
    const wasInTime = board.inTime();
    board.tick(1);
    hud.update(board);
    // The clock has just stopped: said once, gently — the level goes on.
    if (wasInTime && !board.inTime()) screens.toast(t('toast.timeup'));
    if (board.gameState !== GameState.PLAYING) await finishLevel();
  }, 1000);
}

function stopClock() {
  if (clock) { clearInterval(clock); clock = null; }
}

/** The board whose end is being handled: a level is finished once, never twice. */
let finishedBoard = null;

async function finishLevel() {
  if (finishedBoard === board) return;
  finishedBoard = board;
  stopClock();
  busy = true;
  input.locked = true;

  const won = board.gameState === GameState.WON;
  const duration = Math.round((Date.now() - levelStartedAt) / 1000);

  // Let it breathe before announcing the win.
  if (won) {
    await pause(PAUSE_BEFORE_SUCCESS);
    audio.victory();
    haptics.success();
    await pause(PAUSE_AFTER_ARPEGGIO);
  } else {
    haptics.refused();
  }

  // Defeat: offer to continue BEFORE recording the failure.
  if (!won && !offerUsed) {
    offerUsed = true;
    const choice = await failOffer.offer({ board, ads });
    // "Restart" relaunches the grid without going through the result screen:
    // the player has already seen they lost, telling them again is pointless.
    if (choice === 'retry') {
      api.resetLevelStreak();
      // Declining the continue is the defeat: it costs its heart here, since
      // this path never reaches `completeLevel` below.
      if (usesLives()) lives.spend(lives.COST.FAIL, 'fail');
      busy = false;
      input.locked = false;
      startLevel();
      return;
    }
    if (choice) {
      failOffer.apply(board);
      finishedBoard = null; // play goes on: this board can end again
      hud.update(board);
      busy = false;
      input.locked = false;
      startClock();
      return;
    }
  }

  if (won) {
    levelFailures = 0;
    track(EV.LEVEL_COMPLETED, levelContext(level, { attempt: levelFailures + 1, board, duration }));
    if (level.number === 1) track(EV.TUTORIAL_COMPLETED, levelContext(level, { board, duration }));
  } else {
    levelFailures++;
    track(EV.LEVEL_FAILED, {
      ...levelContext(level, { attempt: levelFailures, board, duration }),
      reason: board.failReason, remaining: board.remaining(),
    });
  }

  const stars = board.stars();

  /**
   * A grid tried out from the editor does not count as a level: it has no
   * number, unlocks nothing and pays nothing. It used to pay, though —
   * `completeLevel(0)` credited twenty-three coins and wrote a "level 0" into
   * the save, which made the editor the fastest way to get rich.
   */
  if (editorTrial) {
    const trial = editorTrial;
    editorTrial = null;
    if (won) announceQuests(quests.onLevelCreated());
    el('overlay-result').removeAttribute('data-decor'); // no realm to dress it with
    result.show({
      won, stars, score: board.dragsUsed(), level: 0, duration,
      coinsEarned: 0, reason: board.failReason, remaining: board.remaining(),
      mode: 'editor',
      onEdit: () => openEditor(trial),
      onRetry: () => { editorTrial = trial; startLevel(); },
      onSubmit: () => openEditor(trial),
    });
    busy = false;
    input.locked = false;
    return;
  }

  /**
   * The daily puzzle does not follow the progression circuit either: it unlocks
   * nothing, pays no coins, and settles into a score and a rank. Mixing it in
   * would advance the map on the strength of grids the player drew themselves.
   */
  if (dailyEntry) {
    const entry = dailyEntry;
    dailyEntry = null;
    if (won) {
      const { score } = await api.submitDailyScore({
        puzzleId: entry.id,
        drags: board.dragsUsed(),
        minDrags: level.minDrags || board.dragsUsed(),
        seconds: duration,
      });
      track('daily_puzzle_completed', { id: entry.id, score, duration });
      announceQuests(quests.onDailyWon(exitCounts()));
      track(EV.DAILY_COMPLETED, { id: entry.id, score, duration });
      const reward = dailyReward();
      await updateDailyPuzzleButton();
      updateStreakBadge();
      await showMenu();
      showLeaderboard(score, reward, entry.id);
    } else {
      showMenu();
    }
    busy = false;
    input.locked = false;
    return;
  }

  if (!won && usesLives()) lives.spend(lives.COST.FAIL, 'fail');
  // Read before `completeLevel` records it: a FIRST win gets its unlock played
  // on the map (mapScreen.js) if the player goes back there next.
  const prevRecord = store.levelRecord(level.number);
  const firstWin = won && !(prevRecord.stars > 0);
  // A replay that beats the player's own best says so: it is what a replay is for.
  const newBest = won && !firstWin && prevRecord.bestScore > 0 && board.dragsUsed() < prevRecord.bestScore;
  const petal = firstWin ? bloom.addPetal() : null;
  const res = await api.completeLevel(level.number, { score: board.dragsUsed(), stars, failed: !won, timeMs: duration * 1000 });
  if (won) announceQuests(quests.onLevelWon({
    stars, ...exitCounts(), tier: levels.tierOf(level.number), streak: res.levelStreak || 0,
  }));

  // The interstitial no longer plays HERE but when the next level opens (see
  // `startLevel`). We just advance the policy's counter: a level ending is
  // indeed what makes an ad eligible.
  ads.policy.noteLevelEnding();
  if (firstWin) mapRun.push({ level: level.number, stars });

  // A win on the last level of a realm gets the celebration screen instead of
  // the plain result screen — it carries the same stars/reward, plus the next
  // realm's preview, so nothing is lost by replacing rather than stacking.
  if (won && level.number === levels.realmOf(level.number).last) {
    track(EV.REALM_COMPLETED, levelContext(level, { attempt: levelFailures + 1, board, duration }));
    const finishedRealm = levels.realmOf(level.number);
    const isGameOver = level.number >= levels.totalLevels();
    // The realm screen has no room for the flower: its gift, if it opens here, is told in a toast.
    if (petal?.gift) screens.toast(`${t('bloom.open')} ${bloomGiftText(petal.gift)}`);
    realmComplete.show({
      realm: finishedRealm,
      next: isGameOver ? null : levels.realmOf(level.number + 1),
      stars,
      coinsEarned: res.coinsEarned,
      onContinue: async () => {
        if (isGameOver) { showMap(); return; }
        await showBrief(level.number + 1);
        startLevel();
      },
    });
    return;
  }

  // The result screen wears the level brief's scenery: the realm's branch and
  // its falling petals, over a veil that hides the board.
  applyScenery(el('overlay-result'), level.number);
  result.show({
    won,
    stars,
    score: board.dragsUsed(),
    duration,
    level: level.number,
    coinsEarned: res.coinsEarned,
    // The purse AFTER this level (and the flower's shards, if it opened).
    balance: currency.balance(),
    levelStreak: res.levelStreak,
    // Short of three stars: what was missing — the moves, the clock or both —
    // so "Replay" has something to aim at.
    starGoal: won && board.dragStars() < 3 ? level.starDrags?.[0] : null,
    timeGoal: won && !board.inTime() && board.dragStars() >= 2,
    newBest,
    bloom: petal && { ...petal, total: bloom.PETALS, giftText: petal.gift && bloomGiftText(petal.gift) },
    onBloomInfo: explainBloom,
    reason: board.failReason,
    remaining: board.remaining(),
    noAds: currency.hasRemovedAds(),
    onBannerShown: () => track('ad_impression', { adType: 'banner', placement: PLACEMENT.BANNER_RESULT }),
    onDouble: async () => {
      const watched = await ads.showRewarded(PLACEMENT.REWARDED_DOUBLE);
      if (!watched) return false;
      currency.credit(res.coinsEarned, 'double_reward');
      return currency.balance();
    },
    onMap: showMap,
    onRetry: startLevel,
    fx: RESULT_FX,
    onNext: async () => {
      if (level.number < levels.totalLevels()) { await showBrief(level.number + 1); startLevel(); }
      else showMap();
    },
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * "Play" opens the level the player is on, not the map: one tap from the home
 * screen to the next grid, as in every puzzle game that keeps its players
 * playing. The map stays one tap back, from the brief. Everything finished:
 * the map, to pick a level to replay.
 */
el('btn-play').onclick = () => {
  const n = store.load().unlockedLevel || 1;
  const done = n >= levels.totalLevels() && store.levelRecord(n).stars > 0;
  return done ? showMap() : showBrief(n);
};

/**
 * A tap on the home screen AROUND the buttons shakes a few petals loose from
 * where the finger landed — a little something to play with while deciding.
 * Taps on anything interactive are left alone.
 */
el('screen-menu').addEventListener('pointerdown', (ev) => {
  if (ev.target.closest('button, a, input, label, [data-lives]')) return;
  const host = el('screen-menu');
  const r = host.getBoundingClientRect();
  confetti.petalBurst(host, ev.clientX - r.left, ev.clientY - r.top);
});

livesUI.init({ ads });

el('streak-badge').onclick = onStreakBadge;

el('btn-restart').onclick = () => {
  if (busy) return;
  // Restarting a grid in progress gives up on it: the run of wins stops here.
  // It also costs half a heart — half, because it is a choice, not a defeat.
  if (board?.gameState === GameState.PLAYING) {
    api.resetLevelStreak();
    if (usesLives()) lives.spend(lives.COST.RESTART, 'restart');
  }
  startLevel();
};

/** Hammer: the player POINTS AT the block to remove, we do not pick one for them. */
el('btn-hammer').onclick = async () => {
  if (!board || busy || board.gameState !== GameState.PLAYING || hammerMode) return;
  if (!useFreebie('hammer') && !await boosterByAd(PLACEMENT.REWARDED_HAMMER)) return;
  hammerMode = true;
  input.locked = true;
  el('app').classList.add('hammer');
  screens.toast(t('toast.hammer.pick'));

  const aim = async (ev) => {
    const id = view.blockIdFromPoint(ev.clientX, ev.clientY);
    const target = id !== null ? board.blocks.get(id) : null;
    if (!target || target.kind === KIND.WALL) { screens.toast(t('toast.hammer.bad')); return; }
    ev.preventDefault();
    ev.stopPropagation();
    done();
    const res = board.smash(id);
    audio.exit();
    track('powerup_used', { type: 'hammer', level: level.number, blockId: id });
    await view.removeBlock(id);
    await view.apply(res.events);
    view.refreshLocks();
    view.refreshGates();
    hud.update(board);
    updateBoosters();
    if (board.gameState !== GameState.PLAYING) await finishLevel();
  };
  const done = () => {
    hammerMode = false;
    input.locked = false;
    el('app').classList.remove('hammer');
    el('board').removeEventListener('pointerdown', aim, true);
  };
  el('board').addEventListener('pointerdown', aim, true);
};

el('btn-time').onclick = async () => {
  if (!board || busy || board.gameState !== GameState.PLAYING) return;
  if (!await boosterByAd(PLACEMENT.REWARDED_TIME)) return;
  board.addTime(30);
  track('powerup_used', { type: 'time', level: level.number });
  hud.update(board);
  screens.toast(t('toast.time'));
};

el('btn-undo').onclick = async () => {
  if (!board || busy || board.gameState !== GameState.PLAYING || !board.canUndo()) return;
  if (!useFreebie('undo') && !await boosterByAd(PLACEMENT.REWARDED_UNDO)) return;
  board.undo();
  track('powerup_used', { type: 'undo', level: level.number });
  view.resync();
  view.refreshGates();
  hud.update(board);
  updateBoosters();
  screens.toast(t('toast.undo'));
};

/**
 * Hint: it points at the next playable block, it does not play it. Paid in
 * coins, or with a rewarded ad when the player is broke.
 */
el('btn-hint').onclick = async () => {
  if (!board || busy || board.gameState !== GameState.PLAYING) return;
  const advice = board.hint();
  if (!advice) { screens.toast(t('toast.nohint')); return; }

  if (useFreebie('hint')) {
    // paid by the win streak
  } else if (currency.canAfford(currency.PRICES.HINT)) {
    if (!currency.debit(currency.PRICES.HINT, 'hint')) return;
  } else {
    stopClock();
    const watched = await ads.showRewarded(PLACEMENT.REWARDED_HINT);
    startClock();
    if (!watched) { screens.toast(t('shop.ad.failed')); return; }
  }

  track('hint_used', { level: level.number, blockId: advice.id, park: !advice.gate });
  view.highlight(advice.id);
  /**
   * A hint with NO GATE points at a block that must be moved ASIDE, not cleared.
   * Highlighting it and saying nothing is worse than no hint at all: the player
   * drags it at a gate, it refuses, and a hint they paid coins or an ad for
   * reads as broken. The one case where the hint has to speak.
   */
  if (!advice.gate) screens.toast(t('toast.hint.park'));
  updateBoosters();
};

el('btn-start').onclick = startLevel;

// ---------------------------------------------------------------------------
// User menu — profile and settings, reachable from EVERY screen, mid-game
// included: muting the sound must not require giving up.
// ---------------------------------------------------------------------------

function openPanel(open) {
  el('user-panel').hidden = !open;
  el('user-btn').classList.toggle('open', open);
  el('user-btn').setAttribute('aria-expanded', String(open));
  if (open) updatePanel();
}

el('user-btn').onclick = () => openPanel(el('user-panel').hidden);
el('user-close').onclick = () => openPanel(false);

// A click outside the panel closes it, as any menu of this sort does.
document.addEventListener('pointerdown', (ev) => {
  if (el('user-panel').hidden) return;
  if (el('user-panel').contains(ev.target) || el('user-btn').contains(ev.target)) return;
  openPanel(false);
}, true);

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !el('user-panel').hidden) openPanel(false);
});

async function updatePanel() {
  const p = await api.getProfile();
  // Stars won, not "103/3000": the ceiling only says how far there is to go.
  el('user-stars').textContent = p.totalStars;
  el('user-coins').textContent = p.coins;

  const d = store.load();
  el('opt-music').checked = d.music !== false;
  el('opt-sfx').checked = d.sfx !== false;
  el('opt-vibration').checked = d.vibration !== false;
  el('opt-glyphs').checked = d.glyphs === true;
  el('opt-night').checked = d.night === true;
  buildLanguageChoice();
  updateMuteDot();
  await updateAuthStatus();
  await updateAdminSection();
}

/** The "muted" state is read off the closed button, or it is invisible. */
function updateMuteDot() {
  const d = store.load();
  const muted = d.music === false && d.sfx === false;
  el('user-btn').classList.toggle('muted', muted);
}

el('opt-music').onchange = (ev) => {
  const on = ev.target.checked;
  audio.setMusic(on);
  const d = store.load(); d.music = on; store.save(d);
  if (on) audio.startMusic();
  updateMuteDot();
  track('sound_toggled', { channel: 'music', on });
};

el('opt-sfx').onchange = (ev) => {
  const on = ev.target.checked;
  audio.setSfx(on);
  const d = store.load(); d.sfx = on; store.save(d);
  if (on) audio.exit();          // immediate feedback: you hear what you turn on
  updateMuteDot();
  track('sound_toggled', { channel: 'sfx', on });
};

el('opt-vibration').onchange = (ev) => {
  const on = ev.target.checked;
  const d = store.load(); d.vibration = on; store.save(d);
  if (on) haptics.tick();        // immediate feedback: you feel what you turn on
  track('sound_toggled', { channel: 'vibration', on });
};

/**
 * Family symbols on blocks and gates.
 *
 * The six colours are normally told apart by hue alone. This option gives them
 * their glyph back (●◆▲★■⬢): without it, a colour-blind player has no way of
 * knowing which block leaves through which gate. The class set on `#app` is
 * enough — the board rendering reads it, and the CSS does the rest.
 */
function applyGlyphs(on) {
  document.getElementById('app').classList.toggle('with-glyphs', on);
  view?.refreshGlyphs?.();
}

el('opt-glyphs').onchange = (ev) => {
  const on = ev.target.checked;
  const d = store.load(); d.glyphs = on; store.save(d);
  applyGlyphs(on);
  track('glyphs_toggled', { on });
};

/**
 * Night mode. Only the surfaces/ink tokens flip to a dark palette (see
 * `.night` in main.css) — `--h` itself is untouched, so the app stays tinted
 * by whatever realm the player is in, just lit differently.
 */
function applyNight(on) {
  document.documentElement.classList.toggle('night', on);
}

el('opt-night').onchange = (ev) => {
  const on = ev.target.checked;
  const d = store.load(); d.night = on; store.save(d);
  applyNight(on);
  track('night_toggled', { on });
};

/**
 * Language choice, as a dropdown.
 *
 * One button per language held at two; at five, the row overflowed the panel
 * and nothing says we will stop there. The native `select` also opens in the
 * phone's own picker, which is what it is for.
 */
function buildLanguageChoice() {
  const host = el('opt-language');
  if (host.firstElementChild) {
    host.firstElementChild.value = i18n.language();
    return;
  }
  const select = document.createElement('select');
  select.className = 'language-select';
  select.setAttribute('aria-label', i18n.t('user.language'));
  select.append(...i18n.LANGUAGES.map((L) => {
    const o = document.createElement('option');
    o.value = L.code;
    // Each language is written IN that language, flag first: recognisable even
    // to a player lost in a language they cannot read.
    o.textContent = `${L.flag} ${L.name}`;
    return o;
  }));
  select.value = i18n.language();
  select.onchange = () => {
    i18n.setLanguage(select.value);
    select.setAttribute('aria-label', i18n.t('user.language'));
    // Screens already built carry text made in JS: we redraw them, otherwise
    // the map and the briefing would stay in the old language until the next
    // navigation.
    updatePanel();
    if (screens.current() === 'menu') showMenu();
    else if (screens.current() === 'map') mapScreen.render(showBrief);
    track('language_changed', { language: select.value });
  };
  host.replaceChildren(select);
}

/**
 * The editor. It used to live in the QA panel, next to the "Win" and "Lose"
 * buttons: a player never found it there. It is now in the user menu, beside
 * the settings, where you go when you are looking to do something rather than
 * to play.
 */
function openEditor(resume = null) {
  openPanel(false);
  editor.init({
    level: resume?.level || null,
    id: resume?.id || null,
    onTest: (draft, draftId) => {
      editorTrial = { level: draft, id: draftId };
      // We are leaving the editor to play: the history anchor has no reason to
      // stay.
      if (editorAnchor) { editorAnchor = false; history.back(); }
      level = { ...draft, number: 0, realm: t('editor.trying'), difficulty: '' };
      startLevel();
    },
    onCreated: () => announceQuests(quests.onLevelCreated()),
    onSubmit: async (draft, title) => {
      const { id } = await api.submitDailyPuzzle(draft, title);
      track('daily_puzzle_submitted_ui', { id });
      updateDailyPuzzleButton();
    },
  });
  screens.show('editor');
  updateBanner('editor');
  pushAnchor();   // the stop for the "back" button
}

el('btn-editor').onclick = () => openEditor();

/**
 * The phone's "back" button, inside the editor.
 *
 * On Android it closes the application when nothing intercepts it — an
 * unfortunate gesture in the middle of a grid. So we push ONE history anchor
 * when the editor opens, and each back press undoes the last block.
 *
 * The anchor must be UNIQUE and REMOVED on the way out. Stacked on every
 * opening and never popped, it left behind as many dead entries as round trips:
 * a "back" from the map then consumed one and did nothing, which felt like a
 * broken button.
 */
let editorAnchor = false;

function pushAnchor() {
  if (editorAnchor) return;
  history.pushState({ screen: 'editor' }, '');
  editorAnchor = true;
}

/** Leaves the editor, giving the browser back the entry we took from it. */
function leaveEditor() {
  showMenu();                       // the screen changes BEFORE the history pop,
  if (editorAnchor) {               // otherwise popstate would think it must undo.
    editorAnchor = false;
    history.back();
  }
}

window.addEventListener('popstate', () => {
  if (screens.current() !== 'editor') { editorAnchor = false; return; }
  if (editor.goBack()) {
    // Pushed again straight away: without this, the first back would be the
    // only one caught.
    editorAnchor = false;
    pushAnchor();
    screens.toast(t('editor.undone'));
    return;
  }
  editorAnchor = false;
  showMenu();
});

// The editor's arrow leaves through the same exit as the phone's button.
document.querySelector('#screen-editor [data-nav="menu"]')
  ?.addEventListener('click', (ev) => { ev.stopImmediatePropagation(); leaveEditor(); }, true);
el('btn-mine-close').onclick = () => { el('overlay-mine').hidden = true; };

// ---------------------------------------------------------------------------
// Android hardware back button (no-op on the published web site)
// ---------------------------------------------------------------------------

/** Plain overlays a back press can dismiss outright — no state to unwind. */
const DISMISSABLE_OVERLAYS = ['overlay-shop', 'overlay-mine', 'overlay-rank', 'overlay-board', 'overlay-quests', 'overlay-feedback'];

registerBackHandler(() => {
  if (!el('user-panel').hidden) { openPanel(false); return true; }
  const openOverlay = DISMISSABLE_OVERLAYS.find((id) => !el(id).hidden);
  if (openOverlay) { el(openOverlay).hidden = true; return true; }
  // The editor has its own back-button contract (undo one block, then leave)
  // wired through the popstate listener above — reuse it rather than duplicate it.
  if (screens.current() === 'editor') { history.back(); return true; }
  if (screens.current() === 'brief') { showMap(); return true; }
  if (screens.current() === 'game') {
    stopClock();
    // Testing a level from the editor is a detour, not a move into the
    // normal progression — leaving it should land back where it started
    // (the draft, still there), not on the general map the player never
    // asked to see.
    if (editorTrial) {
      const trial = editorTrial;
      editorTrial = null;   // leaving the trial without finishing it
      openEditor(trial);
      return true;
    }
    if (dailyEntry) { dailyEntry = null; showMenu(); return true; }
    showMap();
    return true;
  }
  if (screens.current() === 'map') { showMenu(); return true; }
  return false; // at the menu, nothing left to unwind — let the app exit
});

// Belt and suspenders alongside the `visibilitychange` handler further down:
// some Android WebViews are inconsistent about firing document visibility on
// backgrounding via the app switcher, `pause`/`resume` are not.
registerLifecycle({
  onPause: stopClock,
  onResume: () => {
    if (board?.gameState === GameState.PLAYING && screens.current() === 'game') startClock();
  },
});


// ---------------------------------------------------------------------------
// Feedback — bug, idea, remark
// ---------------------------------------------------------------------------

/** Screenshots attached to the report being written. Never stored: see feedback.js. */
let screenshots = [];
let feedbackCategory = 'bug';
const SCREENSHOT_MAX_MB = 4;

function updateCategories() {
  el('fb-cats').replaceChildren(...feedback.CATEGORIES.map((c) => {
    const b = document.createElement('button');
    b.className = 'fb-cat' + (c === feedbackCategory ? ' sel' : '');
    b.textContent = t(`feedback.cat.${c}`);
    b.onclick = () => { feedbackCategory = c; updateCategories(); };
    return b;
  }));
}

function updateScreenshots() {
  el('fb-shots').replaceChildren(...screenshots.map((c, i) => {
    const thumb = document.createElement('button');
    thumb.className = 'fb-shot';
    thumb.setAttribute('aria-label', t('editor.delete'));
    const img = document.createElement('img');
    img.src = c.data;
    img.alt = c.name;
    thumb.append(img);
    thumb.onclick = () => { screenshots.splice(i, 1); updateScreenshots(); };
    return thumb;
  }));
}

el('fb-files').onchange = async (ev) => {
  for (const file of [...ev.target.files]) {
    if (file.size > SCREENSHOT_MAX_MB * 1024 * 1024) {
      screens.toast(t('feedback.toobig', { n: SCREENSHOT_MAX_MB }));
      continue;
    }
    const data = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    screenshots.push({ name: file.name, type: file.type, size: file.size, data });
  }
  ev.target.value = '';
  updateScreenshots();
};

/** The report being written, formatted and stored in the local history. */
function currentReport() {
  const message = el('fb-message').value.trim();
  if (!message) { screens.toast(t('feedback.empty')); return null; }
  const report = feedback.compose({
    category: feedbackCategory,
    message,
    screenshots,
    extra: {
      currentScreen: screens.current(),
      currentLevel: level?.number ?? null,
      // The sound's state travels with the report: "I hear nothing" is
      // untangleable without knowing whether the audio context even started.
      audio: JSON.stringify(audio.diagnostics()),
    },
  });
  feedback.record(report);
  return report;
}

el('btn-feedback').onclick = () => {
  openPanel(false);
  screenshots = [];
  feedbackCategory = 'bug';
  el('fb-message').value = '';
  updateCategories();
  updateScreenshots();
  el('overlay-feedback').hidden = false;
};

el('btn-feedback-close').onclick = () => { el('overlay-feedback').hidden = true; };

/**
 * `mailto:` navigation and a `<a download>` Blob both assume a real browser:
 * neither does anything useful inside the packaged app's WebView (no mail
 * client is wired to intercept the scheme, no Downloads UI catches the
 * blob). The native share sheet is the one route guaranteed to work there —
 * it hands the report to whatever app the player picks (mail, messages,
 * notes...). Screenshots stay a web-only feature of the download route: a
 * multi-file native share would need writing them to disk first
 * (`@capacitor/filesystem`), not worth it for a text bug report.
 */
async function shareReportNative(report) {
  await Share.share({
    title: `Quiet Puzzle — ${t(`feedback.cat.${report.category}`)}`,
    text: feedback.asText(report),
    dialogTitle: t('feedback.share'),
  });
}

if (isNative()) {
  el('fb-download').hidden = true;
  el('fb-mail').dataset.i18n = 'feedback.share';
  el('fb-mail').textContent = t('feedback.share');
}

el('fb-copy').onclick = async () => {
  const report = currentReport();
  if (!report) return;
  try {
    await navigator.clipboard.writeText(feedback.asText(report));
    screens.toast(t('feedback.copied'));
  } catch {
    // Clipboard refused (insecure context, permission): fall back to
    // whichever route actually works on this platform.
    if (isNative()) shareReportNative(report);
    else el('fb-download').click();
  }
};

/**
 * Download of the complete report, screenshots included. This is the ONLY route
 * an image can travel by: no `mailto:` knows how to attach a file, and there is
 * no server to entrust it to. Web only — see `shareReportNative`.
 */
el('fb-download').onclick = () => {
  const report = currentReport();
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `quiet-puzzle-${report.category}-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  screens.toast(t('feedback.downloaded'));
};

el('fb-mail').onclick = () => {
  const report = currentReport();
  if (!report) return;
  if (isNative()) { shareReportNative(report); return; }
  const subject = `Quiet Puzzle — ${t(`feedback.cat.${report.category}`)}`;
  // No hard-coded recipient: the mail client opens on a draft the player
  // addresses to whoever they like. Inventing an address here would make it
  // wrong the day it changes, and there is not one yet.
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(feedback.asText(report))}`;
};

// ---------------------------------------------------------------------------
// Daily puzzle
// ---------------------------------------------------------------------------

/**
 * The menu button. It only shows IF a grid has been submitted: an entry leading
 * to "nothing for now" reads like a breakdown, whereas its absence goes
 * unnoticed.
 */
async function updateDailyPuzzleButton() {
  const button = el('btn-daily-puzzle');
  const entry = await api.getDailyPuzzle();
  button.hidden = !entry;
  if (!entry) return;
  const mine = dailyPuzzle.leaderboard().find((e) => e.me);
  el('daily-puzzle-sub').textContent = mine
    ? t('daily.done', { score: mine.score })
    : (entry.title || t('daily.play'));
  // Not played yet today: the button glows, like a quest reward waiting.
  button.classList.toggle('ready', !mine);
}

el('btn-daily-puzzle').onclick = async () => {
  const entry = await api.getDailyPuzzle();
  if (!entry) return;
  dailyEntry = entry;
  // The daily puzzle is played against the clock: the limits of the submitted
  // level are the ones the editor gave it, and we do not tighten them.
  level = { ...entry.level, levelId: `daily_${entry.id}`, number: 0,
            realm: entry.title || t('daily.title'), difficulty: '' };
  startLevel();
  track('daily_puzzle_started', { id: entry.id });
};

el('btn-rank-close').onclick = () => { el('overlay-rank').hidden = true; };

// ---------------------------------------------------------------------------
// Coin shop
// ---------------------------------------------------------------------------

/**
 * Two ways to get coins, and they must be presented in this order: the free one
 * first. Putting the packs at the top would make the rewarded ad look like a
 * consolation prize, when it is the one that helps the player out at the moment
 * they need it.
 */
function updateShop() {
  el('shop-balance').textContent = currency.balance();

  const left = currency.adsRemaining();
  const button = el('btn-shop-ad');
  button.disabled = left <= 0;
  el('shop-ad-label').textContent = t('shop.ad', { n: currency.AD_REWARD.COINS });
  el('shop-ad-note').textContent = left > 0
    ? t('shop.ad.left', { n: left, total: currency.AD_REWARD.PER_DAY })
    : t('shop.ad.none');
}

/** The home screen's counters from the save alone — no database, no network. */
function paintMenuFromSave() {
  paintPlayLevel(store.load().unlockedLevel || 1);
  el('menu-stars').textContent = store.totalStars();
  el('menu-coins').textContent = currency.balance();
  updateStreakBadge();
}

/** "Niveau 37" under "Play": where the button leads. */
function paintPlayLevel(n) {
  el('menu-play-level').textContent = t('menu.play.level', { n });
}

/** Refreshes the menu counters without rebuilding it entirely. */
function updateMenuCounters() {
  el('menu-coins').textContent = currency.balance();
}

el('btn-shop').onclick = () => {
  updateShop();
  el('overlay-shop').hidden = false;
  track(EV.IAP_VIEWED, { balance: currency.balance() });
};

el('btn-shop-close').onclick = () => { el('overlay-shop').hidden = true; };

el('btn-shop-ad').onclick = async () => {
  if (currency.adsRemaining() <= 0) return;
  const watched = await ads.showRewarded(PLACEMENT.REWARDED_COINS);
  if (!watched) { screens.toast(t('shop.ad.failed')); return; }
  // The credit goes through `currency`: it is the one holding the daily
  // counter, and paying out here would bypass it.
  const earned = currency.creditAdReward();
  track(EV.REWARD_GRANTED, { placement: PLACEMENT.REWARDED_COINS, reward: 'coins', amount: earned });
  updateShop();
  updateMenuCounters();
  screens.toast(t('shop.earned', { n: earned }));
};

/** Shows the day's leaderboard, with the player's place highlighted. */
/**
 * The daily puzzle's prize, drawn at random once per day: 50 shards, a hammer
 * or a hint — the last two kept in stock for any later level (`useFreebie`).
 * Replaying the puzzle to better a score pays nothing more.
 * @returns {string|null} what was won, as a line for the ranking card.
 */
/**
 * What the flower is, on a tap on its row: a petal per new level, a surprise
 * at five. Shown with the flower as it stands, in the same card as the blocks'
 * explanations.
 */
function explainBloom() {
  if (!el('overlay-info').hidden) return;
  el('info-icon').replaceChildren(el('bloom-flower').cloneNode(true));
  el('info-title').textContent = t('bloom.info.title');
  el('info-text').textContent = t('bloom.info.text', { n: bloom.PETALS });
  el('overlay-info').hidden = false;
  track('bloom_info_shown', {});
  const close = () => { el('overlay-info').hidden = true; };
  const openedAt = performance.now();
  el('btn-info-ok').onclick = close;
  el('overlay-info').onclick = (ev) => {
    if (performance.now() - openedAt < 300 || el('info-card').contains(ev.target)) return;
    close();
  };
}

/** "+50 éclats", "Un indice offert"… — what the flower held. */
function bloomGiftText(gift) {
  return t(`bloom.gift.${gift.kind}`, { n: gift.amount });
}

const DAILY_REWARDS = [
  { kind: 'coins', amount: 50 },
  { kind: 'hammer', amount: 1 },
  { kind: 'hint', amount: 1 },
];
function dailyReward() {
  const today = new Date().toISOString().slice(0, 10);
  if (store.load().dailyRewardOn === today) return null;
  const r = DAILY_REWARDS[Math.floor(Math.random() * DAILY_REWARDS.length)];
  if (r.kind === 'coins') currency.credit(r.amount, 'daily_puzzle');
  const d = store.load(); // after `credit`, which saves on its own
  d.dailyRewardOn = today;
  if (r.kind !== 'coins') d[STOCK[r.kind]] = (d[STOCK[r.kind]] || 0) + r.amount;
  store.save(d);
  track('daily_puzzle_reward', { type: r.kind, amount: r.amount });
  return t(`daily.reward.${r.kind}`, { n: r.amount });
}

/**
 * The daily puzzle's ranking: every player who played it (server), or — offline,
 * or before the server knows it — this device's own, which says so.
 */
async function showLeaderboard(myScore, reward = null, puzzleId = null) {
  el('rank-reward').hidden = !reward;
  el('rank-reward').textContent = reward || '';
  el('rank-mine').textContent = t('board.loading');
  el('rank-list').replaceChildren();
  el('rank-note').hidden = true;
  el('overlay-rank').hidden = false;

  const server = await api.getDailyLeaderboard(puzzleId);
  const local = !server || !server.length;
  const list = local
    ? dailyPuzzle.leaderboard().map((e) => ({ rank: e.rank, name: e.author, score: e.score, me: e.me }))
    : server;
  const total = local ? list.length : (server[0]?.total ?? list.length);
  const me = list.find((e) => e.me);
  el('rank-mine').textContent = me
    ? `${t('daily.score', { score: myScore ?? me.score })} · ${t('daily.rank', { rank: me.rank, total })}`
    : '';
  el('rank-list').replaceChildren(...list.slice(0, 10).map((e) => {
    const li = document.createElement('li');
    if (e.me) li.className = 'me';
    const who = document.createElement('span');
    who.textContent = e.me ? t('daily.rank.me') : e.name;
    const pts = document.createElement('b');
    pts.textContent = e.score;
    li.append(who, pts);
    return li;
  }));
  if (!list.length) el('rank-list').textContent = t('daily.rank.empty');
  el('rank-note').hidden = !local;
}

// ---------------------------------------------------------------------------
// Daily quests (meta/quests.js)
// ---------------------------------------------------------------------------

/** Blocks cleared on this board, and how many of them were jokers. */
function exitCounts() {
  const kinds = new Map(level.blocks.map((b) => [b.id, b.kind]));
  return {
    exits: board.exited.length,
    jokers: board.exited.filter((id) => kinds.get(id) === KIND.JOKER).length,
  };
}

const QUEST_ICONS = { create: '✏️', daily: '📅', levels: '🧩', exits: '🚪', stars: '★', perfect: '🌟', hard: '🔥', streak: '⚡', jokers: '🃏' };

/** A toast per quest just completed — the list itself waits on the home screen. */
function announceQuests(done) {
  for (const q of done) screens.toast(t('quest.done', { what: t(`quest.${q.kind}`, { n: q.target }) }));
  updateQuestButton();
}

function updateQuestButton() {
  const q = quests.list();
  const claimed = q.list.filter((x) => x.claimed).length;
  el('quest-count').textContent = `${claimed}/${q.list.length}`;
  el('btn-quests').classList.toggle('ready', quests.readyToClaim() > 0);
}

function renderQuests() {
  const q = quests.list();
  el('quest-list').replaceChildren(...q.list.map((x, i) => {
    const li = document.createElement('li');
    li.className = 'quest' + (x.claimed ? ' claimed' : x.progress >= x.target ? ' done' : '');
    const icon = document.createElement('span');
    icon.className = 'quest-icon';
    icon.textContent = QUEST_ICONS[x.kind] || '•';
    const body = document.createElement('div');
    body.className = 'quest-body';
    const label = document.createElement('b');
    label.textContent = t(`quest.${x.kind}`, { n: x.target });
    const bar = document.createElement('div');
    bar.className = 'quest-bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.min(1, x.progress / x.target) * 100}%`;
    bar.append(fill);
    const count = document.createElement('small');
    count.textContent = `${Math.min(x.progress, x.target)} / ${x.target}`;
    body.append(label, bar, count);
    const action = document.createElement('button');
    action.className = 'btn btn-sm quest-claim';
    if (x.claimed) { action.textContent = '✓'; action.disabled = true; }
    else if (x.progress >= x.target) {
      action.textContent = t('quest.claim', { n: x.coins });
      action.classList.add('btn-primary');
      action.onclick = () => {
        const coins = quests.claim(i);
        if (coins) { audio.exit(); screens.toast(t('shop.earned', { n: coins })); updateMenuCounters(); }
        renderQuests();
      };
    } else { action.textContent = `+${x.coins}`; action.disabled = true; }
    li.append(icon, body, action);
    return li;
  }));
  const chest = el('quest-chest');
  chest.disabled = !quests.chestReady();
  chest.textContent = q.chest ? t('quest.chest.done') : t('quest.chest', { n: quests.CHEST });
  chest.classList.toggle('btn-primary', quests.chestReady());
  updateQuestButton();
}

el('btn-quests').onclick = () => {
  track('quests_opened', {});
  renderQuests();
  el('overlay-quests').hidden = false;
};
el('quest-chest').onclick = () => {
  const coins = quests.claimChest();
  if (coins) { audio.exit(); screens.toast(t('shop.earned', { n: coins })); updateMenuCounters(); }
  renderQuests();
};
el('btn-quests-close').onclick = () => { el('overlay-quests').hidden = true; };

/**
 * The players' leaderboard (meta/leaderboard.js): the top fifty signed-in
 * players by stars, and the player's own place. Opens at once on a "loading"
 * line — the list arrives from the server.
 */
el('btn-leaderboard').onclick = async () => {
  openPanel(false);
  track('leaderboard_opened', {});
  el('board-mine').textContent = t('board.loading');
  el('board-list').replaceChildren();
  el('board-note').hidden = true;
  el('overlay-board').hidden = false;

  const board = await leaderboard.fetchBoard(50);
  if (!board) { el('board-mine').textContent = t('board.offline'); return; }
  const me = board.rows.find((r) => r.me);
  el('board-mine').textContent = me ? t('board.mine', { rank: me.rank }) : '';
  el('board-list').replaceChildren(...board.rows.map((r) => {
    const li = document.createElement('li');
    if (r.me) li.className = 'me';
    const rank = document.createElement('i');
    rank.textContent = r.rank;
    const who = document.createElement('span');
    who.textContent = r.me ? t('daily.rank.me') : r.username;
    const stars = document.createElement('b');
    stars.textContent = `★ ${r.stars}`;
    li.append(rank, who, stars);
    return li;
  }));
  if (!board.rows.length) el('board-list').textContent = t('board.empty');
  // An anonymous player sees the board but is not on it: say why, and how.
  el('board-note').hidden = board.signedIn;
  if (!board.signedIn) el('board-note').textContent = t('board.signin');
};
el('btn-board-close').onclick = () => { el('overlay-board').hidden = true; };

// ---------------------------------------------------------------------------
// Account and admin mode
// ---------------------------------------------------------------------------

el('btn-logout').onclick = async () => {
  if (!confirm(t('user.logout.confirm'))) return;
  try {
    await supabase.auth.signOut();
    admin.forget();
    openPanel(false);
    // The onAuthStateChange listener handles the rest.
  } catch (err) {
    console.error('Sign-out failed:', err);
    screens.toast(t('user.logout.failed'));
  }
};

/**
 * Required by the Play Console's "Data safety" form, and generally good
 * practice. Opens in a system tab (Custom Tab on Android via the Browser
 * plugin, a new browser tab on the web) rather than inside the game's own
 * WebView — leaving a link the player did not ask to leave the game for.
 */
const PRIVACY_URL = 'https://romumrn.github.io/Quiet-puzzle/privacy.html';
el('btn-privacy').onclick = () => {
  if (isNative()) Browser.open({ url: PRIVACY_URL });
  else window.open(PRIVACY_URL, '_blank', 'noopener');
};

const firstNameOf = (user) => {
  const meta = user.user_metadata || {};
  const raw = meta.given_name || meta.full_name || meta.name || '';
  return raw.trim().split(/\s+/)[0] || null;
};

const avatarOf = (user) => user.user_metadata?.avatar_url || user.user_metadata?.picture || null;

/**
 * "Bonjour Prénom" on the menu — only for a real, linked account. Anonymous
 * play (the default, frictionless start) has no name or photo to greet with.
 */
async function updateGreeting() {
  const pill = el('menu-greeting');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  const name = user && user.is_anonymous !== true ? firstNameOf(user) : null;
  pill.hidden = !name;
  if (!name) return;
  el('menu-greeting-text').textContent = t('menu.greeting', { name });
  const avatar = el('menu-greeting-avatar');
  const avatarUrl = avatarOf(user);
  avatar.hidden = false;
  // Google's photo server refuses some loads (a Referer it dislikes — hence
  // `referrerpolicy="no-referrer"` on the <img> — or its rate limit): the
  // browser then showed its broken-image icon. The initial takes its place.
  avatar.onerror = () => { avatar.onerror = null; avatar.src = initialAvatar(name); };
  avatar.src = avatarUrl || initialAvatar(name);
}

/** A round badge with the name's first letter, for when there is no photo. */
function initialAvatar(name) {
  const letter = [...(name || '?').trim()][0]?.toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">`
    + `<circle cx="20" cy="20" r="20" fill="#d9a3bd"/>`
    + `<text x="20" y="26.5" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="600" fill="#fff">${letter.replace(/[<&>]/g, '')}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

el('menu-greeting').onclick = () => openPanel(true);

/** Shows the authentication status. */
async function updateAuthStatus() {
  const { data: { session } } = await supabase.auth.getSession();
  const logoutBtn = el('btn-logout');
  const statusText = el('auth-status-text');

  if (session?.user) {
    logoutBtn.hidden = false;
    const email = session.user.email || session.user.user_metadata?.email || t('user.status.anonymous');
    statusText.textContent = t('user.status.online', { email });
  } else {
    logoutBtn.hidden = true;
    statusText.textContent = t('user.status.offline');
  }
}

/**
 * The admin section of the user menu, and the QA/debug panel's gear button.
 *
 * Both hidden by default and revealed only for an account holding the role.
 * For the admin panel this is a display decision and nothing more: everything
 * it can do is gated server-side by RLS, so revealing the button by hand in
 * the console gets you a panel that answers "permission denied" (see
 * src/data/admin.js). The debug panel has no such server-side backstop — it
 * only ever edits the local save — so this check is the actual gate, not
 * cosmetic: it is what keeps "Solve"/"Unlock all"/"+500 coins" off a stranger's
 * copy of the app while leaving them reachable from the one account that
 * holds the role.
 */
async function updateAdminSection() {
  const allowed = await admin.isAdmin();
  el('user-admin').hidden = !allowed;
  el('debug-toggle').hidden = !allowed;
}

el('btn-admin').onclick = async () => {
  openPanel(false);
  await adminPanel.open();
};

adminPanel.wire();

el('btn-reset').onclick = () => {
  if (!confirm(t('user.reset.confirm'))) return;
  store.reset();
  // Re-apply the reset preferences, then go back to the menu. We do NOT rerun
  // the startup sequence: it registered one more `pagehide` listener on every
  // wipe, and each of them then emitted its own end-of-session event.
  const fresh = store.load();
  audio.setMusic(fresh.music !== false);
  audio.setSfx(fresh.sfx !== false);
  daily.openSession();
  showMenu();
};

document.querySelectorAll('[data-nav]').forEach((b) => {
  b.onclick = () => {
    // Leaving a grid in progress is an abandon: it is the signal that is
    // missing most often, and the one that says which level discourages people.
    if (screens.current() === 'game' && board?.gameState === GameState.PLAYING) {
      track(EV.LEVEL_ABANDONED, levelContext(level, {
        attempt: levelFailures + 1, board,
        duration: Math.round((Date.now() - levelStartedAt) / 1000),
      }));
      api.resetLevelStreak();
    }
    // Leaving a grid being tried out from the editor goes back to the editor,
    // draft intact — as the phone's back button already did (registerBackHandler).
    if (screens.current() === 'game' && editorTrial && b.dataset.nav === 'map') {
      const trial = editorTrial;
      editorTrial = null;
      openEditor(trial);
      return undefined;
    }
    // The daily puzzle is started from the home screen: back goes there, not
    // to a map it has nothing to do with.
    if (screens.current() === 'game' && dailyEntry && b.dataset.nav === 'map') {
      dailyEntry = null;
      return showMenu();
    }
    return b.dataset.nav === 'menu' ? showMenu() : showMap();
  };
});

// The clock must not keep running while the app is in the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopClock();
  else if (board && board.gameState === GameState.PLAYING && screens.current() === 'game') startClock();
});


// ---------------------------------------------------------------------------
// QA panel
// ---------------------------------------------------------------------------

el('debug-toggle').onclick = () => {
  const p = el('debug-panel');
  p.hidden = !p.hidden;
  if (!p.hidden) refreshDebug();
};

el('debug-go').onclick = async () => {
  const n = Math.min(levels.totalLevels(), Math.max(1, Number(el('debug-level').value) || 1));
  await showBrief(n);
  startLevel();
};

el('debug-win').onclick = async () => {
  if (!board || board.gameState !== GameState.PLAYING) return;
  for (const b of [...board.blocks.values()]) if (b.kind !== KIND.WALL) board.blocks.delete(b.id);
  board._reindex();
  board.gameState = GameState.WON;
  hud.update(board);
  await finishLevel();
};

el('debug-lose').onclick = async () => {
  if (!board || board.gameState !== GameState.PLAYING) return;
  board.timeRemaining = 0;
  board.gameState = GameState.FAILED;
  board.failReason = 'time';
  hud.update(board);
  await finishLevel();
};

/** Replays the level's reference solution — a visual check on the generator. */
el('debug-solve').onclick = async () => {
  if (!board || busy) return;
  busy = true;
  input.locked = true;
  for (const step of level.solution) {
    const path = Array.isArray(step.path) ? step.path : Array.isArray(step.chemin) ? step.chemin : [];
    if (!path.length) continue;
    for (const pos of path.slice(1)) {
      const { events } = board.dragTowards(step.id, pos.x, pos.y);
      await view.apply(chimeExits(events));
      await new Promise((r) => setTimeout(r, 90));
    }
    // A step with no gate is a park: the block stays where its path ends.
    if (step.gate && board.blocks.has(step.id)) {
      const [dx, dy] = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[step.gate];
      const r = board.step(step.id, dx, dy);
      if (r.ok) await view.apply(chimeExits([r.event]));
    }
    await view.apply(board.endGesture(true));
    hud.update(board);
    // A pause between gestures, so a solution can be followed by eye.
    if (!fastAnimations) await new Promise((r) => setTimeout(r, 700));
  }
  busy = false;
  input.locked = false;
  if (board.gameState !== GameState.PLAYING) await finishLevel();
};

let fastAnimations = false;
el('debug-speed').onclick = () => {
  fastAnimations = !fastAnimations;
  setSpeed(fastAnimations ? 0.2 : 1);
  el('debug-speed').textContent = t(fastAnimations ? 'debug.speed.slow' : 'debug.speed.fast');
};

el('debug-noads').onclick = () => {
  const on = !currency.hasRemovedAds();
  currency.setAdsRemoved(on);
  el('debug-noads').textContent = t(on ? 'debug.noads.off' : 'debug.noads.on');
  screens.toast(t(on ? 'toast.ads.off' : 'toast.ads.on'));
  updateBanner(screens.current());
  if (!el('user-panel').hidden) updatePanel();
};

el('debug-coins').onclick = () => {
  currency.credit(500, 'debug');
  screens.toast(t('toast.coins', { n: currency.balance() }));
  updateBoosters();
  refreshDebug();
};

el('debug-events').onclick = () => {
  const list = el('debug-events-list');
  list.hidden = !list.hidden;
  if (!list.hidden) updateEventLog();
};

function updateEventLog() {
  const list = el('debug-events-list');
  if (list.hidden) return;
  list.replaceChildren(...recent(25).map((e) => {
    const li = document.createElement('li');
    const name = document.createElement('b');
    name.textContent = e.eventName;
    li.append(name, ' ', JSON.stringify(e.eventData));
    return li;
  }));
}
subscribe(() => updateEventLog());

el('debug-unlock').onclick = () => {
  const d = store.load();
  d.unlockedLevel = levels.totalLevels();
  store.save(d);
  screens.toast(t('toast.unlocked'));
  refreshDebug();
};

/** Debug hook: access to the board from the console. Prototype only. */
window.__game = {
  get board() { return board; },
  get view() { return view; },
  get input() { return input; },
  get audio() { return audio; },
  finishForCapture: () => (board?.gameState !== GameState.PLAYING ? finishLevel() : null),
  get level() { return level; },
  get busy() { return busy; },
};

function refreshDebug() {
  const d = store.load();
  el('debug-info').textContent =
    `unlocked: ${d.unlockedLevel}/${levels.totalLevels()} · ★ ${store.totalStars()} · ${d.coins} coins`
    + (board ? `\nboard ${board.W}×${board.H} · ${board.remaining()} blocks · ref. ${level.minDrags} drags` : '')
    + `\naudio ${JSON.stringify(audio.diagnostics())}`;
}

// Sound: preferences are restored before anything is displayed.
{
  const d = store.load();
  audio.setMusic(d.music !== false);
  audio.setSfx(d.sfx !== false);
}

/**
 * Startup: THE LEVEL DATABASE FIRST.
 *
 * Nothing can be displayed before it — the menu counts the levels, the map
 * draws the realms, the theme reads their palette. All of that is then read
 * synchronously; this `await` is the only place in the game that waits on the
 * database.
 */
(async () => {
  // The language first: everything after this writes text on screen.
  i18n.init();
  applyGlyphs(store.load().glyphs === true);
  applyNight(store.load().night === true);
  // The player's own numbers straight from the local save, BEFORE anything
  // waits on the network: the menu is on screen from the first frame, and
  // used to show index.html's "0" placeholders until the level database,
  // the session check and the cloud sync had all answered. `showMenu()`
  // repaints once they have, with whatever the sync brought.
  paintMenuFromSave();
  try {
    await levels.open();
    // The "go to level" field follows the database's total. Hard-coded in the
    // markup, it capped the input and made added levels unreachable from the
    // panel — and it can only be set HERE, the database alone knowing how many
    // levels it holds.
    el('debug-level').max = levels.totalLevels();
  } catch (e) {
    // Without the catalogue there is no game: better to say so than to show an
    // empty menu whose buttons would not answer. The likely cause is no longer a
    // database missing from disk but a first launch with no network — the
    // levels come from Supabase now, and only the first realm ships with the
    // application.
    document.getElementById('app').innerHTML =
      `<div class="boot-error"><h1>${t('boot.missing')}</h1>`
      + `<p>${t('boot.hint')}</p></div>`;
    theme.endBoot();
    console.error(e);
    return;
  }

  // Supabase session check. No session means the login screen, which offers an
  // offline route: this game must stay playable without an account.
  //
  // Both calls are best-effort, like every other Supabase access in the app
  // (see supabaseClient.js): a slow or failing network must never leave the
  // player stuck looking at the menu's static HTML placeholders ("0 étoiles",
  // "1 niveau" — index.html's markup before any JS has touched it) with no
  // way to recover short of backing out to a screen that happens to
  // re-render from local storage.

  // Declared BEFORE the first call below: `startGameLoop` is hoisted, this flag
  // is not, and a session already open at startup used to call it inside the
  // temporal dead zone — the game never started and the menu stayed on its
  // static placeholders.
  let started = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      document.body.appendChild(createLoginScreen(() => startGameLoop()));
      theme.endBoot();
    } else {
      // A session already open at cold start (the common case after the first
      // sign-in): pull whatever progress the account holds before the menu
      // renders, so a reinstalled app is not stuck showing an empty profile
      // until the player happens to reopen it.
      await api.syncFromCloud();
      startGameLoop();
    }
  } catch (e) {
    console.error('Session/sync check failed at startup:', e);
    startGameLoop();
  }

  // One listener, wired in both cases: signing in mid-session must start the
  // game, and signing out must put the login screen back.
  supabase.auth.onAuthStateChange(async (event, authSession) => {
    admin.forget();
    if (event === 'SIGNED_IN' && authSession) await api.syncFromCloud();
    // Re-checked on every transition, not just at startup: signing in or out
    // from within an already-running session (see the `started` guard in `startGameLoop`) is the
    // one case `startGameLoop()`'s own call would otherwise miss.
    updateAdminSection();
    if (event === 'SIGNED_IN' && authSession) {
      document.getElementById('login-container')?.remove();
      startGameLoop();
    } else if (event === 'SIGNED_OUT') {
      if (!document.getElementById('login-container')) {
        document.body.appendChild(createLoginScreen(() => startGameLoop()));
      }
      stopGameLoop();
    }
  });

  /**
   * Starts the game once authentication has been settled, one way or another.
   *
   * Guarded against a second call: `onAuthStateChange` fires again on a token
   * refresh, and opening the session twice would restart the daily streak and
   * register a second `pagehide` listener.
   *
   * The second call does NOTHING — it used to show the menu. Supabase emits
   * `SIGNED_IN` again when it refreshes or re-validates a session, repeatedly
   * when that fails, and each one pulled the player out of the level they were
   * playing. A real sign-in after a sign-out goes through `stopGameLoop()`
   * first, which resets `started`.
   */
  function startGameLoop() {
    if (started) return;
    started = true;
    updateAdminSection();
    const firstTime = !store.load().lastPlayedAt && !store.load().lastPlayDay;
    track(EV.APP_OPEN, {});
    if (firstTime) track(EV.FIRST_OPEN, {});

    const session = daily.openSession();
    if (session.newDay) track(EV.DAILY_OPEN, { streak: session.streak });
    payStreakRewards();
    // A run of wins lasts one sitting: coming back to the app starts a new one.
    api.resetLevelStreak();

    window.addEventListener('pagehide', () => track('session_ended', {}));
    showMenu();
  }

  /** Stops the game cleanly on sign-out. */
  function stopGameLoop() {
    started = false;
    stopClock();
    if (board) { board.gameState = 'IDLE'; hud.update(board); }
    if (input) { input.locked = true; busy = false; }
    adminPanel.close();
    screens.show('menu'); // forced back to the menu if signed out mid-game
  }
})();
