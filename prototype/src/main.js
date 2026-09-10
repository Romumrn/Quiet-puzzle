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
import { BoardView, setSpeed, conditionLabel } from './render/boardView.js';
import { InputHandler } from './input/input.js';
import * as api from './data/api.js';
import * as store from './data/save.js';
import * as screens from './ui/screens.js';
import * as mapScreen from './ui/mapScreen.js';
import * as theme from './ui/theme.js';
import * as editor from './ui/editor.js';
import { solve } from './core/solver.js';
import * as hud from './ui/gameplayUI.js';
import * as result from './ui/resultScreen.js';
import { AdBroker, PLACEMENT } from './monetization/brokerManager.js';
import * as currency from './monetization/currency.js';
import * as failOffer from './monetization/failOffer.js';
import * as daily from './meta/daily.js';
import * as dailyPuzzle from './meta/dailyPuzzle.js';
import * as themes from './meta/themes.js';
import { EVENTS as EV, levelContext } from './data/analytics.js';
import * as feedback from './meta/feedback.js';
import { track, recent, subscribe } from './data/events.js';
import { AudioManager } from './audio/audioManager.js';
import { supabase } from './data/supabaseClient.js';
import { createLoginScreen } from './ui/loginScreen.js';
import * as admin from './data/admin.js';
import * as adminPanel from './ui/adminPanel.js';

const el = (id) => document.getElementById(id);

let view = null;
let input = null;
let board = null;
let level = null;
/** The current submission when playing the daily puzzle, otherwise null. */
let dailyEntry = null;
/** The current draft when trying out a grid from the editor, otherwise null. */
let editorTrial = null;
let clock = null;
let busy = false;
let offerUsed = false;    // the continue offer is worth one use per attempt
let levelFailures = 0;    // used so the very first defeat is never cut by an ad
let levelStartedAt = 0;

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
  el('menu-stars').textContent = p.totalStars;
  el('menu-coins').textContent = p.coins;
  // "121 / 160" rather than "121": on its own, the number does not say where
  // you are — it read like a score, when it measures progress.
  el('menu-progress').textContent = `${p.currentLevel}/${levels.totalLevels()}`;
  await updateDailyPuzzleButton();
  updateStreakBadge();
  updateDailyGift();
  updateMuteDot();
  theme.apply(p.currentLevel); // the menu takes the colour of where the player is
  screens.show('menu');
  audio.startMusic();
  updateBanner('menu');
}

/**
 * Streak badge, on the home screen. It only shows from the second day: "1 day
 * streak" rewards nothing, it states that you are here.
 */
