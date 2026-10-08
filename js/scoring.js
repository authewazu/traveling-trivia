import { POINTS_PER_CORRECT, STREAK_STEP } from './config.js';

// streak = number of consecutive correct answers *before* this round.
// 0 → ×1.0, 1 → ×1.5, 2 → ×2.0, … (uncapped).
export function multiplierFor(streak) {
  return 1 + STREAK_STEP * streak;
}

export function scoreRound({ correct, streak }) {
  if (!correct) return { points: 0, multiplier: 1, nextStreak: 0 };
  const multiplier = multiplierFor(streak);
  return { points: POINTS_PER_CORRECT * multiplier, multiplier, nextStreak: streak + 1 };
}

export const fmt = (n) => n.toFixed(1);
