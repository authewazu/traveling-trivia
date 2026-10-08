import { DIFFICULTIES, MAX_SAME_DIFFICULTY_STREAK } from './config.js';

// Even odds across the difficulties the question bank actually has, except
// that one which has just appeared MAX_SAME_DIFFICULTY_STREAK times in a row
// is excluded for one pick. (With a single available difficulty — e.g. the
// Easy-only vetted pool — the guardrail can't apply, so that one is used.)
export function pickDifficulty(history, available = DIFFICULTIES, rand = Math.random) {
  const recent = history.slice(-MAX_SAME_DIFFICULTY_STREAK);
  const blocked =
    recent.length === MAX_SAME_DIFFICULTY_STREAK && recent.every((d) => d === recent[0])
      ? recent[0]
      : null;
  const unblocked = available.filter((d) => d !== blocked);
  const options = unblocked.length ? unblocked : available;
  return options[Math.floor(rand() * options.length)];
}
