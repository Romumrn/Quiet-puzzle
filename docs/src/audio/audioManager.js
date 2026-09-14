/**
 * AudioManager — equivalent of Scripts/Audio/AudioManager.cs, MusicPlayer.cs
 * and SoundEffects.cs (tech doc §4).
 *
 * Web Audio rather than <audio> tags: those have a latency of several tens of
 * milliseconds and overlap badly, which is a deal-breaker for a sound triggered
 * by a gesture that can fire several times a second.
 *
 * Two browser constraints are handled here:
 *  - sound is forbidden until the user has touched the page; the context is
 *    therefore created asleep and woken on the first gesture;
 *  - a backgrounded page must go quiet, otherwise the music keeps playing
 *    behind the player's back.
 */

import { MUSIC, EXIT_SOUNDS } from './manifest.js';

const MUSIC_VOLUME = 0.34;
const SFX_VOLUME = 0.62;
const FADE = 1.6;          // seconds, music fade in and out

/**
 * Chime degree at the n-th step of a run, back and forth.
 *
 * The pattern is 2×(N−1) steps long: it climbs from low to high, then comes
 * back down without replaying either the top or the bottom twice in a row — a
 * plain modulo would have doubled them, and the turning point is audible
 * straight away.
 */
export function runDegree(step, notes = EXIT_SOUNDS.length) {
  if (notes < 2) return 0;
  const period = 2 * (notes - 1);
  const p = ((step % period) + period) % period;
  return p < notes ? p : period - p;
}

