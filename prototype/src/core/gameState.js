/**
 * GameState — équivalent de Scripts/Gameplay/GameState.cs (doc §4)
 *
 * Machine à états minimale du niveau en cours. La logique de plateau
 * (core/board.js) ne connaît que ces trois valeurs, exactement comme
 * l'enum C# `GameState { PLAYING, WON, FAILED }` du document.
 */

export const GameState = Object.freeze({
  PLAYING: 'PLAYING',
  WON: 'WON',
  FAILED: 'FAILED',
});

/** Transitions autorisées : un niveau terminé ne repart jamais en PLAYING. */
const ALLOWED = {
  PLAYING: ['WON', 'FAILED'],
  WON: [],
  FAILED: [],
};

export function canTransition(from, to) {
  return (ALLOWED[from] || []).includes(to);
}
