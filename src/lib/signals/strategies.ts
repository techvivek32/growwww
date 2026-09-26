import type { Candle } from "@/lib/api/groww";
import { ema, sma, rsi, atr, sessionVwap, priorExtreme, stdev, macd, rocPct } from "./indicators";

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
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  std20: (number | null)[];
  rsi2: (number | null)[];
  rsi14: (number | null)[];
  atr14: (number | null)[];
  vwap: (number | null)[];
  macdLine: (number | null)[];
  macdSignal: (number | null)[];
  roc20: (number | null)[];
  volSma20: (number | null)[];
}

export function computeIndicators(candles: Candle[]): Indicators {
  const close = candles.map((c) => c.close);
  const vol = candles.map((c) => c.volume);
  const m = macd(close);
  return {
    ema20: ema(close, 20),
    ema50: ema(close, 50),
    sma20: sma(close, 20),
    sma50: sma(close, 50),
    sma200: sma(close, 200),
    std20: stdev(close, 20),
    rsi2: rsi(close, 2),
    rsi14: rsi(close, 14),
    atr14: atr(candles, 14),
    vwap: sessionVwap(candles),
    macdLine: m.line,
    macdSignal: m.signal,
    roc20: rocPct(close, 20),
    volSma20: sma(vol, 20),
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
  /** Close the trade at market after this many bars if neither level is hit. */
  timeStopBars?: number;
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
    "Buys a 2-day RSI below 10 while price holds above its 200-day average (a dip inside an uptrend); fades a 2-day RSI above 90 below the 200-day average. Daily bars, 1.5-ATR stop, 1R target, closed after 20 bars. High win rate, small edge — and correlated, so the portfolio drawdown is realer than the per-trade number suggests.",
  interval: 1440,
  lookbackDays: 900,
  timeStopBars: 20,
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

/* ---- more ways to read the tape: mean-reversion, momentum, volatility ---- */

/** Bollinger reversion: close pierces a 2σ band, faded back toward the mean. */
const bollinger: Strategy = {
  name: "bollinger-reversion",
  label: "Bollinger reversion",
  description:
    "Close pokes below the lower 20-day, 2σ band while above the 200-SMA (buy the stretch) or above the upper band while below it (sell the stretch). Daily bars.",
  interval: 1440,
  lookbackDays: 900,
  timeStopBars: 15,
  evaluate(c, i, ind) {
    const b = c[i], m = ind.sma20[i], sd = ind.std20[i], s200 = ind.sma200[i], a = ind.atr14[i];
    if (m === null || sd === null || s200 === null || a === null) return null;
    const lower = m - 2 * sd, upper = m + 2 * sd;
    if (b.close < lower && b.close > s200) return frame("bollinger-reversion", "LONG", i, b.close, a, 2, 1.5, "Closed below the lower Bollinger band in an uptrend");
    if (b.close > upper && b.close < s200) return frame("bollinger-reversion", "SHORT", i, b.close, a, 2, 1.5, "Closed above the upper Bollinger band in a downtrend");
    return null;
  },
};

/** Classic RSI-14 extremes. */
const rsi14Extremes: Strategy = {
  name: "rsi14-extremes",
  label: "RSI-14 extremes",
  description:
    "The textbook oscillator: RSI-14 below 30 is oversold (long), above 70 overbought (short). Daily bars. Shown because everyone watches it — the scorecard says whether it actually pays.",
  interval: 1440,
  lookbackDays: 900,
  timeStopBars: 15,
  evaluate(c, i, ind) {
    const b = c[i], r = ind.rsi14[i], a = ind.atr14[i];
    if (r === null || a === null) return null;
    if (r < 30 && b.close > b.open) return frame("rsi14-extremes", "LONG", i, b.close, a, 2, 1.5, "RSI-14 oversold (< 30) with an up bar");
    if (r > 70 && b.close < b.open) return frame("rsi14-extremes", "SHORT", i, b.close, a, 2, 1.5, "RSI-14 overbought (> 70) with a down bar");
    return null;
  },
};

/** Donchian channel breakout — the classic turtle 55-bar break. */
const donchian: Strategy = {
  name: "donchian-breakout",
  label: "Donchian 55 breakout",
  description:
    "Close makes a new 55-bar high (long) or low (short) — the trend-following turtle rule. Daily bars, wide ATR stop.",
  interval: 1440,
  lookbackDays: 900,
  evaluate(c, i, ind) {
    const b = c[i], a = ind.atr14[i], ext = priorExtreme(c, i, 55);
    if (a === null || ext === null) return null;
    if (b.close > ext.high) return frame("donchian-breakout", "LONG", i, b.close, a, 2, 3, "New 55-day high");
    if (b.close < ext.low) return frame("donchian-breakout", "SHORT", i, b.close, a, 2, 3, "New 55-day low");
    return null;
  },
};

/** Moving-average crossover (golden/death cross of EMA20 over EMA50). */
const maCross: Strategy = {
  name: "ma-crossover",
  label: "EMA 20/50 crossover",
  description:
    "EMA20 crosses above EMA50 (golden cross, long) or below it (death cross, short) — the simplest trend flip. Daily bars.",
  interval: 1440,
  lookbackDays: 900,
  evaluate(c, i, ind) {
    if (i < 1) return null;
    const e20 = ind.ema20[i], e50 = ind.ema50[i], pe20 = ind.ema20[i - 1], pe50 = ind.ema50[i - 1], a = ind.atr14[i];
    if (e20 === null || e50 === null || pe20 === null || pe50 === null || a === null) return null;
    if (pe20 <= pe50 && e20 > e50) return frame("ma-crossover", "LONG", i, c[i].close, a, 2, 2.5, "EMA20 crossed above EMA50");
    if (pe20 >= pe50 && e20 < e50) return frame("ma-crossover", "SHORT", i, c[i].close, a, 2, 2.5, "EMA20 crossed below EMA50");
    return null;
  },
};

/** MACD signal-line cross, filtered by the zero line. */
const macdCross: Strategy = {
  name: "macd-cross",
  label: "MACD cross",
  description:
    "MACD crosses above its signal line below zero (momentum turning up, long) or below signal above zero (turning down, short). Daily bars.",
  interval: 1440,
  lookbackDays: 900,
  timeStopBars: 20,
  evaluate(c, i, ind) {
    if (i < 1) return null;
    const l = ind.macdLine[i], s = ind.macdSignal[i], pl = ind.macdLine[i - 1], ps = ind.macdSignal[i - 1], a = ind.atr14[i];
    if (l === null || s === null || pl === null || ps === null || a === null) return null;
    if (pl <= ps && l > s) return frame("macd-cross", "LONG", i, c[i].close, a, 1.5, 2, "MACD crossed above its signal line");
    if (pl >= ps && l < s) return frame("macd-cross", "SHORT", i, c[i].close, a, 1.5, 2, "MACD crossed below its signal line");
    return null;
  },
};

/** New 52-week high / low — the momentum extreme everyone quotes. */
const highLow52: Strategy = {
  name: "high-low-52w",
  label: "52-week high / low",
  description:
    "Close prints a new ~52-week (250-bar) high (long) or low (short) — momentum at the extreme of the year's range. Daily bars.",
  interval: 1440,
  lookbackDays: 900,
  evaluate(c, i, ind) {
    const b = c[i], a = ind.atr14[i], ext = priorExtreme(c, i, 250);
    if (a === null || ext === null) return null;
    if (b.close > ext.high) return frame("high-low-52w", "LONG", i, b.close, a, 2, 3, "New 52-week high");
    if (b.close < ext.low) return frame("high-low-52w", "SHORT", i, b.close, a, 2, 3, "New 52-week low");
    return null;
  },
};

/** Volume-confirmed breakout: a 20-bar break on ≥2× average volume. */
const volumeBreakout: Strategy = {
  name: "volume-breakout",
  label: "Volume breakout",
  description:
    "A 20-bar high (or low) that closes on at least twice the 20-day average volume — the breakout the crowd is actually behind. Daily bars.",
  interval: 1440,
  lookbackDays: 900,
  evaluate(c, i, ind) {
    const b = c[i], a = ind.atr14[i], v = ind.volSma20[i], ext = priorExtreme(c, i, 20);
    if (a === null || v === null || ext === null || v <= 0) return null;
    const heavy = b.volume >= 2 * v;
    if (!heavy) return null;
    if (b.close > ext.high && b.close > b.open) return frame("volume-breakout", "LONG", i, b.close, a, 1.5, 2.5, "20-day high on 2× volume");
    if (b.close < ext.low && b.close < b.open) return frame("volume-breakout", "SHORT", i, b.close, a, 1.5, 2.5, "20-day low on 2× volume");
    return null;
  },
};

/** Bollinger squeeze: bands at their tightest, then a break — volatility expansion. */
const squeeze: Strategy = {
  name: "bollinger-squeeze",
  label: "Volatility squeeze",
  description:
    "After the tightest Bollinger bands in 40 bars (coiled, low volatility), the close breaks the band — volatility expanding out of a base. Trades the break's direction. Daily bars.",
  interval: 1440,
  lookbackDays: 900,
  timeStopBars: 20,
  evaluate(c, i, ind) {
    if (i < 40) return null;
    const b = c[i], m = ind.sma20[i], sd = ind.std20[i], a = ind.atr14[i];
    if (m === null || sd === null || a === null) return null;
    // was the prior bar's bandwidth the tightest of the last 40?
    let minBw = Infinity;
    for (let k = i - 40; k < i; k++) {
      const mk = ind.sma20[k], sk = ind.std20[k];
      if (mk !== null && sk !== null && mk > 0) minBw = Math.min(minBw, (2 * sk) / mk);
    }
    const prevM = ind.sma20[i - 1], prevSd = ind.std20[i - 1];
    if (prevM === null || prevSd === null || prevM <= 0) return null;
    const prevBw = (2 * prevSd) / prevM;
    if (prevBw > minBw * 1.05) return null; // only right out of the tightest coil
    if (b.close > m + 2 * sd) return frame("bollinger-squeeze", "LONG", i, b.close, a, 1.5, 2.5, "Broke up out of a volatility squeeze");
    if (b.close < m - 2 * sd) return frame("bollinger-squeeze", "SHORT", i, b.close, a, 1.5, 2.5, "Broke down out of a volatility squeeze");
    return null;
  },
};

/** Opening-range breakout: the first 15-min bar's range, broken intraday. */
const openingRange: Strategy = {
  name: "opening-range",
  label: "Opening-range breakout",
  description:
    "The first 15-minute bar sets the day's range; a later bar breaking above it goes long, below it short. Classic intraday momentum. 15-minute bars.",
  interval: 15,
  lookbackDays: 30,
  timeStopBars: 24,
  evaluate(c, i, ind) {
    const b = c[i], a = ind.atr14[i];
    if (a === null || i < 1) return null;
    // find this session's first bar (IST date change)
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
    const day = fmt.format(new Date(b.time));
    let first = i;
    while (first > 0 && fmt.format(new Date(c[first - 1].time)) === day) first--;
    if (first === i) return null; // the opening bar itself sets the range
    const orHigh = c[first].high, orLow = c[first].low;
    const pc = c[i - 1];
    if (pc.close <= orHigh && b.close > orHigh) return frame("opening-range", "LONG", i, b.close, a, 1.0, 2, "Broke above the opening-range high");
    if (pc.close >= orLow && b.close < orLow) return frame("opening-range", "SHORT", i, b.close, a, 1.0, 2, "Broke below the opening-range low");
    return null;
  },
};

/**
 * The full library, arranged so the strongest read leads. Every one is scored
 * by its own real backtest and live journal; the board tags each Active or
 * Retired by its MEASURED edge, never by the label. This is the market read
 * every way at once — trend and counter-trend, breakout and fade, momentum and
 * volatility, long and short, daily and intraday — and an honest scorecard
 * saying which of them actually paid.
 */
export const STRATEGIES: Strategy[] = [
  meanReversion,
  bollinger,
  rsi14Extremes,
  emaPullback,
  breakout,
  donchian,
  maCross,
  macdCross,
  highLow52,
  volumeBreakout,
  squeeze,
  vwapReclaim,
  openingRange,
];

export function strategyByName(name: string): Strategy | undefined {
  return STRATEGIES.find((s) => s.name === name);
}
