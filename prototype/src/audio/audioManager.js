/**
 * AudioManager — équivalent de Scripts/Audio/AudioManager.cs, MusicPlayer.cs et
 * SoundEffects.cs (doc §4).
 *
 * Web Audio plutôt que des balises <audio> : celles-ci ont une latence de
 * plusieurs dizaines de millisecondes et se superposent mal, ce qui est
 * rédhibitoire pour un son déclenché par un geste et qui peut partir plusieurs
 * fois par seconde.
 *
 * Deux contraintes de navigateur sont traitées ici :
 *  - le son est interdit tant que l'utilisateur n'a pas touché la page ; le
 *    contexte est donc créé endormi et réveillé au premier geste ;
 *  - une page en arrière-plan doit se taire, sinon la musique continue dans le
 *    dos du joueur.
 */

import { MUSIQUE, SORTIES } from './manifest.js';

const VOLUME_MUSIQUE = 0.34;
const VOLUME_EFFETS = 0.62;
const FONDU = 1.6;          // secondes, entrée et sortie de la musique

/**
 * Degré du carillon au n-ième pas d'une série, en aller-retour.
 *
 * Le motif fait 2×(N−1) pas : il monte du grave à l'aigu, puis redescend sans
 * rejouer ni l'extrémité aiguë ni l'extrémité grave deux fois de suite — un
 * simple modulo les aurait doublées, et le pivot s'entend tout de suite.
 */
export function degreDeLaSerie(pas, notes = SORTIES.length) {
  if (notes < 2) return 0;
  const periode = 2 * (notes - 1);
  const p = ((pas % periode) + periode) % periode;
  return p < notes ? p : periode - p;
}

