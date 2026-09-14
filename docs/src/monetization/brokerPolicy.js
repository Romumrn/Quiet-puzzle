/**
 * Advertising display policy — pure logic, no SDK and no DOM.
 *
 * This is where the important part is decided: integrating AppLovin MAX is
 * mechanical (doc §5.2), deciding WHEN to show an ad is not. One interstitial
 * too many at the wrong moment does more damage to retention than it earns, and
 * a player's first few minutes are the most fragile.
 *
 * Split out from the rest so it is testable under Node: see tools/test.mjs.
 *
 * FILENAME WARNING — this file is deliberately not called `adPolicy.js`.
 * Generic ad blockers match any script whose URL contains `ad`, `banner` or
 * `pub`, and block it with `net::ERR_BLOCKED_BY_CLIENT`. Since `main.js`
 * imports it statically, the whole application would stay inert — buttons
 * included — for every player running a blocker, even though the ads it manages
 * are entirely simulated. Any future filename must dodge those filters too.
 */

export const RULES = Object.freeze({
  /** No interstitial before this level: let the player get attached first. */
  MIN_LEVEL: 3,
  /** Floor delay between two interstitials. */
  MIN_INTERVAL_MS: 90_000,
  /** One interstitial every N level endings. */
  ENDINGS_PER_AD: 2,
  /** After a rewarded ad, let things breathe. */
  DELAY_AFTER_REWARDED_MS: 45_000,
  /**
   * Never an interstitial on the first failure of a level: that is exactly the
   * moment the player wants to start over immediately, and interrupting them
   * there is the surest way to make them quit.
   */
  NOT_ON_FIRST_FAILURE: true,
});

/** Screens where a banner is acceptable. Never during a game. */
const BANNER_SCREENS = new Set(['menu', 'map', 'brief']);

export class BrokerPolicy {
  constructor(rules = RULES, now = () => Date.now()) {
    this.rules = rules;
    this.now = now;
    this.lastInterstitial = 0;
    this.lastRewarded = 0;
    this.endingsSinceAd = 0;
  }

  /**
   * @param {{level:number, noAds:boolean, firstFailureOfLevel:boolean}} ctx
   * @returns {{ok:boolean, reason:string}} the reason feeds the analytics log
   *          and the QA panel: every ad NOT shown must be explainable.
   */
  canShowInterstitial(ctx) {
    if (ctx.noAds) return { ok: false, reason: 'no-ads purchase' };
    if (ctx.level < this.rules.MIN_LEVEL) return { ok: false, reason: `before level ${this.rules.MIN_LEVEL}` };
    if (this.rules.NOT_ON_FIRST_FAILURE && ctx.firstFailureOfLevel) {
      return { ok: false, reason: 'first failure of the level' };
    }
    const t = this.now();
    if (t - this.lastInterstitial < this.rules.MIN_INTERVAL_MS) {
      return { ok: false, reason: 'minimum interval not elapsed' };
    }
    if (t - this.lastRewarded < this.rules.DELAY_AFTER_REWARDED_MS) {
      return { ok: false, reason: 'rewarded ad too recent' };
    }
    if (this.endingsSinceAd < this.rules.ENDINGS_PER_AD) {
      return { ok: false, reason: `${this.endingsSinceAd}/${this.rules.ENDINGS_PER_AD} level endings` };
    }
    return { ok: true, reason: 'ok' };
  }

  /** Call at every level ending, whether an ad is shown or not. */
  noteLevelEnding() { this.endingsSinceAd++; }

  noteInterstitial() {
    this.lastInterstitial = this.now();
    this.endingsSinceAd = 0;
  }

  noteRewarded() { this.lastRewarded = this.now(); }

  /** A banner only shows outside a game: during play it steals room from the
   *  board and causes accidental taps on a drag. */
  canShowBanner(screen, noAds) {
    return !noAds && BANNER_SCREENS.has(screen);
  }
}