function updateStreakBadge() {
  const badge = el('streak-badge');
  const days = daily.streak();
  badge.hidden = days < 2;
  if (badge.hidden) return;
  const tier = daily.tierFor(days);
  const next = daily.nextTier(days);
  badge.textContent = `${tier.badge} ${t('streak.badge', { n: days })}`;
  badge.title = next
    ? t('streak.next', { n: next.days - days, what: rewardLabel(next.reward) })
    : '';
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
    else if (r.type === 'theme') themes.unlock(r.id, 'streak');
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
 * Daily gift: visible only while it can be claimed.
 *
 * `hidden` is set on both branches. Setting it only when the gift is available
 * left the button on screen after it had been claimed — it kept its place, and
 * a second tap did nothing at all, which reads as a broken button rather than
 * as a gift already taken.
 */
function updateDailyGift() {
  const button = el('btn-daily');
  const available = daily.canClaim();
  button.classList.remove('claimed');
  button.disabled = false;
  button.hidden = !available;
  if (!available) return;
  el('daily-title').textContent = t('menu.daily');
  el('daily-sub').textContent = t(daily.streak() > 1 ? 'menu.streak.plural' : 'menu.streak', { n: daily.streak() });
  el('daily-amount').textContent = `+${daily.todaysReward()}`;
}

/**
 * Claims the gift, then makes the button leave.
 *
 * It does not vanish on the spot: the coins have just been credited, and a
 * button that disappears under the finger leaves the player unsure of what
 * happened. So it acknowledges the tap (the `claimed` class scales it down and
 * fades it out, and the CSS collapses its height), and is hidden for good once
 * the animation has run. `animationend` would be more precise, but it never
 * fires when the player has asked for reduced motion — a timer always does.
 */
const GIFT_EXIT_MS = 420;

function claimDailyGift() {
  const button = el('btn-daily');
  if (button.disabled) return;
  const amount = daily.claim();
  if (!amount) { updateDailyGift(); return; }

  button.disabled = true;
  button.classList.add('claimed');
  screens.toast(t('toast.daily', { n: amount, days: daily.streak() }));
  updateMenuCounters();
  updateStreakBadge();
  setTimeout(() => {
    button.hidden = true;
    button.classList.remove('claimed');
    button.disabled = false;
  }, GIFT_EXIT_MS);
}

/** The banner only lives outside a game — the policy decides, not the caller. */
function updateBanner(screen) {
  ads.updateBanner(screen);
  el('app').classList.toggle('with-banner', !el('banner').hidden);
}

function showMap() {
  stopClock();
  result.hide();
  mapScreen.render(showBrief);
  screens.show('map');
  updateBanner('map');
}

async function showBrief(n) {
  stopClock();
  level = await api.getLevel(n);
  const rec = store.levelRecord(n);
  // The realm name comes from the CATALOGUE, not from the level: the database
  // stores it in every language, whereas `level.realm` is frozen at generation.
  el('brief-realm').textContent = i18n.realmText(levels.realmOf(n), 'name');
  el('brief-number').textContent = n;
  screens.renderStars(el('brief-stars'), rec.stars);
  el('brief-objective').textContent = hud.labelFor(level);
  el('brief-moves').textContent = level.moveLimit;
  el('brief-difficulty').textContent = i18n.realmText(levels.realmOf(n), 'difficulty');
  // The realm's novelty, announced at its first level only. A block kind never
  // seen must be named once; repeating it across the next nineteen levels would
  // turn the callout into scenery nobody reads any more.
  const novelty = el('brief-novelty');
  const realmEntry = (n - 1) % levels.levelsPerRealm() === 0 && levels.realmOf(n).introduces;
  novelty.hidden = !realmEntry;
  if (realmEntry) novelty.textContent = t('brief.new', { what: i18n.realmText(levels.realmOf(n), 'introduces') });
  el('brief-best').textContent = rec.bestScore ? t('brief.best', { n: rec.bestScore }) : '—';
  // The last level of a realm is noticeably harder than the others (see
  // levels.js): the briefing screen says so before the player commits, rather
  // than letting them find out mid-game.
  const isFinale = n === levels.realmOf(n).last;
  el('brief-final').hidden = !isFinale;
  el('brief-card').classList.toggle('final', isFinale);
  theme.apply(n);
  screens.show('brief');
  updateBanner('brief');
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
  await ads.showInterstitial({
    level: level.number,
    noAds: currency.hasRemovedAds(),
    firstFailureOfLevel: false,
  });
}

async function startLevel() {
  openPanel(false);
  result.hide();
  await adBeforeLevel();
  theme.apply(level.number);
  audio.resetRun();
  offerUsed = false;
  levelStartedAt = Date.now();
  const retry = levelFailures > 0;
  track(retry ? EV.LEVEL_RESTARTED : EV.LEVEL_STARTED,
    levelContext(level, { attempt: levelFailures + 1 }));
  // The first level doubles as the tutorial: this game has no other, and the
  // acquisition funnel needs that landmark.
  if (level.number === 1 && !retry) track(EV.TUTORIAL_STARTED, levelContext(level));
  board = new Board(level);
  board._solver = { solve }; // editor levels: no reference solution
  hud.mount(level);
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
  updateBoosters();
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
  const free = !currency.canAfford(currency.PRICES.HINT);
  const cost = el('hint-cost');
  cost.textContent = free ? t('ad.badge') : currency.PRICES.HINT;
  cost.classList.toggle('ad', free);
  el('btn-undo').disabled = !board || !board.canUndo();
}

/** Watches a rewarded ad for a booster. The clock is suspended meanwhile. */
async function boosterByAd(placement) {
  stopClock();
  const watched = await ads.showRewarded(placement);
  if (board?.gameState === GameState.PLAYING) startClock();
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
  if (b.kind === KIND.WALL) screens.toast(t('toast.sealed'));
  else if (b.kind === KIND.LOCKED) screens.toast(t('toast.locked', { what: conditionLabel(b.condition, board) }));
}

/** One finger movement: returns true if the block actually advanced. */
function onDrag(id, x, y) {
  if (busy || board.gameState !== GameState.PLAYING) return false;
  const before = gestureRemembered ? null : board.snapshot();
  const { events } = board.dragTowards(id, x, y);
  if (!events.length) return false;
  for (const e of events) if (e.type === 'exit') audio.exit();
  if (!gestureRemembered) { board.remember(before); gestureRemembered = true; }
  view.apply(events);
  hud.update(board);
  return true;
}

/** End of gesture: this is where a move is spent. */
async function onEnd(id, hasMoved) {
  gestureRemembered = false;
  updateBoosters();
  if (!hasMoved || board.gameState !== GameState.PLAYING) return;
  const events = board.endGesture(true);
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
    board.tick(1);
    hud.update(board);
    if (board.gameState !== GameState.PLAYING) await finishLevel();
  }, 1000);
}

