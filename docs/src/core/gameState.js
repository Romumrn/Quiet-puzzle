/**
 * GameState — equivalent of Scripts/Gameplay/GameState.cs (tech doc §4)
 *
 * Minimal state machine for the level in progress. The board logic
 * (core/board.js) only ever knows these three values, exactly like the C# enum
 * `GameState { PLAYING, WON, FAILED }` from the document.
 */

export const GameState = Object.freeze({
  PLAYING: 'PLAYING',
  WON: 'WON',
  FAILED: 'FAILED',
});

/** Allowed transitions: a finished level never goes back to PLAYING. */
const ALLOWED = {
  PLAYING: ['WON', 'FAILED'],
  WON: [],
  FAILED: [],
};

export function canTransition(from, to) {
  return (ALLOWED[from] || []).includes(to);
}
