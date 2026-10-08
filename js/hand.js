import { HAND } from './config.js';

// ---------------------------------------------------------------------------
// Camera hand tracking: ml5.js handPose (v1) on the iPad's front camera.
//
// The camera feed is never shown. Each frame, the index fingertip of the most
// prominent hand is mirrored (by ml5, `flipped: true`), mapped from the camera
// frame onto the screen (HAND.region), smoothed with a One Euro filter, and
// handed to the hover engine (js/pointer.js), which draws the cursor and does
// the 2-second hover selection.
//
// ml5 v1 usage: create with ml5.handPose(options) — without p5, v1.4 returns
// a Promise for the model — wait until it's loaded (detectStart before then
// throws and stops the loop), then detectStart(video, callback); each result
// is a hand with `confidence` and named keypoints such as `index_finger_tip`
// {x, y} in video pixels.
// ---------------------------------------------------------------------------

// ---- One Euro filter (Casiez, Roussel & Vogel, CHI 2012) -----------------
// A low-pass filter whose cutoff rises with speed: very smooth while the hand
// is still (no jitter on a target), nearly lag-free during fast moves.
function smoothingFactor(cutoffHz, dt) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

class OneEuro {
  constructor({ minCutoff, beta, dCutoff }) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.reset();
  }
  reset() {
    this.x = null; // last filtered value
    this.dx = 0; // last filtered speed
    this.t = null;
  }
  filter(value, tMs) {
    if (this.x === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max((tMs - this.t) / 1000, 1e-3);
    this.t = tMs;
    const rawSpeed = (value - this.x) / dt;
    this.dx += smoothingFactor(this.dCutoff, dt) * (rawSpeed - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += smoothingFactor(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

// ---- helpers ----------------------------------------------------------------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(el);
  });
}

// iOS Safari only decodes frames for a video that is in the document, so the
// feed is attached but made invisible (not display:none).
function hiddenVideo() {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.setAttribute('aria-hidden', 'true');
  Object.assign(video.style, {
    position: 'fixed', left: '0', top: '0', width: '2px', height: '2px',
    opacity: '0', pointerEvents: 'none', zIndex: '-1',
  });
  document.body.append(video);
  return video;
}

// ---- tracking ------------------------------------------------------------------
// `pointer` is the hover engine ({ update, lost, videoToScreen }).
// Returns `stats`, a live object the ?debug panel reads.
export function startHandTracking(pointer) {
  const stats = {
    status: 'starting', // starting | loading-model | running | camera-denied | unavailable | error
    error: '',
    fps: 0,
    confidence: 0,
    video: '',
    raw: null, // fingertip in the camera frame (0–1, mirrored), before region mapping
    seen: null, // range of raw positions covered so far: { x0, x1, y0, y1 } — for calibrating HAND.region
  };
  const fx = new OneEuro(HAND.filter);
  const fy = new OneEuro(HAND.filter);
  let video = null;
  let handPose = null;
  let lastSeen = 0;
  let last = null; // last filtered screen position
  let frames = 0;
  let fpsWindowStart = performance.now();

  function onHands(hands) {
    const t = performance.now();
    frames++;
    if (t - fpsWindowStart >= 1000) {
      stats.fps = Math.round((frames * 1000) / (t - fpsWindowStart));
      frames = 0;
      fpsWindowStart = t;
    }

    const hand = hands.find((h) => (h.confidence ?? 1) >= HAND.minConfidence && h.index_finger_tip);
    if (!hand) {
      // Ride out brief dropouts; only report "no hand" after a real absence.
      if (last && t - lastSeen > HAND.lostAfterMs) {
        last = null;
        fx.reset();
        fy.reset();
        stats.raw = null;
        pointer.lost();
      }
      return;
    }
    lastSeen = t;
    stats.confidence = Math.round((hand.confidence ?? 0) * 100) / 100;

    const tip = hand.index_finger_tip;
    const raw = { x: tip.x / video.videoWidth, y: tip.y / video.videoHeight };
    stats.raw = raw;
    stats.seen = stats.seen
      ? { x0: Math.min(stats.seen.x0, raw.x), x1: Math.max(stats.seen.x1, raw.x), y0: Math.min(stats.seen.y0, raw.y), y1: Math.max(stats.seen.y1, raw.y) }
      : { x0: raw.x, x1: raw.x, y0: raw.y, y1: raw.y };

    // Keypoints are already mirrored by ml5 (flipped: true) → flipped: true here.
    const p = pointer.videoToScreen(tip, video, { flipped: HAND.model.flipped, region: HAND.region });
    // A big one-frame jump (e.g. a different person's hand) snaps rather than glides.
    if (last && Math.hypot(p.x - last.x, p.y - last.y) > HAND.jumpReset) {
      fx.reset();
      fy.reset();
    }
    last = { x: fx.filter(p.x, t), y: fy.filter(p.y, t) };
    pointer.update(last.x, last.y, { filtered: true });
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera API (needs HTTPS)'), { name: 'Unavailable' });
    const stream = await navigator.mediaDevices.getUserMedia({ video: HAND.camera, audio: false });
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadeddata', r, { once: true }));
    stats.video = `${video.videoWidth}×${video.videoHeight}`;
  }

  async function start() {
    try {
      video ??= hiddenVideo();
      await openCamera();
      stats.status = 'loading-model';
      if (!window.ml5) await loadScript(HAND.ml5Url);
      if (!handPose) {
        // ml5 1.4 returns a Promise for the model when used without p5 (with p5
        // it returns the model and preload() waits). Handle both.
        const created = window.ml5.handPose(HAND.model);
        handPose = typeof created?.then === 'function' ? await created : created;
      }
      await handPose.ready; // detectStart before the model is ready throws and stops the loop
      handPose.detectStart(video, onHands);
      stats.status = 'running';
    } catch (err) {
      console.warn('[hand] tracking unavailable:', err);
      stats.error = err?.message ?? String(err);
      if (err?.name === 'NotAllowedError') {
        // Denied, or Safari wants a user gesture first: retry once on the next tap.
        stats.status = 'camera-denied';
        document.addEventListener('pointerdown', start, { once: true });
      } else {
        stats.status = err?.name === 'Unavailable' || err?.name === 'NotFoundError' ? 'unavailable' : 'error';
      }
      // The game stays fully playable by tapping.
    }
  }

  // If the camera stops (iPad slept, Safari backgrounded), reopen it on return.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || stats.status !== 'running' || !video) return;
    const live = video.srcObject?.getVideoTracks().some((track) => track.readyState === 'live');
    if (live) return;
    try {
      await openCamera(); // detectStart keeps reading from the same <video>
    } catch (err) {
      console.warn('[hand] could not reopen camera:', err);
    }
  });

  start();
  return stats;
}
