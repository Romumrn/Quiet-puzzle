/**
 * Ad display policy — pure logic, no SDK and no DOM.
 *
 * This is where the key decision lives: integrating AppLovin MAX is mechanical
 * (doc §5.2), deciding WHEN to show an ad is not. Too many interstitials at the
 * wrong moment hurt retention more than they help, and a player's first minutes
 * are the most fragile.
 *
 * Kept separate from the rest for Node testing: see tools/test.mjs.
 */

export const REGLES = Object.freeze({
  /** No interstitial before this level: let the player settle into the game. */
  NIVEAU_MIN: 3,
  /** Minimum delay between two interstitials. */
  INTERVALLE_MIN_MS: 90_000,
  /** One interstitial every N level endings. */
  FINS_PAR_PUB: 2,
  /** After a rewarded ad, give the player a breather. */
  DELAI_APRES_RECOMPENSE_MS: 45_000,
  /**
   * Never show an interstitial on the first defeat of a level: that's exactly
   * when the player wants to restart immediately, and interrupting them there is
   * the surest way to make them quit.
   */
  PAS_SUR_PREMIERE_DEFAITE: true,
});

/** Screens where a banner is acceptable. Never during a game. */
const ECRANS_BANNIERE = new Set(['menu', 'map', 'brief']);

export class RegiePolicy {
  constructor(regles = REGLES, now = () => Date.now()) {
    this.regles = regles;
    this.now = now;
    this.derniereInterstitielle = 0;
    this.derniereRecompensee = 0;
    this.finsDepuisPub = 0;
  }

  /**
   * @param {{niveau:number, noAds:boolean, premiereDefaiteDuNiveau:boolean}} ctx
   * @returns {{ok:boolean, raison:string}} the reason is used in analytics logs and
   *          the QA panel: we must be able to explain why an ad was not shown.
   */
  peutAfficherInterstitiel(ctx) {
    if (ctx.noAds) return { ok: false, raison: 'purchase without ads' };
    if (ctx.niveau < this.regles.NIVEAU_MIN) return { ok: false, raison: `before level ${this.regles.NIVEAU_MIN}` };
    if (this.regles.PAS_SUR_PREMIERE_DEFAITE && ctx.premiereDefaiteDuNiveau) {
      return { ok: false, raison: 'first defeat of the level' };
    }
    const t = this.now();
    if (t - this.derniereInterstitielle < this.regles.INTERVALLE_MIN_MS) {
      return { ok: false, raison: 'minimum interval not elapsed' };
    }
    if (t - this.derniereRecompensee < this.regles.DELAI_APRES_RECOMPENSE_MS) {
      return { ok: false, raison: 'rewarded ad too recent' };
    }
    if (this.finsDepuisPub < this.regles.FINS_PAR_PUB) {
      return { ok: false, raison: `${this.finsDepuisPub}/${this.regles.FINS_PAR_PUB} level endings` };
    }
    return { ok: true, raison: 'ok' };
  }

  /** Call at every level ending, with or without an ad. */
  noterFinDeNiveau() { this.finsDepuisPub++; }

  noterInterstitiel() {
    this.derniereInterstitielle = this.now();
    this.finsDepuisPub = 0;
  }

  noterRecompensee() { this.derniereRecompensee = this.now(); }

  /** A banner is only shown outside play: during a game, it steals space from the board
   *  and causes accidental taps on a drag gesture. */
  peutAfficherBanniere(ecran, noAds) {
    return !noAds && ECRANS_BANNIERE.has(ecran);
  }
}
