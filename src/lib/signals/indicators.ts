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

/** Rolling standard deviation of `values` over `period` (population), full-length. */
export function stdev(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    sumSq += values[i] * values[i];
    if (i >= period) {
      sum -= values[i - period];
      sumSq -= values[i - period] * values[i - period];
    }
    if (i >= period - 1) {
      const mean = sum / period;
      out[i] = Math.sqrt(Math.max(0, sumSq / period - mean * mean));
    }
  }
  return out;
}

export interface Macd {
  line: (number | null)[];
  signal: (number | null)[];
}

/** MACD line (EMA fast − EMA slow) and its signal EMA, full-length. */
export function macd(values: number[], fast = 12, slow = 26, sig = 9): Macd {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  const line: (number | null)[] = values.map((_, i) =>
    ef[i] !== null && es[i] !== null ? ef[i]! - es[i]! : null,
  );
  // signal = EMA of the (dense) macd line, mapped back to full length
  const start = line.findIndex((v) => v !== null);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  if (start >= 0) {
    const dense = line.slice(start).map((v) => v as number);
    const sg = ema(dense, sig);
    for (let k = 0; k < sg.length; k++) signal[start + k] = sg[k];
  }
  return { line, signal };
}

/** Rate of change over `n` bars, in percent. Full-length. */
export function rocPct(values: number[], n: number): (number | null)[] {
  return values.map((v, i) =>
    i >= n && values[i - n] > 0 ? ((v - values[i - n]) / values[i - n]) * 100 : null,
  );
}

export interface HeikinAshi {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
}

/** Heikin-Ashi candles — the smoothed candles reels love for reading trend. */
export function heikinAshi(candles: Candle[]): HeikinAshi {
  const n = candles.length;
  const open = new Array(n).fill(0);
  const high = new Array(n).fill(0);
  const low = new Array(n).fill(0);
  const close = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    close[i] = (c.open + c.high + c.low + c.close) / 4;
    open[i] = i === 0 ? (c.open + c.close) / 2 : (open[i - 1] + close[i - 1]) / 2;
    high[i] = Math.max(c.high, open[i], close[i]);
    low[i] = Math.min(c.low, open[i], close[i]);
  }
  return { open, high, low, close };
}

export interface SessionLevels {
  /** Central Pivot Range top / bottom, from the PRIOR IST session. */
  tc: (number | null)[];
  bc: (number | null)[];
  /** Prior session high / low. */
  pdh: (number | null)[];
  pdl: (number | null)[];
}

/**
 * Per-bar levels derived from the PRIOR completed IST trading day — the Central
 * Pivot Range (CPR) and previous-day high/low that Indian intraday traders live
 * by. Meant for an intraday series; each bar carries the levels computed from
 * the day before it (null on the first day, before a prior day exists).
 */
export function sessionLevels(candles: Candle[]): SessionLevels {
  const n = candles.length;
  const tc: (number | null)[] = new Array(n).fill(null);
  const bc: (number | null)[] = new Array(n).fill(null);
  const pdh: (number | null)[] = new Array(n).fill(null);
  const pdl: (number | null)[] = new Array(n).fill(null);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

  let curDay = "";
  let dayHi = -Infinity, dayLo = Infinity, dayClose = 0;
  // levels of the most recently COMPLETED day, applied to the current day
  let prior: { tc: number; bc: number; pdh: number; pdl: number } | null = null;

  for (let i = 0; i < n; i++) {
    const d = fmt.format(new Date(candles[i].time));
    if (d !== curDay) {
      if (curDay !== "") {
        const pivot = (dayHi + dayLo + dayClose) / 3;
        const bcv = (dayHi + dayLo) / 2;
        const tcv = 2 * pivot - bcv;
        prior = { tc: Math.max(tcv, bcv), bc: Math.min(tcv, bcv), pdh: dayHi, pdl: dayLo };
      }
      curDay = d;
      dayHi = -Infinity; dayLo = Infinity; dayClose = candles[i].close;
    }
    dayHi = Math.max(dayHi, candles[i].high);
    dayLo = Math.min(dayLo, candles[i].low);
    dayClose = candles[i].close;
    if (prior) { tc[i] = prior.tc; bc[i] = prior.bc; pdh[i] = prior.pdh; pdl[i] = prior.pdl; }
  }
  return { tc, bc, pdh, pdl };
}

export interface Supertrend {
  /** trend direction per bar: +1 up, -1 down, null until seeded. */
  dir: (number | null)[];
  /** the supertrend line value per bar. */
  line: (number | null)[];
}

/**
 * Supertrend — the single most-used indicator across Indian retail algo repos.
 * ATR bands around the HL2 midline; the line flips side when price closes
 * through it, and the flip is the trade trigger. `period` = ATR length,
 * `mult` = band width. Full-length arrays; leading slots null until seeded.
 */
export function supertrend(candles: Candle[], period = 10, mult = 3): Supertrend {
  const n = candles.length;
  const dir: (number | null)[] = new Array(n).fill(null);
  const line: (number | null)[] = new Array(n).fill(null);
  const a = atr(candles, period);

  let prevUpper = 0;
  let prevLower = 0;
  let prevDir = 1;
  let seeded = false;

  for (let i = 0; i < n; i++) {
    if (a[i] === null) continue;
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicUpper = hl2 + mult * (a[i] as number);
    const basicLower = hl2 - mult * (a[i] as number);
    const close = candles[i].close;
    const prevClose = candles[i - 1]?.close ?? close;

    const finalUpper = !seeded || basicUpper < prevUpper || prevClose > prevUpper ? basicUpper : prevUpper;
    const finalLower = !seeded || basicLower > prevLower || prevClose < prevLower ? basicLower : prevLower;

    let d: number;
    if (!seeded) d = close > hl2 ? 1 : -1;
    else if (prevDir === 1) d = close < finalLower ? -1 : 1;
    else d = close > finalUpper ? 1 : -1;

    dir[i] = d;
    line[i] = d === 1 ? finalLower : finalUpper;
    prevUpper = finalUpper;
    prevLower = finalLower;
    prevDir = d;
    seeded = true;
  }
  return { dir, line };
}
