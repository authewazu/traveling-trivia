// Synthesized cues (no audio files to load). Every cue has a paired visual in
// the UI; see the "Sound ↔ visual" table in README.md.
//
// iOS Safari only allows audio after a user gesture, so unlock() is called
// from the first tap.

const CUES = {
  tap: [[660, 0.05]],
  correct: [[660, 0.1], [880, 0.1], [1320, 0.18]],
  wrong: [[220, 0.18, 'sawtooth'], [180, 0.25, 'sawtooth']],
  tick: [[1000, 0.04, 'square']],
  bus: [[784, 0.18], [0, 0.06], [784, 0.18], [0, 0.06], [988, 0.35]],
  notice: [[587, 0.12], [784, 0.2]],
  count: [[523, 0.12]],
  go: [[1047, 0.25]],
};

let ctx = null;
let muted = false;
try { muted = localStorage.getItem('tbs.muted') === '1'; } catch {}

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('tbs.muted', v ? '1' : '0'); } catch {}
}

export function play(name) {
  if (muted || !ctx || !CUES[name]) return;
  let t = ctx.currentTime;
  for (const [freq, dur, type = 'sine'] of CUES[name]) {
    if (freq > 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
    t += dur;
  }
}
