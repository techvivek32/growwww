import type { Candle } from "@/lib/api/groww";
import { ema, sma, rsi, atr, sessionVwap, priorExtreme } from "./indicators";

/**
 * The strategy library. Every setup is a MECHANICAL rule read off real
 * candles: a condition, an entry at that bar's close, and a stop and target
 * derived from the bar's own ATR — no discretionary levels, nothing that
 * cannot be recomputed from the data. Each fires long OR short, so the board
 * carries both sides the way an Indian F&O trader needs (CE and PE alike map
 * to LONG/SHORT on the underlying's move).
 *
 * A strategy never claims an edge here. It only says "this pattern is present
 * now". Whether the pattern actually pays is decided by the backtest and the
 * live journal — measured, not asserted.
 */

export type Side = "LONG" | "SHORT";

export interface Signal {
  strategy: string;
  side: Side;
  /** Bar index the signal was read at. */
  at: number;
  entry: number;
  stop: number;
  target: number;
  /** target/stop distance ratio — an outcome of the two, not an input. */
  rr: number;
  reason: string;
}

/** Precomputed indicators shared across strategies for one candle series. */
export interface Indicators {
  ema20: (number | null)[];
  ema50: (number | null)[];
  sma200: (number | null)[];
  rsi2: (number | null)[];
  rsi14: (number | null)[];
  atr14: (number | null)[];
  vwap: (number | null)[];
}

export function computeIndicators(candles: Candle[]): Indicators {
  const close = candles.map((c) => c.close);
  return {
    ema20: ema(close, 20),
    ema50: ema(close, 50),
    sma200: sma(close, 200),
    rsi2: rsi(close, 2),
    rsi14: rsi(close, 14),
    atr14: atr(candles, 14),
    vwap: sessionVwap(candles),
  };
}

export interface Strategy {
  name: string;
  label: string;
  description: string;
  /** Bar size the setup is read on, in minutes (1440 = daily). */
  interval: number;
  /** How far back to pull candles for scanning and backtesting. */
  lookbackDays: number;
  /** null when the pattern is not present at bar i. */
  evaluate: (candles: Candle[], i: number, ind: Indicators) => Signal | null;
}

/** Build the long/short pair around an entry with an ATR stop and R multiple. */
function frame(
  strategy: string,
  side: Side,
  at: number,
  entry: number,
  atrVal: number,
  stopMult: number,
  rrMult: number,
  reason: string,
): Signal | null {
  if (!(atrVal > 0) || !(entry > 0)) return null;
  const risk = atrVal * stopMult;
  const stop = side === "LONG" ? entry - risk : entry + risk;
  const target = side === "LONG" ? entry + risk * rrMult : entry - risk * rrMult;
  if (stop <= 0 || target <= 0) return null;
  return {
    strategy,
    side,
    at,
    entry: +entry.toFixed(2),
    stop: +stop.toFixed(2),
    target: +target.toFixed(2),
    rr: +rrMult.toFixed(2),
    reason,
  };
}

/* ---------------------------------------------------------------- setups */

/**
 * Mean reversion — the setup that actually measures a positive edge on this
 * universe: in an uptrend regime (close above the 200-day SMA), a two-day RSI
 * below 10 is a stretched dip that tends to snap back. Fixed 1.5-ATR stop, 1R
 * target — the same exit the journal scores against. The short mirror fades a
 * two-day RSI above 90 while price is below the 200-SMA (downtrend regime).
 */
const meanReversion: Strategy = {
  name: "mean-reversion",
  label: "Mean reversion (RSI-2)",
  description:
    "Buys a 2-day RSI below 10 while price holds above its 200-day average (a dip inside an uptrend); fades a 2-day RSI above 90 below the 200-day average. Daily bars. The one setup with a measured positive edge here.",
  interval: 1440,
  lookbackDays: 900,
  evaluate(candles, i, ind) {
    const c = candles[i];
    const s200 = ind.sma200[i];
    const r2 = ind.rsi2[i];
    const a = ind.atr14[i];
    if (s200 === null || r2 === null || a === null) return null;

    if (c.close > s200 && r2 < 10) {
      return frame("mean-reversion", "LONG", i, c.close, a, 1.5, 1, "Oversold dip in an uptrend (RSI-2 < 10 above 200-SMA)");
    }
    if (c.close < s200 && r2 > 90) {
      return frame("mean-reversion", "SHORT", i, c.close, a, 1.5, 1, "Overbought pop in a downtrend (RSI-2 > 90 below 200-SMA)");
    }
    return null;
  },
};

