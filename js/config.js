// Every tunable number lives here so the prototype can be adjusted in one place.
// `?speed=N` in the URL divides all durations by N for faster testing.

const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get('speed')) || 1);
const s = (seconds) => (seconds * 1000) / SPEED;

export const DEBUG = params.has('debug');

export const TIMING = {
  loadingMs: s(4), // loading screen after "Tap to play" / "Play again"
  answerMs: s(10),
  revealMs: s(7),
  explainDeadlineMs: s(5),
  idleNoticeMs: s(5), // "Idle session detected" screen before the title screen
  endScreenIdleMs: s(40), // untouched end screen → title screen
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

// Idle = this many rounds in a row that timed out with no answer. With nobody
// answering, that's question + reveal + question + reveal + question
// (10+7+10+7+10 = 44s), then the "Idle session detected" screen.
export const IDLE_UNANSWERED_ROUNDS = 3;

// Hover-to-select (hand pose). Positions come from the camera (js/hand.js) or,
// with ?input=mouse, the mouse, through window.TravelingTrivia.pointer.
// Targets: the answer bubbles, "That's not my bus", and "Play again".
//   (default)     camera hand tracking + tapping
//   ?input=mouse  the mouse stands in for the hand (no camera)
//   ?input=touch  tapping only (no camera, no cursor)
const DWELL_SECONDS = 2;
export const POINTER = {
  input: params.get('input') || 'hand',
  dwellSeconds: DWELL_SECONDS, // what the countdown beside the cursor shows (2 → 1)
  dwellMs: s(DWELL_SECONDS), // hover this long on a target to select it
  // 'answers': the four answer bubbles are the targets (2×2 = quadrants of the
  // answer area). 'screen': the whole screen split into four quadrants.
  zones: params.get('zones') === 'screen' ? 'screen' : 'answers',
  smoothing: 0.35, // mouse input only: 0–1, lower = steadier but laggier (the camera uses HAND.filter)
  exitGraceMs: 250, // brief slips outside a target don't restart the countdown
};

// Camera hand tracking (js/hand.js): ml5 handPose on the iPad's front camera.
export const HAND = {
  ml5Url: 'https://unpkg.com/ml5@1.4.0/dist/ml5.min.js', // pinned: ml5 v1 API
  // Front ("user") camera at a modest size: plenty for one hand, fast to process.
  camera: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
  model: {
    maxHands: 1, // one cursor; the model follows the most prominent hand
    modelType: 'full', // 'full' is steadier than 'lite'; the M2 iPad can afford it
    flipped: true, // mirror once, here (selfie view) — js/pointer.js won't flip again
  },
  // handPose only finds hands (palm detector + hand landmarks), never faces or
  // bodies; this also drops its occasional low-confidence false positives.
  minConfidence: 0.75,
  // Keep the cursor through brief detection dropouts instead of hiding it
  // (which would cancel a hover countdown).
  lostAfterMs: 400,
  // Which part of the camera frame (0–1, already mirrored) maps onto the whole
  // screen. Estimated for an iPad ~2 ft+ up, tilted ~10° upward, rider about
  // 2 ft away pointing at the screen: hands land in the middle band of the
  // frame (faces sit near the top). Tune on the real kiosk with ?debug, which
  // shows the fingertip's raw position and the range it has covered.
  region: { x0: 0.2, x1: 0.8, y0: 0.25, y1: 0.75 },
  // One Euro filter (Casiez et al. 2012) on the cursor: strong smoothing when
  // the hand is nearly still, little when it moves fast. Units: screen widths/s.
  //   minCutoff ↓ = steadier at rest (more lag); beta ↑ = less lag when moving.
  filter: { minCutoff: 1.0, beta: 4.0, dCutoff: 1.0 },
  jumpReset: 0.35, // a jump this far (screen fraction) in one frame snaps instead of gliding
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const MAX_SAME_DIFFICULTY_STREAK = 3;

// Scoring: every correct answer is worth 1 point × the streak multiplier.
// 1st correct in a row ×1.0, 2nd ×1.5, 3rd ×2.0, … ; a miss resets to ×1.0.
export const POINTS_PER_CORRECT = 1;
export const STREAK_STEP = 0.5;

// Question categories: the label on the category chip and the color family
// (css/styles.css, [data-cat]) for the chip and the question card. Keyed by
// OpenTDB category id; anything unlisted uses 'general'.
export const CATEGORIES = {
  9: { key: 'general', label: 'General Knowledge' },
  17: { key: 'science', label: 'Science & Nature' },
  18: { key: 'computers', label: 'Computers' },
  19: { key: 'math', label: 'Mathematics' },
  22: { key: 'geography', label: 'Geography' },
  23: { key: 'history', label: 'History' },
  27: { key: 'animals', label: 'Animals' },
};

// The question database: hand-vetted Easy OpenTDB questions. Must stay in sync
// with QUESTIONS_FILE in api/explain.js (and includeFiles in vercel.json).
export const QUESTIONS_URL = 'data/easy_trivia_pool_vetted.json';

export const BUS = {
  endpoint: '/api/bus',
  stopName: 'Chestnut St & 20th St',
  routes: ['21', '42'],
};

export const EXPLAIN_ENDPOINT = '/api/explain';

export const LEADERBOARD = {
  storageKey: 'tbs.daily.v1',
  days: 5,
  // Earlier days with no real points show a stable mock total in this range
  // (never stored; real totals always win). Set to false for real-only.
  mockPastDays: true,
  mockRange: [15, 70],
};