function stopClock() {
  if (clock) { clearInterval(clock); clock = null; }
}

async function finishLevel() {
  stopClock();
  busy = true;
  input.locked = true;

  const won = board.gameState === GameState.WON;
  const duration = Math.round((Date.now() - levelStartedAt) / 1000);

  // Let it breathe before announcing the win.
  if (won) {
    await pause(PAUSE_BEFORE_SUCCESS);
    audio.victory();
    await pause(PAUSE_AFTER_ARPEGGIO);
  }

  // Defeat: offer to continue BEFORE recording the failure.
  if (!won && !offerUsed) {
    offerUsed = true;
    const choice = await failOffer.offer({ board, ads });
    // "Restart" relaunches the grid without going through the result screen:
    // the player has already seen they lost, telling them again is pointless.
    if (choice === 'retry') {
      busy = false;
      input.locked = false;
      startLevel();
      return;
    }
    if (choice) {
      failOffer.apply(board);
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
        drags: board.dragsUsed(),
        minDrags: level.minDrags || board.dragsUsed(),
        seconds: duration,
      });
      track('daily_puzzle_completed', { id: entry.id, score, duration });
      track(EV.DAILY_COMPLETED, { id: entry.id, score, duration });
      await updateDailyPuzzleButton();
      updateStreakBadge();
      showMenu();
      showLeaderboard(score);
    } else {
      showMenu();
    }
    busy = false;
    input.locked = false;
    return;
  }

  const res = await api.completeLevel(level.number, { score: board.dragsUsed(), stars, failed: !won, timeMs: duration * 1000 });

  // The interstitial no longer plays HERE but when the next level opens (see
  // `startLevel`). We just advance the policy's counter: a level ending is
  // indeed what makes an ad eligible.
  ads.policy.noteLevelEnding();

  result.show({
    won,
    stars,
    score: board.dragsUsed(),
    duration,
    level: level.number,
    coinsEarned: res.coinsEarned,
    reason: board.failReason,
    remaining: board.remaining(),
    noAds: currency.hasRemovedAds(),
    onBannerShown: () => track('ad_impression', { adType: 'banner', placement: PLACEMENT.BANNER_RESULT }),
    onDouble: async () => {
      const watched = await ads.showRewarded(PLACEMENT.REWARDED_DOUBLE);
      if (!watched) return false;
      currency.credit(res.coinsEarned, 'double_reward');
      return true;
    },
    onMap: showMap,
    onRetry: startLevel,
    onNext: async () => {
      if (level.number < levels.totalLevels()) { await showBrief(level.number + 1); startLevel(); }
      else showMap();
    },
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

el('btn-play').onclick = showMap;

el('btn-daily').onclick = claimDailyGift;

el('btn-restart').onclick = () => { if (!busy) startLevel(); };

/** Hammer: the player POINTS AT the block to remove, we do not pick one for them. */
el('btn-hammer').onclick = async () => {
  if (!board || busy || board.gameState !== GameState.PLAYING || hammerMode) return;
  if (!await boosterByAd(PLACEMENT.REWARDED_HAMMER)) return;
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
  if (!await boosterByAd(PLACEMENT.REWARDED_UNDO)) return;
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

  if (currency.canAfford(currency.PRICES.HINT)) {
    if (!currency.debit(currency.PRICES.HINT, 'hint')) return;
  } else {
    stopClock();
    const watched = await ads.showRewarded(PLACEMENT.REWARDED_HINT);
    startClock();
    if (!watched) return;
  }

  track('hint_used', { level: level.number, blockId: advice.id });
  view.highlight(advice.id);
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
  el('user-avatar').textContent = p.playerLevel;
  el('user-level').textContent = p.playerLevel;
  el('user-next').textContent = `${p.xpIntoLevel} / ${p.xpRequired} XP`;
  el('user-xp-fill').style.width = `${(p.xpIntoLevel / p.xpRequired) * 100}%`;
  el('user-stars').textContent = `${p.totalStars}/${p.maxStars}`;
  el('user-levels').textContent = p.levelsCompleted;
  el('user-coins').textContent = p.coins;

  const d = store.load();
  el('opt-music').checked = d.music !== false;
  el('opt-sfx').checked = d.sfx !== false;
  el('opt-glyphs').checked = d.glyphs === true;
  el('opt-noads').checked = currency.hasRemovedAds();
  buildLanguageChoice();
  updateThemes();
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
    // Each language is written IN that language: it is the only label a player
    // lost in a language they cannot read will recognise.
    o.textContent = L.name;
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

el('fb-copy').onclick = async () => {
  const report = currentReport();
  if (!report) return;
  try {
    await navigator.clipboard.writeText(feedback.asText(report));
    screens.toast(t('feedback.copied'));
  } catch {
    // Clipboard refused (insecure context, permission): the download route is
    // still open, and it carries the screenshots as a bonus.
    el('fb-download').click();
  }
};

/**
 * Download of the complete report, screenshots included. This is the ONLY route
 * an image can travel by: no `mailto:` knows how to attach a file, and there is
 * no server to entrust it to.
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

  el('shop-packs').replaceChildren(...currency.PACKS.map((pack) => {
    const card = document.createElement('button');
    card.className = 'shop-pack';
    const total = Math.round(pack.coins * (1 + pack.bonus / 100));

    const amount = document.createElement('b');
    amount.textContent = total;
    const bonus = document.createElement('small');
    bonus.className = 'shop-pack-bonus';
    bonus.textContent = pack.bonus ? t('shop.pack.bonus', { n: pack.bonus }) : '';
    const price = document.createElement('span');
    price.className = 'shop-pack-price';
    price.textContent = pack.price;

    card.append(amount, bonus, price);
    card.onclick = () => {
      track(EV.IAP_STARTED, { productId: pack.id, price: pack.price });
      const paid = currency.buyPack(pack.id);
      track(EV.IAP_COMPLETED, { productId: pack.id, price: pack.price, coins: paid });
      updateShop();
      updateMenuCounters();
      screens.toast(t('shop.bought', { n: paid }));
    };
    return card;
  }));
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
function showLeaderboard(myScore) {
  const list = dailyPuzzle.leaderboard();
  const me = list.find((e) => e.me);
  el('rank-mine').textContent = me
    ? `${t('daily.score', { score: myScore ?? me.score })} · ${t('daily.rank', { rank: me.rank, total: list.length })}`
    : '';
  el('rank-list').replaceChildren(...list.slice(0, 10).map((e) => {
    const li = document.createElement('li');
    if (e.me) li.className = 'me';
    const who = document.createElement('span');
    who.textContent = e.me ? t('daily.rank.me') : e.author;
    const pts = document.createElement('b');
    pts.textContent = e.score;
    li.append(who, pts);
    return li;
  }));
  if (!list.length) el('rank-list').textContent = t('daily.rank.empty');
  el('overlay-rank').hidden = false;
}

/**
 * Theme grid. A locked theme stays VISIBLE, with its condition: what you cannot
 * have yet is what makes you want to carry on, provided you know what to do to
 * get it.
 */
async function updateThemes() {
  const host = el('opt-themes');
  const profile = await api.getProfile();
  const current = themes.chosen();

  const followRealms = document.createElement('button');
  followRealms.className = 'theme-tile' + (current ? '' : ' sel');
  followRealms.innerHTML = '<span class="theme-emoji">🎨</span>';
  const name = document.createElement('small');
  name.textContent = t('theme.worlds');
  followRealms.append(name);
  followRealms.onclick = () => { themes.choose(null); theme.apply(profile.currentLevel); updateThemes(); };

  host.replaceChildren(followRealms, ...themes.THEMES.map((th) => {
    const open = themes.isUnlocked(th, profile);
    const tile = document.createElement('button');
    tile.className = 'theme-tile' + (current === th.id ? ' sel' : '') + (open ? '' : ' locked');
    tile.style.setProperty('--preview', th.palette[0]);
    tile.innerHTML = `<span class="theme-emoji">${th.emoji}</span>`;
    const label = document.createElement('small');
    label.textContent = open ? th.id : themes.conditionLabel(th, t);
    tile.append(label);
    if (!open) {
      tile.disabled = true;
      tile.title = t('theme.locked', { what: themes.conditionLabel(th, t) });
    } else {
      tile.onclick = () => { themes.choose(th.id); theme.apply(profile.currentLevel); updateThemes(); };
    }
    return tile;
  }));
}

el('opt-noads').onchange = (ev) => {
  currency.setAdsRemoved(ev.target.checked);
  if (ev.target.checked) track(EV.REMOVE_ADS_PURCHASED, { simulated: true });
  updateBanner(screens.current());
  screens.toast(t(ev.target.checked ? 'toast.ads.off' : 'toast.ads.on'));
};

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
 * The admin section of the user menu.
 *
 * Hidden by default and revealed only for an account holding the role. This is
 * a display decision and nothing more: everything the panel can do is gated
 * server-side by RLS, so revealing the button by hand in the console gets you a
 * panel that answers "permission denied". See src/data/admin.js.
 */
async function updateAdminSection() {
  const section = el('user-admin');
  const allowed = await admin.isAdmin();
  section.hidden = !allowed;
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
      await view.apply(events);
      await new Promise((r) => setTimeout(r, 90));
    }
    if (board.blocks.has(step.id)) {
      const [dx, dy] = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[step.gate];
      const r = board.step(step.id, dx, dy);
      if (r.ok) await view.apply([r.event]);
    }
    await view.apply(board.endGesture(true));
    hud.update(board);
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
  try {
    await levels.open();
    // The "go to level" field follows the database's total. Hard-coded in the
    // markup, it capped the input and made added levels unreachable from the
    // panel — and it can only be set HERE, the database alone knowing how many
    // levels it holds.
    el('debug-level').max = levels.totalLevels();
  } catch (e) {
    // Without the database there is no game: better to say so than to show an
    // empty menu whose buttons would not answer.
    document.getElementById('app').innerHTML =
      `<div class="boot-error"><h1>${t('boot.missing')}</h1>`
      + `<p>${t('boot.hint', { cmd: '<code>node tools/build-levels.mjs</code>' })}</p></div>`;
    console.error(e);
    return;
  }

  // Supabase session check. No session means the login screen, which offers an
  // offline route: this game must stay playable without an account.
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    document.body.appendChild(createLoginScreen(() => startGameLoop()));
  } else {
    startGameLoop();
  }

  // One listener, wired in both cases: signing in mid-session must start the
  // game, and signing out must put the login screen back.
  supabase.auth.onAuthStateChange((event, authSession) => {
    admin.forget();
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
   */
  let started = false;
  function startGameLoop() {
    if (started) { showMenu(); return; }
    started = true;
    const firstTime = !store.load().lastPlayedAt && !store.load().lastPlayDay;
    track(EV.APP_OPEN, {});
    if (firstTime) track(EV.FIRST_OPEN, {});

    const session = daily.openSession();
    if (session.newDay) track(EV.DAILY_OPEN, { streak: session.streak });
    payStreakRewards();

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
