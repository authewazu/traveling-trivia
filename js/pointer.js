import { POINTER } from './config.js';

// ---------------------------------------------------------------------------
// Hover-to-select input for hand tracking (ml5 handPose).
//
// Any input source feeds positions in SCREEN-NORMALIZED coordinates:
//   x: 0 = left edge of the game screen, 1 = right edge
//   y: 0 = top edge,                     1 = bottom edge
// already mirrored like a selfie (move your hand right → cursor moves right).
// videoToScreen() converts an ml5 keypoint into that space.
//
// The module smooths the position, draws the always-visible cursor, works out
// which target it is over, and calls onSelect(el) after POINTER.dwellMs of
// continuous hovering, showing a seconds countdown (2 → 1) beside the cursor.
// What counts as a target depends on the current context ('answers', 'bus',
// 'end', or null for none), which the game sets via setContext().
// ---------------------------------------------------------------------------

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ml5 handPose keypoints are in the video's pixel space. Mirroring must
// happen exactly once, or the cursor moves opposite to the hand:
//   flipped: true  → ml5 was created with { flipped: true }, so keypoints are
//                    already mirrored; nothing more is done here (default).
//   flipped: false → raw front-camera keypoints; mirrored here.
// `video` may be an HTMLVideoElement or a p5 capture (createCapture).
// `region` is the part of the camera frame (0–1) that maps onto the whole
// screen, so riders can reach every answer without stretching to the edge of
// the camera's view.
export function videoToScreen(keypoint, video, {
  flipped = true,
  region = { x0: 0.15, x1: 0.85, y0: 0.15, y1: 0.85 },
} = {}) {
  const el = video.elt ?? video; // p5 capture → its <video>
  const w = el.videoWidth || video.width;
  const h = el.videoHeight || video.height;
  let x = keypoint.x / w;
  const y = keypoint.y / h;
  if (!flipped) x = 1 - x;
  return {
    x: (x - region.x0) / (region.x1 - region.x0),
    y: (y - region.y0) / (region.y1 - region.y0),
  };
}

export function createDwellPointer({ app, cursor, countEl, getZones, onSelect, onActivity }) {
  let pos = null; // smoothed cursor position in px, relative to the app frame
  let context = null; // which targets are live; null = hovering selects nothing
  let ignoreZone = -1; // target the hand was resting on when the context began
  let dwell = null; // { zone, el, start, leftAt }
  let raf = 0;

  function zoneAt(x, y) {
    const zones = getZones(context);
    for (let i = 0; i < zones.length; i++) {
      const r = zones[i].rect;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { index: i, el: zones[i].el };
    }
    return { index: -1, el: null };
  }

  function paintProgress(p, secondsLeft) {
    cursor.style.setProperty('--p', p);
    dwell?.el?.style.setProperty('--p', p);
    countEl.textContent = secondsLeft > 0 ? String(secondsLeft) : '';
  }

  function cancel() {
    if (dwell?.el) dwell.el.classList.remove('is-dwelling');
    dwell = null;
    cursor.classList.remove('is-dwelling');
    paintProgress(0, 0);
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function begin(zone, el) {
    cancel();
    dwell = { zone, el, start: performance.now(), leftAt: 0 };
    el?.classList.add('is-dwelling');
    cursor.classList.add('is-dwelling');
    paintProgress(0, POINTER.dwellSeconds);
    raf = requestAnimationFrame(frame);
  }

  // Advances the dwell: grace-period expiry, the countdown progress, and the
  // selection itself. Called from every animation frame (smooth visuals; also
  // completes for a perfectly still mouse) AND from every position update, so
  // a selection never depends on animation frames, which browsers pause when
  // the page isn't visible. Returns false once the dwell has ended.
  function step(t) {
    if (!dwell) return false;
    if (dwell.leftAt && t - dwell.leftAt > POINTER.exitGraceMs) {
      cancel();
      return false;
    }
    const elapsed = t - dwell.start;
    if (elapsed >= POINTER.dwellMs) {
      const { zone, el } = dwell;
      cancel();
      ignoreZone = zone; // no repeat selection until the hand moves away
      onSelect(el);
      return false;
    }
    // Whole seconds left (2 → 1), in nominal seconds even when ?speed= scales time.
    const left = Math.ceil((POINTER.dwellSeconds * (POINTER.dwellMs - elapsed)) / POINTER.dwellMs);
    paintProgress(elapsed / POINTER.dwellMs, left);
    return true;
  }

  function frame(t) {
    if (step(t)) raf = requestAnimationFrame(frame);
  }

  function evaluate() {
    if (!pos || !context) return cancel();
    const { index, el } = zoneAt(pos.x, pos.y);
    if (index !== ignoreZone) ignoreZone = -1; // left the resting zone: re-armed
    const target = index === ignoreZone ? -1 : index;

    if (!dwell) {
      if (target !== -1) begin(target, el);
    } else if (target === dwell.zone) {
      dwell.leftAt = 0; // back inside within the grace period
    } else if (target !== -1) {
      begin(target, el); // moved straight onto another answer
    } else if (!dwell.leftAt) {
      dwell.leftAt = performance.now(); // slipped out: grace period starts
    }
  }

  // `filtered: true` = the source already smoothed the position (the camera
  // wrapper's One Euro filter), so don't add a second, lag-inducing smoothing.
  function update(nx, ny, { filtered = false } = {}) {
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return lost();
    const r = app.getBoundingClientRect();
    const tx = clamp01(nx) * r.width;
    const ty = clamp01(ny) * r.height;
    const k = filtered ? 1 : POINTER.smoothing;
    pos = pos ? { x: pos.x + (tx - pos.x) * k, y: pos.y + (ty - pos.y) * k } : { x: tx, y: ty };
    cursor.hidden = false;
    cursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    onActivity?.();
    evaluate();
    step(performance.now());
  }

  function lost() {
    pos = null;
    cursor.hidden = true;
    cancel();
  }

  // Switch which targets are live. On every switch, a hand already resting on
  // a new target (e.g. where "That's not my bus" pops up, or on the answer it
  // picked last round) doesn't count until it moves off it.
  function setContext(next) {
    if (next === context) return;
    cancel();
    context = next;
    if (!context) return;
    ignoreZone = pos ? zoneAt(pos.x, pos.y).index : -1;
    evaluate();
  }

  return { update, lost, setContext };
}
