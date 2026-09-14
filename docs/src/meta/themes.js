/**
 * Themes: the skins the player unlocks and picks.
 *
 * Until now the interface hue was imposed by the current realm, and shifted
 * under the player's feet as they progressed. A theme is the opposite: a choice
 * that sticks. The two coexist — with no theme chosen we keep the realm's hue,
 * which is the original behaviour.
 *
 * Each theme sets an interface hue and a block palette, exactly like a realm:
 * it is the same mechanism, applied on the player's request rather than on
 * their progress.
 *
 * The unlock conditions are DIFFERENT in nature on purpose — levels, stars,
 * streak, purchase. A theme depending only on progress would teach nothing
 * about the player wearing it.
 */

import * as store from '../data/save.js';
import { track } from '../data/events.js';

export const THEMES = Object.freeze([
  {
    id: 'sakura', emoji: '🌸', hue: 345,
    palette: ['#eb9aad', '#93bde4', '#97cfb6', '#e9cd8c', '#bdaadd', '#f0b18b'],
    // The original theme: owned from the start, it acts as a fallback and a
    // point of reference.
    condition: { type: 'always' },
  },
  {
    id: 'ocean', emoji: '🌊', hue: 202,
    palette: ['#e0919f', '#7fb6dd', '#7fc9c4', '#dcc98a', '#a3aade', '#e2a487'],
    condition: { type: 'levels', value: 20 },
  },
  {
    id: 'forest', emoji: '🌲', hue: 138,
    palette: ['#d99aa0', '#8bb6c4', '#84c48f', '#d3c586', '#aaa1cf', '#dba983'],
    condition: { type: 'levels', value: 60 },
  },
  {
    id: 'sunset', emoji: '🌅', hue: 22,
    palette: ['#ef9a86', '#8fb0cf', '#a6c894', '#f0c579', '#c2a0cc', '#eda775'],
    condition: { type: 'stars', value: 150 },
  },
  {
    id: 'night', emoji: '🌙', hue: 258,
    palette: ['#cf90b4', '#8ea3dd', '#84c3b4', '#d9c184', '#ab97dc', '#cf9a92'],
    condition: { type: 'stars', value: 400 },
  },
  {
    id: 'zen', emoji: '🍵', hue: 96,
    palette: ['#d29aa2', '#95b8c8', '#a8c894', '#d8c98d', '#b3a6cd', '#d9a98d'],
    condition: { type: 'streak', value: 7 },
  },
  {
    id: 'snow', emoji: '❄️', hue: 210,
    palette: ['#dda3ae', '#9cc3e2', '#96cfcc', '#dfd39b', '#b3b6e0', '#d9b8a6'],
    condition: { type: 'premium' },
  },
]);

export const byId = (id) => THEMES.find((t) => t.id === id) || null;

/**
 * Is this theme owned? Conditions are evaluated EVERY TIME rather than recorded
 * once and for all: a player who resets their progress must lose again what it
 * had opened, and a theme granted by a streak stays owned because that one is
 * actually stored.
 */
export function isUnlocked(theme, profile = null) {
  const d = store.load();
  if ((d.themes || []).includes(theme.id)) return true;
  const c = theme.condition;
  if (c.type === 'always') return true;
  if (c.type === 'premium') return d.noAds === true;
  if (c.type === 'levels') return (d.unlockedLevel - 1) >= c.value;
  if (c.type === 'streak') return (d.streak || 0) >= c.value;
  if (c.type === 'stars') return (profile?.totalStars ?? totalStars(d)) >= c.value;
  return false;
}

const totalStars = (d) =>
  Object.values(d.levels || {}).reduce((sum, l) => sum + (l.stars || 0), 0);

/** Opens a theme unconditionally — streak reward, purchase. */
export function unlock(id, source) {
  const d = store.load();
  if ((d.themes || []).includes(id)) return false;
  d.themes = [...(d.themes || []), id];
  store.save(d);
  track('theme_unlocked', { theme: id, source });
  return true;
}

/** The chosen theme, or null when the player follows the realms' hues. */
export const chosen = () => store.load().theme || null;

export function choose(id) {
  const d = store.load();
  d.theme = id;
  store.save(d);
  track('theme_selected', { theme: id || 'realms' });
}

/** What is missing to open this theme, in plain words. */
export function conditionLabel(theme, t) {
  const c = theme.condition;
  if (c.type === 'always') return '';
  if (c.type === 'premium') return t('theme.cond.premium');
  return t(`theme.cond.${c.type}`, { n: c.value });
}
