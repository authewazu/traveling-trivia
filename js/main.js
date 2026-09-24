import { TIMING, BUS, BASE_POINTS, DEBUG, IDLE_UNANSWERED_ROUNDS } from './config.js';
import { pickDifficulty } from './difficulty.js';
import { scoreRound, multiplierFor, fmt } from './scoring.js';
import { loadQuestionBank } from './questions.js';
import { requestExplanation } from './explain.js';
import { BusFeed } from './bus.js';
import * as board from './leaderboard.js';
import * as sound from './sound.js';

const $ = (id) => document.getElementById(id);
const now = () => Date.now();

const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const LETTERS = 'ABCD';
const BUS_SVG = document.querySelector('.stop-glyph svg').outerHTML;
const CLOCK_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.4 3.5 2.1-1 1.7-4.5-2.7V6h2v6.4Z"/></svg>';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const questionBank = loadQuestionBank(); // data/questions.json, loaded once
const bus = new BusFeed(onBusUpdate);

// Rounds dealt ahead of the one on screen, so each upcoming question's AI
// explanation is already generating (or cached) before the rider sees it.
const LOOKAHEAD = 3;

let session = null;
let phase = 'idle'; // 'idle' | 'loading' | 'question' | 'reveal' | 'ended' | 'timeout'
let screenTimer = null; // drives the timed loading and idle-notice screens
let phaseEndsAt = 0;
let pausedRemaining = null; // ms left in the phase while the bus alert is up
let overlay = null; // null | 'bus' | 'countdown'
let countdownTimers = [];
let lastInteraction = now();
let lastTickSecond = null;
let endScreenUntil = 0;
let toastTimer = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mmss(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function h(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

function routeBadge(route) {
  const b = h('span', { className: 'route-badge', textContent: route });
  b.dataset.route = route;
  return b;
}

function announce(text) {
  $('live').textContent = '';
  requestAnimationFrame(() => ($('live').textContent = text));
}

function showScreen(name) {
  for (const s of ['idle', 'loading', 'game', 'end', 'timeout']) $(`screen-${s}`).hidden = s !== name;
  $('app').dataset.screen = name;
}

function toast(text) {
  $('toast-text').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 5000);
}

// ---------------------------------------------------------------------------
// Idle screen
// ---------------------------------------------------------------------------
function renderDepartures() {
  const ul = $('idle-buses');
  ul.replaceChildren();
  if (bus.status !== 'live') {
    ul.append(h('li', {
      className: 'departures-note',
      textContent: bus.status === 'loading'
        ? 'Checking live bus times…'
        : 'Live bus times unavailable. Games run up to 6 minutes (estimate).',
    }));
    return;
  }
  const next = bus.nextByRoute();
  for (const route of BUS.routes) {
    const a = next[route];
    const eta = h('span', { className: 'departure-eta' });
    if (!a) eta.append('—', h('small', { textContent: 'not tracked yet' }));
    else {
      const mins = Math.floor((a.at - now()) / 60000);
      if (mins < 1) eta.append('Due');
      else eta.append(String(mins), h('small', { textContent: 'min' }));
    }
    const li = h('li', { className: 'departure' }, routeBadge(route), eta);
    li.setAttribute('aria-label', a ? `Route ${route}: ${eta.textContent}` : `Route ${route}: no prediction`);
    ul.append(li);
  }
}

function renderBoard(ol) {
  ol.replaceChildren(
    ...board.recentDays().map((d, i) =>
      h('li', { className: `board-row${d.isToday ? ' is-today' : ''}` },
        h('span', { className: 'rank', textContent: `#${i + 1}` }),
        h('span', { className: 'day', textContent: d.label }),
        h('span', { className: 'total', textContent: fmt(d.total) }))
    )
  );
}

function goIdle() {
  clearTimeout(screenTimer);
  session = null;
  phase = 'idle';
  hideOverlays();
  showScreen('idle');
  renderDepartures();
  renderBoard($('board-idle'));
}

// Shown after three unanswered rounds. Answered rounds already counted toward
// today's total the moment they were answered, so nothing is lost. A tap
// skips straight to the title screen.
function showIdleNotice() {
  session = null;
  phase = 'timeout';
  showScreen('timeout');
  announce($('timeout-message').textContent);
  sound.play('notice');
  clearTimeout(screenTimer);
  screenTimer = setTimeout(goIdle, TIMING.idleNoticeMs);
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

// Deal questions onto the queue until it holds `count`, starting each one's
// AI explanation immediately. Difficulties are picked in play order, so the
// max-3-in-a-row guardrail still holds.
function dealInto(target, count) {
  while (target.queue.length < count) {
    const difficulty = pickDifficulty(target.history);
    target.history.push(difficulty);
    const q = questionBank.take(difficulty);
    target.queue.push({ difficulty, q, explanation: requestExplanation(q) });
  }
}

// "Tap to play" / "Play again": show the loading screen for a few seconds
// while the first rounds are dealt and their explanations start generating.
function beginLoading() {
  sound.unlock();
  clearTimeout(screenTimer);
  hideOverlays();
  session = null;
  phase = 'loading';
  showScreen('loading');
  const fill = $('loading-fill');
  fill.style.animation = 'none';
  void fill.getBoundingClientRect();
  fill.style.animation = `bar-fill ${TIMING.loadingMs}ms linear forwards`;
  announce($('loading-message').textContent);

  bus.refresh(); // fresh ETA in hand when the session's deadline is set

  const prep = { history: [], queue: [] };
  questionBank.ready.then(() => {
    if (phase === 'loading') dealInto(prep, LOOKAHEAD);
  });
  screenTimer = setTimeout(() => startSession(prep), TIMING.loadingMs);
}

function startSession(prep) {
  const t = now(); // the 6-minute cap starts when play starts, not at the tap

  session = {
    capAt: t + TIMING.sessionCapMs,
    deadline: t + TIMING.sessionCapMs,
    source: 'estimate', // 'bus' | 'cap' | 'estimate'
    tracked: null, // the arrival the deadline is pinned to
    dismissed: new Set(),
    alertTrips: [],
    history: prep.history, // difficulties in play order, including queued rounds
    queue: prep.queue, // upcoming rounds: { difficulty, q, explanation }
    score: 0,
    streak: 0,
    bestStreak: 0,
    completed: 0,
    correct: 0,
    started: 0,
    round: null,
  };
  retargetDeadline();
  bus.setPollInterval(TIMING.busPollSessionMs);
  bus.refresh();
  lastInteraction = t;
  renderBusClock(); // paint real values before the screen shows (no placeholder flash)
  showScreen('game');
  startRound();
}

// Pin the deadline to the soonest non-dismissed bus, capped at 6 minutes.
// Used at session start and after "that's not my bus" (the only times the
// deadline may move later).
function retargetDeadline() {
  const s = session;
  const next = bus.status === 'live' ? bus.upcoming(now(), s.dismissed)[0] : null;
  if (next && next.at < s.capAt) {
    Object.assign(s, { deadline: next.at, source: 'bus', tracked: next });
  } else {
    Object.assign(s, { deadline: s.capAt, source: bus.status === 'live' ? 'cap' : 'estimate', tracked: null });
  }
}

function onBusUpdate() {
  if (phase === 'idle') renderDepartures();
  if (!session || phase === 'ended') return;
  const s = session;
  if (s.source === 'estimate' && bus.status === 'live') s.source = 'cap';
  const next = bus.upcoming(now(), s.dismissed)[0];
  // Later ETA → ignore. Earlier ETA → shorten and tell the rider.
  if (next && next.at < s.deadline - TIMING.etaShortenThresholdMs) {
    const wasBus = s.source === 'bus';
    Object.assign(s, { deadline: next.at, source: 'bus', tracked: next });
    if (overlay !== 'bus') {
      const msg = wasBus
        ? `Route ${next.route} is now arriving sooner, in ${mmss(next.at - now())}.`
        : `Route ${next.route} is on the way. Arriving in ${mmss(next.at - now())}.`;
      toast(msg);
      announce(msg);
      sound.play('notice');
    }
  }
}

function endSession(reason) {
  if (!session || phase === 'ended') return;
  const s = session;
  // A round cut off mid-question never awarded points, so it simply vanishes.
  // Rounds that reached the reveal were already added to the daily total.
  hideOverlays();
  phase = 'ended';
  bus.setPollInterval(TIMING.busPollIdleMs);
  // Queued rounds were never shown: put them back in the deck for later riders.
  for (const item of s.queue) questionBank.putBack(item.q);
  s.queue = [];
  if (reason === 'idle') return showIdleNotice();

  const isBus = reason === 'bus';
  $('end-icon').innerHTML = isBus ? BUS_SVG : CLOCK_SVG;
  $('end-title').textContent = isBus ? 'Your bus is here!' : "Time's up!";
  $('end-sub').textContent = isBus
    ? `${s.tracked ? `Route ${s.tracked.route} is arriving.` : 'Your bus is arriving.'} Thanks for playing!`
    : 'Six minutes and no bus yet. Want another round?';
  $('end-score').textContent = fmt(s.score);
  $('end-correct').textContent = `${s.correct} / ${s.completed}`;
  $('end-streak').textContent = String(s.bestStreak);
  $('play-again').hidden = isBus;
  renderBoard($('board-end'));
  endScreenUntil = isBus ? now() + TIMING.busEndScreenMs : 0;
  lastInteraction = now();
  showScreen('end');
  announce(`${$('end-title').textContent} You scored ${fmt(s.score)} points.`);
  sound.play(isBus ? 'bus' : 'notice');
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------
function startRound() {
  const s = session;
  dealInto(s, 1);
  const { q, difficulty, explanation } = s.queue.shift();
  dealInto(s, LOOKAHEAD); // keep the next rounds' explanations generating
  const round = { q, difficulty, number: ++s.started, result: null, explanation: null };
  s.round = round;
  // One explanation per question, independent of the rider's pick: the same
  // text shows whether they answer right or wrong.
  explanation.then((res) => {
    round.explanation = res;
    if (session?.round === round && phase === 'reveal') renderExplanation();
  });
  phase = 'question';
  phaseEndsAt = now() + TIMING.answerMs;
  lastTickSecond = null;
  renderRound();
  startPhaseDrain(TIMING.answerMs);
}

function answer(i) {
  if (phase !== 'question' || overlay) return;
  const s = session;
  const r = s.round;
  const picked = i === null ? null : r.q.answers[i];
  const correct = picked === r.q.correct;
  const { points, multiplier, nextStreak } = scoreRound({ difficulty: r.difficulty, correct, streak: s.streak });
  s.streak = nextStreak;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  s.score += points;
  s.completed += 1;
  if (correct) s.correct += 1;
  board.addPoints(points); // counts toward today immediately
  r.result = { pickedIndex: i, correct, points, multiplier, timedOut: i === null };

  // Idle detection: consecutive rounds that ran out with no answer.
  s.unanswered = i === null ? (s.unanswered ?? 0) + 1 : 0;
  if (s.unanswered >= IDLE_UNANSWERED_ROUNDS) return endSession('idle');

  phase = 'reveal';
  phaseEndsAt = now() + TIMING.revealMs;
  sound.play(correct ? 'correct' : 'wrong'); // no answer = incorrect
  renderReveal();
  startPhaseDrain(TIMING.revealMs);
}

// ---------------------------------------------------------------------------
// Game rendering
// ---------------------------------------------------------------------------
const answerButtons = [...document.querySelectorAll('.answer')];

function renderRound() {
  const s = session;
  const { q, difficulty, number } = s.round;
  $('diff-chip').dataset.diff = difficulty;
  $('question-card').dataset.diff = difficulty;
  $('diff-label').textContent = DIFF_LABEL[difficulty];
  $('round-num').textContent = `Round ${number}`;
  $('worth').textContent = `Worth ${fmt(BASE_POINTS[difficulty] * multiplierFor(s.streak))} pts`;
  $('category').textContent = q.category;
  const qEl = $('question');
  qEl.textContent = q.text;
  // Step the type down for long text so the longest questions in the bank
  // (~140 chars) and answers (~85 chars) still fit on the iPad screen.
  qEl.classList.toggle('long', q.text.length > 80 && q.text.length <= 120);
  qEl.classList.toggle('xlong', q.text.length > 120);

  answerButtons.forEach((btn, i) => {
    const text = q.answers[i];
    btn.className = 'answer';
    btn.classList.toggle('small-text', text.length > 36 && text.length <= 60);
    btn.classList.toggle('xsmall-text', text.length > 60);
    btn.disabled = false;
    btn.querySelector('.letter').textContent = LETTERS[i];
    btn.querySelector('.answer-text').textContent = text;
    btn.querySelector('.answer-status').textContent = '';
    btn.setAttribute('aria-label', `${LETTERS[i]}: ${text}`);
  });

  $('screen-game').classList.remove('revealing');
  $('reveal').hidden = true;
  $('timer').classList.remove('hurry', 'done');
  renderScore();
  renderTimer();
  announce(`${DIFF_LABEL[difficulty]} question. ${q.text}`);
}

function renderReveal() {
  const s = session;
  const { q, result } = s.round;
  const correctIndex = q.answers.indexOf(q.correct);

  answerButtons.forEach((btn, i) => {
    btn.disabled = true;
    const status = btn.querySelector('.answer-status');
    const letter = btn.querySelector('.letter');
    if (i === correctIndex) {
      btn.classList.add('is-correct');
      letter.textContent = '✓';
      status.textContent = i === result.pickedIndex ? 'Your answer · Correct' : 'Correct answer';
    } else if (i === result.pickedIndex) {
      btn.classList.add('is-wrong');
      letter.textContent = '✗';
      status.textContent = 'Your answer';
    } else {
      btn.classList.add('is-dim');
    }
    if (i === result.pickedIndex) btn.classList.add('is-picked');
  });

  const v = $('verdict');
  // A timeout is scored and shown exactly like a wrong answer.
  v.dataset.result = result.correct ? 'correct' : 'wrong';
  $('verdict-icon').textContent = result.correct ? '✓' : '✗';
  $('verdict-text').textContent = result.correct
    ? (result.multiplier > 1 ? `Correct! ×${result.multiplier.toFixed(1)} streak` : 'Correct!')
    : result.timedOut ? "Time's up · Incorrect" : 'Incorrect';
  $('verdict-points').textContent = `+${fmt(result.points)}`;
  $('timer-fill').style.animationPlayState = 'paused'; // ring freezes where the rider answered
  $('timer').classList.add('done');
  $('timer').classList.remove('hurry');

  renderExplanation();
  renderScore(result.correct);
  $('screen-game').classList.add('revealing');
  $('reveal').hidden = false;
  announce(`${$('verdict-text').textContent}. The answer is ${q.correct}. Plus ${fmt(result.points)} points.`);
}

function renderExplanation() {
  const r = session.round;
  const p = $('explain-text');
  if (r.explanation) {
    p.textContent = r.explanation.text;
    p.dataset.loading = 'false';
    p.dataset.source = r.explanation.source;
  } else {
    p.textContent = 'Looking that up…';
    p.dataset.loading = 'true';
  }
}

function renderScore(bump = false) {
  const s = session;
  $('score').textContent = fmt(s.score);
  const streak = $('streak');
  streak.textContent = `Streak ×${multiplierFor(s.streak).toFixed(1)}`;
  if (bump) {
    streak.classList.remove('bump');
    void streak.offsetWidth;
    streak.classList.add('bump');
  }
}

function phaseLeft() {
  return pausedRemaining ?? Math.max(0, phaseEndsAt - now());
}

function renderTimer() {
  const left = phaseLeft();
  const secs = Math.ceil(left / 1000);
  $('timer-num').textContent = String(secs);
  const hurry = secs <= 5 && secs > 0;
  $('timer').classList.toggle('hurry', hurry);
  if (hurry && secs !== lastTickSecond && pausedRemaining === null) sound.play('tick');
  lastTickSecond = secs;
}

function renderNext() {
  $('next-num').textContent = String(Math.ceil(phaseLeft() / 1000));
}

// (Re)start a countdown drain so it ends exactly when the phase does. A
// negative delay starts the animation part-way through, e.g. after a pause.
function startDrain(el, keyframes, totalMs, remainingMs) {
  el.style.animation = 'none';
  void el.getBoundingClientRect(); // flush so the new animation restarts
  el.style.animation = `${keyframes} ${totalMs}ms linear ${remainingMs - totalMs}ms forwards`;
}

function startPhaseDrain(remainingMs) {
  if (phase === 'question') startDrain($('timer-fill'), 'ring-drain', TIMING.answerMs, remainingMs);
  else if (phase === 'reveal') startDrain($('next-fill'), 'bar-drain', TIMING.revealMs, remainingMs);
}

function renderBusClock() {
  const s = session;
  const left = s.deadline - now();
  const c = $('bus-clock');
  c.dataset.source = s.source;
  if (s.source === 'bus') {
    $('bus-clock-label').textContent = `Route ${s.tracked.route} arrives in`;
    $('bus-clock-time').textContent = mmss(left);
    $('bus-clock-tag').textContent = 'Live';
  } else if (s.source === 'cap') {
    $('bus-clock-label').textContent = 'Session ends in';
    $('bus-clock-time').textContent = mmss(left);
    $('bus-clock-tag').textContent = 'Live';
  } else {
    $('bus-clock-label').textContent = 'No live bus data';
    $('bus-clock-time').textContent = `~${mmss(left)}`;
    $('bus-clock-tag').textContent = 'Estimate';
  }
}

// ---------------------------------------------------------------------------
// Bus alert + resume countdown
// ---------------------------------------------------------------------------
function pauseGame() {
  if (pausedRemaining === null) pausedRemaining = Math.max(0, phaseEndsAt - now());
  // Freeze the drains (set inline: the drain's inline `animation` would win over a stylesheet rule).
  $('timer-fill').style.animationPlayState = 'paused';
  $('next-fill').style.animationPlayState = 'paused';
}
function resumeGame() {
  if (pausedRemaining === null) return;
  // Don't hand the rider back a question with 1 second left on it.
  const min = phase === 'question' ? TIMING.answerMs / 3 : 0;
  const remaining = Math.max(pausedRemaining, min);
  phaseEndsAt = now() + remaining;
  pausedRemaining = null;
  lastInteraction = now();
  startPhaseDrain(remaining); // re-sync the drain with the (possibly extended) clock
}

function openBusAlert() {
  const s = session;
  overlay = 'bus';
  pauseGame();
  // Group every bus arriving around the same time into one alert.
  let trips = bus.upcoming(now(), s.dismissed).filter((a) => a.at <= s.deadline + 30_000);
  if (!trips.length && s.tracked) trips = [s.tracked];
  s.alertTrips = trips;
  const routes = [...new Set(trips.map((a) => a.route))];
  $('bus-alert-title').textContent = routes.length > 1
    ? `Routes ${routes.join(' & ')} are almost here`
    : `Route ${routes[0] ?? ''} is almost here`;
  $('bus-alert-routes').replaceChildren(...routes.map(routeBadge));
  renderBusAlert();
  $('bus-alert').hidden = false;
  $('not-my-bus').focus();
  sound.play('bus');
  announce(`${$('bus-alert-title').textContent}. Game paused.`);
}

function renderBusAlert() {
  $('bus-alert-secs').textContent = String(Math.max(0, Math.ceil((session.deadline - now()) / 1000)));
}

function notMyBus() {
  const s = session;
  if (!s || overlay !== 'bus') return;
  for (const a of s.alertTrips) s.dismissed.add(a.trip);
  if (s.tracked) s.dismissed.add(s.tracked.trip);
  // The deadline may move *later* here: it follows the next bus, still capped.
  retargetDeadline();
  $('bus-alert').hidden = true;
  runResumeCountdown();
}

function runResumeCountdown() {
  overlay = 'countdown';
  const el = $('countdown');
  const num = $('countdown-num');
  el.hidden = false;
  const steps = TIMING.resumeCountdownSec;
  for (let i = 0; i <= steps; i++) {
    countdownTimers.push(setTimeout(() => {
      if (i < steps) {
        num.textContent = String(steps - i);
        // restart the pop animation for each numeral
        num.style.animation = 'none';
        void num.offsetWidth;
        num.style.animation = '';
        sound.play('count');
      } else {
        el.hidden = true;
        overlay = null;
        sound.play('go');
        resumeGame();
      }
    }, i * TIMING.resumeStepMs));
  }
}

function hideOverlays() {
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];
  $('bus-alert').hidden = true;
  $('countdown').hidden = true;
  $('toast').hidden = true;
  overlay = null;
  pausedRemaining = null;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastIdleRender = 0;

function tick() {
  const t = now();

  if (phase === 'idle') {
    if (t - lastIdleRender > 5000) {
      lastIdleRender = t;
      renderDepartures();
    }
    return;
  }

  if (phase === 'loading') return; // screenTimer starts the session

  if (phase === 'ended') {
    if ((endScreenUntil && t >= endScreenUntil) || t - lastInteraction > TIMING.endScreenIdleMs) goIdle();
    return;
  }

  const s = session;
  if (t >= s.deadline) return endSession(s.source === 'bus' ? 'bus' : 'cap');

  if (s.source === 'bus' && !overlay && s.deadline - t <= TIMING.busWarningMs) openBusAlert();
  renderBusClock();
  if (overlay === 'bus') renderBusAlert();

  if (!overlay) {
    if (phase === 'question') {
      renderTimer();
      if (t >= phaseEndsAt) answer(null);
    } else if (phase === 'reveal') {
      renderNext();
      if (t >= phaseEndsAt) startRound();
    }
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
document.addEventListener('pointerdown', () => {
  lastInteraction = now();
  sound.unlock();
}, { capture: true });
document.addEventListener('keydown', () => (lastInteraction = now()), { capture: true });
// Browsers freeze CSS animations while the page is hidden (screen dimmed, Safari
// backgrounded) but our clock keeps running, so re-sync the drain on return.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && session && pausedRemaining === null) startPhaseDrain(phaseLeft());
});

$('start-btn').addEventListener('click', () => { sound.play('tap'); beginLoading(); });
$('play-again').addEventListener('click', () => { sound.play('tap'); beginLoading(); });
$('done-btn').addEventListener('click', goIdle);
$('screen-timeout').addEventListener('click', goIdle); // tap skips the idle notice
$('not-my-bus').addEventListener('click', notMyBus);
$('answers').addEventListener('click', (e) => {
  const btn = e.target.closest('.answer');
  if (btn && !btn.disabled) answer(Number(btn.dataset.i));
});

function renderSoundToggle() {
  const on = !sound.isMuted();
  $('sound-toggle').setAttribute('aria-pressed', String(on));
  $('sound-label').textContent = on ? 'Sound on' : 'Sound off';
}
$('sound-toggle').addEventListener('click', () => {
  sound.setMuted(!sound.isMuted());
  renderSoundToggle();
  sound.play('tap');
});

board.seedIfNeeded();
renderSoundToggle();
goIdle();
bus.setPollInterval(TIMING.busPollIdleMs);
bus.refresh();
setInterval(tick, 200);

if (DEBUG) {
  import('./debug.js').then((m) =>
    m.mountDebug({ bus, getSession: () => session, getBank: () => questionBank })
  );
}
