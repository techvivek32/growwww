import type { Candle } from "@/lib/api/groww";

/**
 * Plain technical primitives over a candle series. Every function returns a
 * full-length array aligned to the input (leading values are null until the
 * lookback is satisfied) so a strategy can read indicator[i] beside candle[i]
 * without off-by-one bookkeeping. Nothing here invents a value — where the
 * window is not yet full, the slot is null.
 */

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values.
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI, full-length. */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Wilder's ATR (average true range), full-length. */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;

  const tr: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }

  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Session VWAP, reset at each IST calendar day. Full-length; a bar carries the
 * running VWAP of its own session up to and including that bar.
 */
export function sessionVwap(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let day = "";
  let pv = 0;
  let vol = 0;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const d = fmt.format(new Date(c.time));
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
    out[i] = vol > 0 ? pv / vol : c.close;
  }
  return out;
}

/** Highest high / lowest low over the `n` bars ENDING at i-1 (excludes i). */
export function priorExtreme(
  candles: Candle[],
  i: number,
  n: number,
): { high: number; low: number } | null {
  if (i < n) return null;
  let high = -Infinity;
  let low = Infinity;
  for (let k = i - n; k < i; k++) {
    if (candles[k].high > high) high = candles[k].high;
    if (candles[k].low < low) low = candles[k].low;
  }
  return { high, low };
}
