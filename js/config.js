// Every tunable number lives here so the prototype can be adjusted in one place.
// `?speed=N` in the URL divides all durations by N for faster testing.

const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get('speed')) || 1);
const s = (seconds) => (seconds * 1000) / SPEED;

export const DEBUG = params.has('debug');

export const TIMING = {
  loadingMs: s(4), // loading screen after "Tap to play" / "Play again"
  answerMs: s(15),
  revealMs: s(7),
  explainDeadlineMs: s(5),
  idleResetMs: s(40),
  sessionCapMs: s(6 * 60),
  busWarningMs: s(30), // bus banner + game pause, this long before arrival
  resumeCountdownSec: 3,
  resumeStepMs: s(1),
  busEndScreenMs: s(15),
  busPollIdleMs: 30_000,
  busPollSessionMs: 20_000,
  // An updated ETA must be at least this much earlier before we shorten the
  // session, so jittery predictions don't cause a pop-up every poll.
  etaShortenThresholdMs: 5_000,
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const BASE_POINTS = { easy: 1, medium: 2, hard: 3 };
export const MAX_SAME_DIFFICULTY_STREAK = 3;
export const STREAK_STEP = 0.5;

// Curated OpenTDB snapshot, built by dev/fetch_questions.py.
export const QUESTIONS_URL = 'data/questions.json';

export const BUS = {
  endpoint: '/api/bus',
  stopName: 'Chestnut St & 20th St',
  routes: ['21', '42'],
};

export const EXPLAIN_ENDPOINT = '/api/explain';

export const LEADERBOARD = {
  storageKey: 'tbs.daily.v1',
  seededKey: 'tbs.seeded.v1',
  days: 5,
  // Placeholder totals for the 4 days before first launch (testing only).
  seed: [48.5, 31, 62, 17.5],
};
