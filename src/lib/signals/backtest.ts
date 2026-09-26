import type { Candle } from "@/lib/api/groww";
import { computeIndicators, type Strategy, type Signal } from "./strategies";

/**
 * Walk a strategy across a real candle series and score every trade it would
 * have taken. Entry is that bar's close; then each later bar is checked in
 * order — stop first when a bar's range spans both (the conservative read) —
 * and the trade closes at whichever level is touched. An open trade left at
 * the end is marked out at the last close.
 *
 * Result is R-multiples: a stop is −1R, the target is +rrR, and everything
 * reported (win rate, expectancy, profit factor, drawdown) is arithmetic on
 * those real outcomes. No edge is assumed anywhere; this is the measurement
 * that decides whether a setup is allowed to speak on the live board.
 */

export interface BacktestTrade {
  side: Signal["side"];
  entryTime: number;
  exitTime: number;
  entry: number;
  /** the stop price the size was risked against — needed to size a position. */
  stop: number;
  exit: number;
  r: number;
  outcome: "target" | "stop" | "timeout";
}

export interface BacktestResult {
  strategy: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgR: number | null;
  /** gross win R ÷ gross loss R; >1 means the setup made money. */
  profitFactor: number | null;
  /** mean R per trade — the honest per-trade expectation. */
  expectancy: number | null;
  /** worst peak-to-trough of the cumulative-R equity curve. */
  maxDrawdownR: number | null;
  bars: number;
}

const EMPTY = (strategy: string, bars: number): BacktestResult => ({
  strategy,
  trades: 0,
  wins: 0,
  losses: 0,
  winRate: null,
  avgR: null,
  profitFactor: null,
  expectancy: null,
  maxDrawdownR: null,
  bars,
});

/** Every trade a strategy would have taken over one candle series. */
export function collectTrades(strategy: Strategy, candles: Candle[]): BacktestTrade[] {
  if (candles.length < 60) return [];
  const ind = computeIndicators(candles);
  const trades: BacktestTrade[] = [];

  let i = 0;
  while (i < candles.length - 1) {
    const sig = strategy.evaluate(candles, i, ind);
    if (!sig) {
      i++;
      continue;
    }
    const risk = Math.abs(sig.entry - sig.stop);
    if (risk <= 0) {
      i++;
      continue;
    }

    let closed: BacktestTrade | null = null;
    for (let j = i + 1; j < candles.length; j++) {
      const b = candles[j];
      const hitStop = sig.side === "LONG" ? b.low <= sig.stop : b.high >= sig.stop;
      const hitTarget = sig.side === "LONG" ? b.high >= sig.target : b.low <= sig.target;

      if (hitStop) {
        closed = { side: sig.side, entryTime: candles[i].time, exitTime: b.time, entry: sig.entry, stop: sig.stop, exit: sig.stop, r: -1, outcome: "stop" };
      } else if (hitTarget) {
        closed = { side: sig.side, entryTime: candles[i].time, exitTime: b.time, entry: sig.entry, stop: sig.stop, exit: sig.target, r: +sig.rr, outcome: "target" };
      }
      if (closed) {
        i = j + 1; // no overlapping positions per strategy
        break;
      }
    }

    if (!closed) {
      const last = candles[candles.length - 1];
      const signed = sig.side === "LONG" ? last.close - sig.entry : sig.entry - last.close;
      trades.push({
        side: sig.side,
        entryTime: candles[i].time,
        exitTime: last.time,
        entry: sig.entry,
        stop: sig.stop,
        exit: last.close,
        r: +(signed / risk).toFixed(3),
        outcome: "timeout",
      });
      break;
    }
    trades.push(closed);
  }
  return trades;
}

/** Aggregate a set of trades into the honest scorecard. */
export function summarize(strategy: string, trades: BacktestTrade[], bars: number): BacktestResult {
  if (trades.length === 0) return EMPTY(strategy, bars);

  const wins = trades.filter((t) => t.r > 0);
  const losses = trades.filter((t) => t.r <= 0);
  const grossWin = wins.reduce((a, t) => a + t.r, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.r, 0));
  const totalR = trades.reduce((a, t) => a + t.r, 0);

  // Drawdown of the cumulative-R curve.
  let peak = 0;
  let equity = 0;
  let maxDD = 0;
  for (const t of trades) {
    equity += t.r;
    if (equity > peak) peak = equity;
    maxDD = Math.max(maxDD, peak - equity);
  }

  return {
    strategy,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: +((wins.length / trades.length) * 100).toFixed(1),
    avgR: +(totalR / trades.length).toFixed(3),
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : null,
    expectancy: +(totalR / trades.length).toFixed(3),
    maxDrawdownR: +maxDD.toFixed(2),
    bars,
  };
}

/** Backtest one strategy over one series. */
export function backtest(strategy: Strategy, candles: Candle[]): BacktestResult {
  return summarize(strategy.name, collectTrades(strategy, candles), candles.length);
}
