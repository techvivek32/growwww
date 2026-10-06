/**
 * The blink check, as a pure state machine so it can be tested without a camera.
 *
 * Each video frame becomes a FaceFrame (from the on-device face landmarker):
 * how many faces, where the face sits, and how closed each eye is (0 open,
 * 1 closed). The person must keep ONE face in the oval and blink twice; the
 * photo is then taken on a frame where the eyes are open again. A printed
 * photo cannot blink, which is the point. It runs entirely on the phone.
 */

export interface FaceFrame {
  faces: number;
  /** Face bounds as fractions of the frame (0–1). */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Eye-closure scores, 0 = open, 1 = closed. */
  blinkL: number;
  blinkR: number;
}

export type Hint = "none" | "many" | "far" | "near" | "center" | "blink" | "blinkOnce" | "hold";

export interface LivenessState {
  blinks: number;
  eyesClosed: boolean;
  closedAt: number;
  lastBlinkAt: number;
  lostSince: number | null;
}

export const BLINKS_NEEDED = 2;
/** Both eyes past this (on average) = closed; under OPEN = open again. A gap avoids flicker. */
const CLOSED = 0.45;
const OPEN = 0.25;
/** A blink is quick; eyes shut longer than this are not counted. */
const MAX_BLINK_MS = 1200;
/** Losing the face for this long starts the count again. */
const LOST_RESET_MS = 1500;
/** After the last blink, wait this long so the photo has fully open eyes. */
const SETTLE_MS = 350;

export function initLiveness(): LivenessState {
  return { blinks: 0, eyesClosed: false, closedAt: 0, lastBlinkAt: 0, lostSince: null };
}

/** Where the face is, as a hint — or null when it sits well in the oval. */
export function placement(f: FaceFrame): Hint | null {
  if (f.faces === 0 || !f.box) return "none";
  if (f.faces > 1) return "many";
  const w = f.box.x1 - f.box.x0;
  const h = f.box.y1 - f.box.y0;
  const size = Math.max(w, h);
  if (size < 0.28) return "far";
  if (size > 0.88) return "near";
  const cx = (f.box.x0 + f.box.x1) / 2;
  const cy = (f.box.y0 + f.box.y1) / 2;
  if (cx < 0.3 || cx > 0.7 || cy < 0.25 || cy > 0.75) return "center";
  return null;
}

/** Advance one frame. `capture` is true on the frame the photo should be taken. */
export function stepLiveness(s: LivenessState, f: FaceFrame, now: number): { state: LivenessState; hint: Hint; capture: boolean } {
  const st = { ...s };
  const place = placement(f);

  if (place === "none") {
    st.lostSince ??= now;
    if (now - st.lostSince > LOST_RESET_MS) {
      st.blinks = 0;
      st.eyesClosed = false;
    }
    return { state: st, hint: "none", capture: false };
  }
  st.lostSince = null;
  if (place === "many") {
    // Someone else in the frame could do the blinking — start over.
    return { state: { ...st, blinks: 0, eyesClosed: false }, hint: "many", capture: false };
  }
  if (place) return { state: { ...st, eyesClosed: false }, hint: place, capture: false };

  const closure = (f.blinkL + f.blinkR) / 2;
  if (!st.eyesClosed && closure > CLOSED) {
    st.eyesClosed = true;
    st.closedAt = now;
  } else if (st.eyesClosed && closure < OPEN) {
    st.eyesClosed = false;
    if (now - st.closedAt <= MAX_BLINK_MS && st.blinks < BLINKS_NEEDED) {
      st.blinks += 1;
      st.lastBlinkAt = now;
    }
  }

  if (st.blinks < BLINKS_NEEDED) return { state: st, hint: st.blinks === 0 ? "blink" : "blinkOnce", capture: false };
  const capture = !st.eyesClosed && closure < OPEN && now - st.lastBlinkAt >= SETTLE_MS;
  return { state: st, hint: "hold", capture };
}

/** Progress for the ring around the oval, 0–1. */
export function progress(s: LivenessState, hint: Hint): number {
  if (hint === "none" || hint === "many" || hint === "far" || hint === "near" || hint === "center") return s.blinks / (BLINKS_NEEDED + 1);
  return (s.blinks + 1) / (BLINKS_NEEDED + 1);
}
