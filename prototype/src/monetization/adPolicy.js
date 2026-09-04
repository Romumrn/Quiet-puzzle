/**
 * Politique d'affichage publicitaire — logique pure, sans SDK ni DOM.
 *
 * C'est ici que se joue l'essentiel : intégrer AppLovin MAX est mécanique
 * (doc §5.2), décider QUAND montrer une pub ne l'est pas. Une interstitielle
 * de trop au mauvais moment fait plus de dégâts en rétention qu'elle ne
 * rapporte, et les premières minutes d'un joueur sont les plus fragiles.
 *
 * Séparée du reste pour être testable sous Node : voir tools/test.mjs.
 */

export const REGLES = Object.freeze({
  /** Aucune interstitielle avant ce niveau : on laisse le joueur s'attacher. */
  NIVEAU_MIN: 3,
  /** Délai plancher entre deux interstitielles. */
  INTERVALLE_MIN_MS: 90_000,
  /** Une interstitielle une fin de niveau sur N. */
  FINS_PAR_PUB: 2,
  /** Après une pub récompensée, on laisse respirer. */
  DELAI_APRES_RECOMPENSE_MS: 45_000,
  /**
   * Jamais d'interstitielle sur la première défaite d'un niveau : c'est
   * exactement le moment où le joueur veut recommencer immédiatement, et
   * l'interrompre là est le meilleur moyen de le faire quitter.
   */
  PAS_SUR_PREMIERE_DEFAITE: true,
});

/** Écrans où une bannière est acceptable. Jamais pendant une partie. */
const ECRANS_BANNIERE = new Set(['menu', 'map', 'brief']);

export class AdPolicy {
  constructor(regles = REGLES, now = () => Date.now()) {
    this.regles = regles;
    this.now = now;
    this.derniereInterstitielle = 0;
    this.derniereRecompensee = 0;
    this.finsDepuisPub = 0;
  }

  /**
   * @param {{niveau:number, noAds:boolean, premiereDefaiteDuNiveau:boolean}} ctx
   * @returns {{ok:boolean, raison:string}} la raison sert au journal analytics
   *          et au panneau QA : on doit pouvoir expliquer chaque pub non montrée.
   */
  peutAfficherInterstitiel(ctx) {
    if (ctx.noAds) return { ok: false, raison: 'achat sans pub' };
    if (ctx.niveau < this.regles.NIVEAU_MIN) return { ok: false, raison: `avant le niveau ${this.regles.NIVEAU_MIN}` };
    if (this.regles.PAS_SUR_PREMIERE_DEFAITE && ctx.premiereDefaiteDuNiveau) {
      return { ok: false, raison: 'première défaite du niveau' };
    }
    const t = this.now();
    if (t - this.derniereInterstitielle < this.regles.INTERVALLE_MIN_MS) {
      return { ok: false, raison: 'intervalle minimum non écoulé' };
    }
    if (t - this.derniereRecompensee < this.regles.DELAI_APRES_RECOMPENSE_MS) {
      return { ok: false, raison: 'pub récompensée trop récente' };
    }
    if (this.finsDepuisPub < this.regles.FINS_PAR_PUB) {
      return { ok: false, raison: `${this.finsDepuisPub}/${this.regles.FINS_PAR_PUB} fins de niveau` };
    }
    return { ok: true, raison: 'ok' };
  }

  /** À appeler à chaque fin de niveau, qu'une pub soit montrée ou non. */
  noterFinDeNiveau() { this.finsDepuisPub++; }

  noterInterstitiel() {
    this.derniereInterstitielle = this.now();
    this.finsDepuisPub = 0;
  }

  noterRecompensee() { this.derniereRecompensee = this.now(); }

  /** Une bannière ne s'affiche que hors partie : pendant le jeu, elle vole de
   *  la place au plateau et provoque des clics accidentels sur un glissé. */
  peutAfficherBanniere(ecran, noAds) {
    return !noAds && ECRANS_BANNIERE.has(ecran);
  }
}
