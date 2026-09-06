/**
 * AdManager — équivalent de Scripts/Monetization/AdManager.cs (doc §5.2)
 *
 * Façade sur le réseau publicitaire. Les méthodes reprennent celles de
 * l'intégration AppLovin MAX du document (`showRewardedAd`, `showInterstitial`,
 * `showBanner`, `hideBanner`) : brancher le vrai SDK reviendra à remplacer le
 * corps de `_jouer()` par les appels `MaxSdk`, sans toucher aux appelants.
 *
 * Ici, les pubs sont SIMULEES par un panneau plein écran avec décompte, pour que
 * l'emplacement et le rythme soient jugeables avant tout contrat régie.
 *
 * Le cadencement vit dans adPolicy.js (logique pure, testée).
 */

import { AdPolicy } from './adPolicy.js';
import { track } from '../data/events.js';
import { t } from '../ui/i18n.js';
import * as currency from './currency.js';

/** Emplacements, tels qu'ils remonteront dans les rapports de la régie. */
export const PLACEMENT = Object.freeze({
  INTERSTITIEL_FIN_NIVEAU: 'interstitial_level_end',
  RECOMPENSE_CONTINUER: 'rewarded_continue',
  RECOMPENSE_DOUBLER: 'rewarded_double_coins',
  RECOMPENSE_INDICE: 'rewarded_hint',
  RECOMPENSE_MARTEAU: 'rewarded_hammer',
  RECOMPENSE_TEMPS: 'rewarded_extra_time',
  RECOMPENSE_ANNULER: 'rewarded_undo',
  BANNIERE: 'banner_menu',
});

const DUREE_INTERSTITIEL = 5;  // secondes avant de pouvoir fermer
const DUREE_RECOMPENSEE = 5;   // secondes à regarder pour toucher la récompense

export class AdManager {
  constructor({ overlay, banner, policy } = {}) {
    this.overlay = overlay;
    this.banner = banner;
    this.policy = policy || new AdPolicy();
    this.enCours = false;
    /** Simule l'indisponibilité d'inventaire (fill rate) — doc §10, "Low Fill Rates". */
    this.tauxRemplissage = 1;
  }

  // --- Interstitielles -----------------------------------------------------

  /**
   * @returns {Promise<{montree:boolean, raison:string}>}
   * Ne montre la pub que si la politique l'autorise. La raison du refus est
   * journalisée : on doit pouvoir expliquer chaque pub non affichée.
   */
  async montrerInterstitiel(ctx) {
    const verdict = this.policy.peutAfficherInterstitiel(ctx);
    if (!verdict.ok) {
      track('ad_skipped', { adType: 'interstitial', placement: PLACEMENT.INTERSTITIEL_FIN_NIVEAU, raison: verdict.raison });
      return { montree: false, raison: verdict.raison };
    }
    if (Math.random() > this.tauxRemplissage) {
      track('ad_no_fill', { adType: 'interstitial' });
      return { montree: false, raison: 'inventaire indisponible' };
    }

    this.policy.noterInterstitiel();
    track('ad_started', { adType: 'interstitial', placement: PLACEMENT.INTERSTITIEL_FIN_NIVEAU });
    await this._jouer({ type: 'interstitial', duree: DUREE_INTERSTITIEL, titre: t('ad.title') });
    track('ad_watched', { adType: 'interstitial', placement: PLACEMENT.INTERSTITIEL_FIN_NIVEAU, revenue: 0.012 });
    return { montree: true, raison: 'ok' };
  }

  // --- Pubs récompensées ---------------------------------------------------

  /** Toujours proposées, même après l'achat "sans pub" : elles sont choisies
   *  par le joueur et lui rapportent quelque chose. */
  estRecompenseePrete() { return Math.random() <= this.tauxRemplissage; }

  /** @returns {Promise<boolean>} vrai si la récompense est due. */
  async montrerRecompensee(placement) {
    if (this.enCours) return false;
    if (!this.estRecompenseePrete()) {
      track('ad_no_fill', { adType: 'rewarded', placement });
      return false;
    }
    track('ad_started', { adType: 'rewarded', placement });
    const termine = await this._jouer({ type: 'rewarded', duree: DUREE_RECOMPENSEE, titre: t('ad.title.rewarded') });
    this.policy.noterRecompensee();
    if (termine) track('ad_watched', { adType: 'rewarded', placement, revenue: 0.045 });
    else track('ad_abandoned', { adType: 'rewarded', placement });
    return termine;
  }

  // --- Bannière ------------------------------------------------------------

  majBanniere(ecran) {
    if (!this.banner) return;
    const visible = this.policy.peutAfficherBanniere(ecran, currency.aSupprimeLesPubs());
    this.banner.hidden = !visible;
    if (visible) track('ad_impression', { adType: 'banner', placement: PLACEMENT.BANNIERE, ecran });
  }

  // --- Simulation ----------------------------------------------------------

  /**
   * Remplace intégralement les appels SDK. Affiche un panneau plein écran avec
   * décompte ; pour une récompensée, la fermeture anticipée annule la récompense.
   * @returns {Promise<boolean>} vrai si la pub est allée à son terme
   */
  _jouer({ type, duree, titre }) {
    if (!this.overlay) return Promise.resolve(true);
    this.enCours = true;

    const titreEl = this.overlay.querySelector('.ad-title');
    const compteur = this.overlay.querySelector('.ad-count');
    const fermer = this.overlay.querySelector('.ad-close');
    const note = this.overlay.querySelector('.ad-note');

    titreEl.textContent = titre;
    note.textContent = t(type === 'rewarded' ? 'ad.note.rewarded' : 'ad.note');
    fermer.hidden = true;
    this.overlay.hidden = false;

    return new Promise((resolve) => {
      let reste = duree;
      compteur.textContent = reste;
      const fin = (termine) => {
        clearInterval(minuteur);
        this.overlay.hidden = true;
        this.enCours = false;
        fermer.onclick = null;
        resolve(termine);
      };
      const minuteur = setInterval(() => {
        reste--;
        compteur.textContent = Math.max(0, reste);
        if (reste <= 0) {
          fermer.hidden = false;
          fermer.textContent = t(type === 'rewarded' ? 'ad.claim' : 'ad.close');
          fermer.onclick = () => fin(true);
          clearInterval(minuteur);
        }
      }, 1000);

      // Une récompensée peut être abandonnée : bouton d'abandon après 2 s.
      if (type === 'rewarded') {
        setTimeout(() => {
          if (!this.overlay.hidden && fermer.hidden) {
            fermer.hidden = false;
            fermer.textContent = t('ad.skip');
            fermer.onclick = () => fin(false);
          }
        }, 2000);
      }
    });
  }
}
