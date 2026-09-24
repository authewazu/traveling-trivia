import { DIFFICULTIES, MAX_SAME_DIFFICULTY_STREAK } from './config.js';

// Even odds across all difficulties, except that a difficulty which has just
// appeared MAX_SAME_DIFFICULTY_STREAK times in a row is excluded for one pick.
export function pickDifficulty(history, rand = Math.random) {
  const recent = history.slice(-MAX_SAME_DIFFICULTY_STREAK);
  const blocked =
    recent.length === MAX_SAME_DIFFICULTY_STREAK && recent.every((d) => d === recent[0])
      ? recent[0]
      : null;
  const options = DIFFICULTIES.filter((d) => d !== blocked);
  return options[Math.floor(rand() * options.length)];
}