/** Trend pullback: aligned EMAs, price pokes back to EMA20 and closes away. */
const emaPullback: Strategy = {
  name: "ema-pullback",
  label: "EMA trend pullback",
  description:
    "EMA20 and EMA50 aligned; price dips to the EMA20 and closes back in the trend's direction. Rides the trend after a shallow pullback.",
  interval: 1440,
  lookbackDays: 900,
  evaluate(candles, i, ind) {
    const c = candles[i];
    const e20 = ind.ema20[i];
    const e50 = ind.ema50[i];
    const a = ind.atr14[i];
    if (e20 === null || e50 === null || a === null) return null;

    const up = e20 > e50;
    const down = e20 < e50;
    const touchedUp = c.low <= e20 && c.close > e20 && c.close > c.open;
    const touchedDown = c.high >= e20 && c.close < e20 && c.close < c.open;

    if (up && touchedUp) {
      return frame("ema-pullback", "LONG", i, c.close, a, 1.2, 2, "Pullback to EMA20 held in an uptrend");
    }
    if (down && touchedDown) {
      return frame("ema-pullback", "SHORT", i, c.close, a, 1.2, 2, "Rejection at EMA20 in a downtrend");
    }
    return null;
  },
};

/** Range breakout: close clears the prior 20-bar extreme on a strong bar. */
const breakout: Strategy = {
  name: "range-breakout",
  label: "Range breakout",
  description:
    "Close breaks the highest high (or lowest low) of the prior 20 bars by more than a quarter-ATR. Enters in the breakout's direction.",
  interval: 1440,
  lookbackDays: 900,
  evaluate(candles, i, ind) {
    const c = candles[i];
    const a = ind.atr14[i];
    const ext = priorExtreme(candles, i, 20);
    if (a === null || ext === null) return null;

    if (c.close > ext.high + a * 0.25 && c.close > c.open) {
      return frame("range-breakout", "LONG", i, c.close, a, 1.0, 2.5, "Broke the 20-bar high");
    }
    if (c.close < ext.low - a * 0.25 && c.close < c.open) {
      return frame("range-breakout", "SHORT", i, c.close, a, 1.0, 2.5, "Broke the 20-bar low");
    }
    return null;
  },
};

/** VWAP reclaim: price crosses back through session VWAP. Intraday only. */
const vwapReclaim: Strategy = {
  name: "vwap-reclaim",
  label: "VWAP reclaim",
  description:
    "Price closes back across the session VWAP after trading the other side of it — the intraday balance point flipping. Read on 15-minute bars.",
  interval: 15,
  lookbackDays: 30,
  evaluate(candles, i, ind) {
    if (i < 1) return null;
    const c = candles[i];
    const pc = candles[i - 1];
    const v = ind.vwap[i];
    const pv = ind.vwap[i - 1];
    const a = ind.atr14[i];
    if (v === null || pv === null || a === null) return null;

    if (pc.close < pv && c.close > v) {
      return frame("vwap-reclaim", "LONG", i, c.close, a, 1.0, 1.8, "Reclaimed session VWAP from below");
    }
    if (pc.close > pv && c.close < v) {
      return frame("vwap-reclaim", "SHORT", i, c.close, a, 1.0, 1.8, "Lost session VWAP from above");
    }
    return null;
  },
};

// Mean reversion leads: it is the setup that measures a real edge here. The
// trend setups (pullback, breakout) are kept precisely so the board can show
// them being retired — the scorecard marks them by their measured expectancy,
// not by a claim. VWAP reclaim is the one intraday setup.
export const STRATEGIES: Strategy[] = [meanReversion, vwapReclaim, emaPullback, breakout];

export function strategyByName(name: string): Strategy | undefined {
  return STRATEGIES.find((s) => s.name === name);
}