/** Past this delay, the run of exits starts again from the low note. */
const RUN_RESET_MS = 2600;

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    // Music and sound effects are muted separately: many players want to keep
    // the audible feedback of their actions while playing without music.
    this.musicOn = true;
    this.sfxOn = true;
    this.buffers = new Map();
    this.music = null;
    this.step = 0;
    this.degree = 0;
    this.lastExit = 0;

    /**
     * The user's first gesture unlocks sound.
     *
     * `touchend` and `click` are in the list alongside `pointerdown`: Safari on
     * iOS does not always treat a `pointerdown` as the gesture that authorises
     * playback, while it accepts the other two. The listeners stay in place as
     * long as the context has not actually started, so the next gesture can try
     * again.
     */
    this._wake = () => this.wake();
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) {
      window.addEventListener(ev, this._wake, { once: false, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  // --- Lifecycle -----------------------------------------------------------

  /**
   * Unlocks iOS audio output.
   *
   * On iPhone, a sound played only through Web Audio is classified "ambient":
   * the little side switch mutes it, and the player hears nothing without
   * understanding why. Playing an `<audio>` element once — here a few bytes of
   * silence — during a real gesture flips the session into the playback
   * category, and the rest follows.
   *
   * Failure is harmless: on browsers that do not need it, this playback is
   * inaudible, and if it is refused the game carries on.
   */
  _unlockIOS() {
    if (this._unlocked) return;
    this._unlocked = true;
    try {
      const silence = new Audio(
        'data:audio/mp4;base64,AAAAHGZ0eXBNNEEgAAAAAE00QSBpc29tbXA0MgAAAAhmcmVlAAAAG21kYXQAAAGzABAHAAABthADAowdbb9/AAAC6W1vb3YAAABsbXZoZAAAAAB8JbCAfCWwgAAAA+gAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAhV0cmFrAAAAXHRraGQAAAAPfCWwgHwlsIAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAA',
      );
      silence.playsInline = true;
      silence.volume = 0;
      const played = silence.play();
      played?.catch(() => { /* refused: no consequence for what follows */ });
    } catch { /* no audio element available */ }
  }

  async wake() {
    this._unlockIOS();
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.sfxGain.gain.value = this.sfxOn ? SFX_VOLUME : 0;
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);
      this._loading = this._load();
    }
    // `resume()` must fire within the gesture's own stack, before any wait:
    // past the first `await`, iOS no longer recognises the click as
    // authorising it.
    if (this.ctx.state === 'suspended') this.ctx.resume();
    await this._loading;
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    this.ready = this.ctx.state === 'running';
    // The wake listeners are removed ONLY if sound really works: on iOS the
    // first gesture sometimes fails, and we must be able to try again.
    if (this.ready) {
      for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) {
        window.removeEventListener(ev, this._wake);
      }
      if (this._musicRequested) this.startMusic();
    }
  }

  /** What we need to know when a player reports hearing nothing. */
  diagnostics() {
    return {
      context: this.ctx ? this.ctx.state : 'absent',
      ready: this.ready,
      buffers: this.buffers.size,
      music: this.musicOn,
      sfx: this.sfxOn,
      unlocked: this._unlocked === true,
    };
  }

  async _load() {
    const read = async (url) => {
      const res = await fetch(url);
      const raw = await res.arrayBuffer();
      // Safari before iOS 15 returns no promise and requires both callbacks.
      // Without this form, decoding returned `undefined` and no sound was ever
      // loaded — total silence, with no error.
      return new Promise((resolve, reject) => {
        const promise = this.ctx.decodeAudioData(raw, resolve, reject);
        promise?.then?.(resolve, reject);
      });
    };
    const [music, ...exits] = await Promise.all([read(MUSIC), ...EXIT_SOUNDS.map(read)]);
    this.buffers.set('music', music);
    exits.forEach((b, i) => this.buffers.set(`exit${i}`, b));
  }

  // --- Music ---------------------------------------------------------------

  startMusic() {
    this._musicRequested = true;
    if (!this.ready || !this.musicOn || this.music) return;
    const buffer = this.buffers.get('music');
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;             // the track loops seamlessly
    source.connect(this.musicGain);
    source.start();
    this.music = source;

    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
    this.musicGain.gain.linearRampToValueAtTime(MUSIC_VOLUME, t + FADE);
  }

  stopMusic() {
    this._musicRequested = false;
    if (!this.music) return;
    const source = this.music;
    this.music = null;
    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
    this.musicGain.gain.linearRampToValueAtTime(0, t + FADE * 0.5);
    setTimeout(() => { try { source.stop(); } catch { /* already stopped */ } }, FADE * 600);
  }

  // --- Sound effects -------------------------------------------------------

  _play(key, gain = 1, delay = 0) {
    if (!this.ready || !this.sfxOn) return;
    const buffer = this.buffers.get(key);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    source.connect(g).connect(this.sfxGain);
    source.start(this.ctx.currentTime + delay);
  }

  /**
   * Block cleared. The chime rises one degree with each chained exit, then
   * COMES BACK DOWN once the top is reached, and climbs again:
   * 1 2 3 4 5 6 5 4 3 2 1 2 3…
   *
   * It used to stop on the highest note, and a long run ended on the same chime
   * repeated — exactly what a reward sound must not do. The back-and-forth has
   * no end and stays consonant, however long the chain.
   */
  exit() {
    const now = performance.now();
    this.step = (now - this.lastExit > RUN_RESET_MS) ? 0 : this.step + 1;
    this.lastExit = now;
    this.degree = runDegree(this.step);
    this._play(`exit${this.degree}`);
  }

  /** New level: the run starts again from the low note. */
  resetRun() {
    this.step = 0;
    this.degree = 0;
    this.lastExit = 0;
  }

  /** Grid cleared: a small rising arpeggio, built from the same chimes. */
  victory() {
    [2, 3, 5].forEach((d, i) => this._play(`exit${d}`, 0.9 - 0.1 * i, i * 0.13));
  }

  // --- Settings ------------------------------------------------------------

  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) {
      this.ctx.resume();
      if (this._musicRequested) this.startMusic();
      return;
    }
    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
    this.musicGain.gain.linearRampToValueAtTime(0, t + 0.3);
    if (this.music) {
      const source = this.music;
      this.music = null;
      setTimeout(() => { try { source.stop(); } catch { /* already stopped */ } }, 400);
    }
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.ctx) this.sfxGain.gain.value = on ? SFX_VOLUME : 0;
  }

  /** Mutes everything in one go, without losing either setting's detail. */
  muteAll() {
    this.setMusic(false);
    this.setSfx(false);
  }
}