/** Au-delà de ce délai, la série de sorties repart du grave. */
const REPRISE_SERIE_MS = 2600;

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.pret = false;
    // Musique et effets se coupent séparément : beaucoup de joueurs veulent
    // garder le retour sonore de leurs actions tout en jouant sans musique.
    this.musiqueActive = true;
    this.effetsActifs = true;
    this.tampons = new Map();
    this.musique = null;
    this.pas = 0;
    this.degre = 0;
    this.derniereSortie = 0;

    /**
     * Le premier geste de l'utilisateur débloque le son.
     *
     * `touchend` et `click` figurent dans la liste en plus de `pointerdown` :
     * Safari sur iOS ne considère pas toujours un `pointerdown` comme le geste
     * qui autorise la lecture, alors qu'il accepte les deux autres. Les
     * écouteurs restent posés tant que le contexte n'a pas réellement démarré,
     * pour retenter au geste suivant.
     */
    this._reveil = () => this.reveiller();
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) {
      window.addEventListener(ev, this._reveil, { once: false, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  // --- Cycle de vie --------------------------------------------------------

  /**
   * Débloque la sortie audio d'iOS.
   *
   * Sur iPhone, un son joué uniquement par Web Audio est classé « ambient » :
   * le petit interrupteur latéral le coupe, et le joueur n'entend rien sans
   * comprendre pourquoi. Lire une fois un élément `<audio>` — ici un silence de
   * quelques octets — au cours d'un vrai geste bascule la session dans la
   * catégorie de lecture, et le reste suit.
   *
   * L'échec est sans conséquence : sur les navigateurs qui n'en ont pas besoin,
   * cette lecture ne s'entend pas, et si elle est refusée le jeu continue.
   */
  _debloquerIOS() {
    if (this._debloque) return;
    this._debloque = true;
    try {
      const silence = new Audio(
        'data:audio/mp4;base64,AAAAHGZ0eXBNNEEgAAAAAE00QSBpc29tbXA0MgAAAAhmcmVlAAAAG21kYXQAAAGzABAHAAABthADAowdbb9/AAAC6W1vb3YAAABsbXZoZAAAAAB8JbCAfCWwgAAAA+gAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAhV0cmFrAAAAXHRraGQAAAAPfCWwgHwlsIAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAA',
      );
      silence.playsInline = true;
      silence.volume = 0;
      const joue = silence.play();
      joue?.catch(() => { /* refusé : sans effet sur la suite */ });
    } catch { /* pas d'élément audio disponible */ }
  }

  async reveiller() {
    this._debloquerIOS();
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.gainMusique = this.ctx.createGain();
      this.gainEffets = this.ctx.createGain();
      this.gainMusique.gain.value = 0;
      this.gainEffets.gain.value = this.effetsActifs ? VOLUME_EFFETS : 0;
      this.gainMusique.connect(this.ctx.destination);
      this.gainEffets.connect(this.ctx.destination);
      this._chargement = this._charger();
    }
    // `resume()` doit partir dans la pile du geste, avant toute attente : passé
    // le premier `await`, iOS ne reconnaît plus le clic comme l'autorisant.
    if (this.ctx.state === 'suspended') this.ctx.resume();
    await this._chargement;
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    this.pret = this.ctx.state === 'running';
    // Les écouteurs de réveil ne sont retirés QUE si le son marche vraiment :
    // sur iOS, le premier geste échoue parfois, et il faut pouvoir retenter.
    if (this.pret) {
      for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) {
        window.removeEventListener(ev, this._reveil);
      }
      if (this._musiqueDemandee) this.lancerMusique();
    }
  }

  /** Ce qu'il faut savoir quand un joueur signale qu'il n'entend rien. */
  diagnostic() {
    return {
      contexte: this.ctx ? this.ctx.state : 'absent',
      pret: this.pret,
      tampons: this.tampons.size,
      musique: this.musiqueActive,
      effets: this.effetsActifs,
      debloque: this._debloque === true,
    };
  }

  async _charger() {
    const lire = async (url) => {
      const rep = await fetch(url);
      const brut = await rep.arrayBuffer();
      // Safari d'avant iOS 15 ne rend pas de promesse et exige les deux
      // fonctions de rappel. Sans cette forme, le décodage rendait `undefined`
      // et aucun son n'était jamais chargé — silence complet, sans erreur.
      return new Promise((resolve, reject) => {
        const promesse = this.ctx.decodeAudioData(brut, resolve, reject);
        promesse?.then?.(resolve, reject);
      });
    };
    const [musique, ...sorties] = await Promise.all([lire(MUSIQUE), ...SORTIES.map(lire)]);
    this.tampons.set('musique', musique);
    sorties.forEach((b, i) => this.tampons.set(`sortie${i}`, b));
  }

  // --- Musique -------------------------------------------------------------

  lancerMusique() {
    this._musiqueDemandee = true;
    if (!this.pret || !this.musiqueActive || this.musique) return;
    const tampon = this.tampons.get('musique');
    if (!tampon) return;

    const source = this.ctx.createBufferSource();
    source.buffer = tampon;
    source.loop = true;             // le morceau est bouclé sans couture
    source.connect(this.gainMusique);
    source.start();
    this.musique = source;

    const t = this.ctx.currentTime;
    this.gainMusique.gain.cancelScheduledValues(t);
    this.gainMusique.gain.setValueAtTime(this.gainMusique.gain.value, t);
    this.gainMusique.gain.linearRampToValueAtTime(VOLUME_MUSIQUE, t + FONDU);
  }

  arreterMusique() {
    this._musiqueDemandee = false;
    if (!this.musique) return;
    const source = this.musique;
    this.musique = null;
    const t = this.ctx.currentTime;
    this.gainMusique.gain.cancelScheduledValues(t);
    this.gainMusique.gain.setValueAtTime(this.gainMusique.gain.value, t);
    this.gainMusique.gain.linearRampToValueAtTime(0, t + FONDU * 0.5);
    setTimeout(() => { try { source.stop(); } catch { /* déjà arrêtée */ } }, FONDU * 600);
  }

  // --- Effets --------------------------------------------------------------

  _jouer(cle, gain = 1, retard = 0) {
    if (!this.pret || !this.effetsActifs) return;
    const tampon = this.tampons.get(cle);
    if (!tampon) return;
    const source = this.ctx.createBufferSource();
    source.buffer = tampon;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    source.connect(g).connect(this.gainEffets);
    source.start(this.ctx.currentTime + retard);
  }

  /**
   * Bloc sorti. Le carillon monte d'un degré à chaque sortie enchaînée, puis
   * REDESCEND une fois l'aigu atteint, et remonte : 1 2 3 4 5 6 5 4 3 2 1 2 3…
   *
   * Il s'arrêtait auparavant sur la note la plus haute, et une longue série
   * finissait sur le même carillon répété — exactement ce qu'un son de
   * récompense ne doit pas faire. L'aller-retour n'a pas de fin et reste
   * consonant, quelle que soit la longueur de l'enchaînement.
   */
  sortie() {
    const maintenant = performance.now();
    this.pas = (maintenant - this.derniereSortie > REPRISE_SERIE_MS) ? 0 : this.pas + 1;
    this.derniereSortie = maintenant;
    this.degre = degreDeLaSerie(this.pas);
    this._jouer(`sortie${this.degre}`);
  }

  /** Nouveau niveau : la série repart du grave. */
  reinitialiserSerie() {
    this.pas = 0;
    this.degre = 0;
    this.derniereSortie = 0;
  }

  /** Grille vidée : petit arpège ascendant, construit avec les mêmes carillons. */
  victoire() {
    [2, 3, 5].forEach((d, i) => this._jouer(`sortie${d}`, 0.9 - 0.1 * i, i * 0.13));
  }

  // --- Réglages ------------------------------------------------------------

  definirMusique(actif) {
    this.musiqueActive = actif;
    if (!this.ctx) return;
    if (actif) {
      this.ctx.resume();
      if (this._musiqueDemandee) this.lancerMusique();
      return;
    }
    const t = this.ctx.currentTime;
    this.gainMusique.gain.cancelScheduledValues(t);
    this.gainMusique.gain.setValueAtTime(this.gainMusique.gain.value, t);
    this.gainMusique.gain.linearRampToValueAtTime(0, t + 0.3);
    if (this.musique) {
      const source = this.musique;
      this.musique = null;
      setTimeout(() => { try { source.stop(); } catch { /* déjà arrêtée */ } }, 400);
    }
  }

  definirEffets(actif) {
    this.effetsActifs = actif;
    if (this.ctx) this.gainEffets.gain.value = actif ? VOLUME_EFFETS : 0;
  }

  /** Coupe tout d'un geste, sans perdre le détail des deux réglages. */
  toutCouper() {
    this.definirMusique(false);
    this.definirEffets(false);
  }
}
