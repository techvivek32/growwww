import "server-only";

/**
 * A tiny in-memory fixed-window rate limiter — enough to blunt credential
 * brute-forcing on a single-box deployment. (A multi-box deployment would move
 * this to a shared store like Redis.)
 */

interface Window {
  count: number;
  resetAt: number;
}

const g = globalThis as { __mnhaRate?: Map<string, Window> };
g.__mnhaRate ??= new Map();
const buckets = g.__mnhaRate;

export interface RateResult {
  ok: boolean;
  retryAfterSec: number;
}

/** Record a hit for `key`; deny once `max` hits fall inside `windowMs`. */
export function rateLimit(key: string, max: number, windowMs: number): RateResult {
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  w.count++;
  if (w.count > max) return { ok: false, retryAfterSec: Math.ceil((w.resetAt - now) / 1000) };
  return { ok: true, retryAfterSec: 0 };
}

/** Clear a key on success, so a good login resets the attempt count. */
export function rateReset(key: string): void {
  buckets.delete(key);
}

// Opportunistic sweep so the map cannot grow without bound.
if (!(g as { __mnhaRateSweep?: boolean }).__mnhaRateSweep) {
  (g as { __mnhaRateSweep?: boolean }).__mnhaRateSweep = true;
  setInterval(() => {
    const now = Date.now();
    for (const [k, w] of buckets) if (now >= w.resetAt) buckets.delete(k);
  }, 10 * 60_000).unref?.();
}
