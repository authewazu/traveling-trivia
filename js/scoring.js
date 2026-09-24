import { BASE_POINTS, STREAK_STEP } from './config.js';

// streak = number of consecutive correct answers *before* this round.
export function multiplierFor(streak) {
  return 1 + STREAK_STEP * streak;
}

export function scoreRound({ difficulty, correct, streak }) {
  if (!correct) return { points: 0, multiplier: 1, nextStreak: 0 };
  const multiplier = multiplierFor(streak);
  return { points: BASE_POINTS[difficulty] * multiplier, multiplier, nextStreak: streak + 1 };
}

export const fmt = (n) => n.toFixed(1);
