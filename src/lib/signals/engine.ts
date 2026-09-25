import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import * as groww from "@/lib/api/groww";
import { marketState } from "@/lib/market";
import { STRATEGIES, computeIndicators, strategyByName } from "./strategies";
import { collectTrades, summarize, type BacktestResult } from "./backtest";
import {
  recordSignals,
  resolveSignals,
  openSignals,
  getSignals,
  liveStats,
  type JournalSignal,
} from "./journal";

/**
 * The signal brain. On a cadence during market hours it:
 *  1. resolves every open signal against the latest real price (won / lost),
 *  2. reads fresh candles for the universe and records any setup that fires,
 *  3. periodically re-runs the backtest over real history so the edge shown
 *     is measured, not asserted.
 *
 * It NEVER places an order. It produces signals and scores them; execution
 * stays behind the same manual, two-step, TRADING_ENABLED-gated path the rest
 * of the app uses. A promise of "zero-loss 20% a month" is not a thing this or
 * any engine can keep — what it can do is show each setup's real hit rate and
 * expectancy and stop surfacing the ones that stop paying.
 */

/* --------------------------------------------------------------- universe */

// Liquid NSE names + the tradable index underlyings. F&O signals map to the
// underlying's move: a LONG is the CE case, a SHORT the PE case.
const EQUITIES = [
  "RELIANCE", "HDFCBANK", "INFY", "TCS", "ITC", "SBIN", "LT", "AXISBANK",
  "ICICIBANK", "MARUTI", "TITAN", "SUNPHARMA", "WIPRO", "ONGC", "BAJFINANCE",
  "TATASTEEL", "JSWSTEEL", "POWERGRID", "NTPC", "ADANIPORTS", "KOTAKBANK",
  "HINDUNILVR", "COALINDIA", "TATAPOWER", "HINDALCO", "BEL", "TRENT",
];
const INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX"];

/** Prior weight for the backtest edge before live results outvote it. */
const PRIOR_WEIGHT = 25;

interface EngineState {
  timer?: ReturnType<typeof setInterval>;
  scanning: boolean;
  lastScan: number | null;
  lastBacktest: number | null;
  backtests: BacktestResult[];
}

const g = globalThis as { __mnhaEngine?: EngineState };
g.__mnhaEngine ??= { scanning: false, lastScan: null, lastBacktest: null, backtests: [] };
const state = g.__mnhaEngine;

const BT_FILE = process.env.BACKTEST_FILE ?? path.join(process.cwd(), "data", "backtests.json");

/* ------------------------------------------------------------- one scan */

function universe(): { symbol: string; segment: "CASH" | "FNO" }[] {
  return [
    ...INDICES.map((s) => ({ symbol: s, segment: "FNO" as const })),
    ...EQUITIES.map((s) => ({ symbol: s, segment: "CASH" as const })),
  ];
}

async function pool<T, R>(items: T[], size: number, run: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map(run))));
  }
  return out;
}

/** Distinct bar intervals across the library, with the deepest lookback each. */
function intervalGroups(): { interval: number; lookback: number; strategies: typeof STRATEGIES }[] {
  const by = new Map<number, { interval: number; lookback: number; strategies: typeof STRATEGIES }>();
  for (const s of STRATEGIES) {
    const g = by.get(s.interval) ?? { interval: s.interval, lookback: 0, strategies: [] };
    g.lookback = Math.max(g.lookback, s.lookbackDays);
    g.strategies.push(s);
    by.set(s.interval, g);
  }
  return [...by.values()];
}

/** Evaluate one interval group over the universe at the last closed bar. */
async function scanGroup(
  grp: { interval: number; lookback: number; strategies: typeof STRATEGIES },
): Promise<Omit<JournalSignal, "id" | "createdAt" | "status">[]> {
  const u = universe();
  const found = await pool(u, 4, async (x) => {
    const candles = await groww.getCandles(x.symbol, grp.interval, grp.lookback).catch(() => []);
    if (candles.length < 60) return [];
    const ind = computeIndicators(candles);
    const i = candles.length - 2; // last CLOSED bar
    const rows: Omit<JournalSignal, "id" | "createdAt" | "status">[] = [];
    for (const strat of grp.strategies) {
      const sig = strat.evaluate(candles, i, ind);
      if (!sig) continue;
      rows.push({
        symbol: x.symbol,
        segment: x.segment,
        strategy: sig.strategy,
        side: sig.side,
        interval: grp.interval,
        entry: sig.entry,
        stop: sig.stop,
        target: sig.target,
        rr: sig.rr,
        reason: sig.reason,
      });
    }
    return rows;
  });
  return found.flat();
}

/** One full pass: resolve open signals, then look for new ones. */
export async function runScan(): Promise<{ recorded: number; resolved: number }> {
  if (state.scanning) return { recorded: 0, resolved: 0 };
  state.scanning = true;
  try {
    // Resolve first, on the freshest prices for whatever is open.
    const open = await openSignals();
    let resolved = 0;
    if (open.length) {
      const syms = [...new Set(open.map((s) => s.symbol))];
      const ticks = await groww.getTicks(syms).catch(() => ({} as Record<string, groww.Tick>));
      const prices: Record<string, number> = {};
      for (const [s, t] of Object.entries(ticks)) prices[s] = t.last;
      resolved = await resolveSignals(prices);
    }

    const groups = intervalGroups();
    const found = (await Promise.all(groups.map((g) => scanGroup(g).catch(() => [])))).flat();
    const recorded = await recordSignals(found);

    state.lastScan = Date.now();
    return { recorded, resolved };
  } finally {
    state.scanning = false;
  }
}

/* --------------------------------------------------------- backtesting */

/** Aggregate each strategy's trades across the whole universe on its own bars. */
export async function refreshBacktests(): Promise<BacktestResult[]> {
  const u = universe();
  const groups = intervalGroups();

  // Fetch each needed (symbol, interval) once, then score every strategy that
  // reads that interval over the same series.
  const results: BacktestResult[] = [];
  for (const grp of groups) {
    const series = await pool(u, 4, (x) =>
      groww.getCandles(x.symbol, grp.interval, grp.lookback).catch(() => []),
    );
    for (const strat of grp.strategies) {
      const trades = series.flatMap((c) => (c.length >= 60 ? collectTrades(strat, c) : []));
      const bars = series.reduce((a, c) => a + c.length, 0);
      results.push(summarize(strat.name, trades, bars));
    }
  }

  state.backtests = results;
  state.lastBacktest = Date.now();
  try {
    await mkdir(path.dirname(BT_FILE), { recursive: true });
    const tmp = `${BT_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify({ at: state.lastBacktest, results }, null, 2), "utf8");
    await rename(tmp, BT_FILE);
  } catch {
    /* in-memory copy still serves the UI */
  }
  return results;
}

async function loadBacktests(): Promise<{ at: number | null; results: BacktestResult[] }> {
  if (state.backtests.length) return { at: state.lastBacktest, results: state.backtests };
  try {
    const raw = await readFile(BT_FILE, "utf8");
    const parsed = JSON.parse(raw) as { at: number; results: BacktestResult[] };
    state.backtests = parsed.results;
    state.lastBacktest = parsed.at;
    return { at: parsed.at, results: parsed.results };
  } catch {
    return { at: null, results: [] };
  }
}

/* ----------------------------------------------------- the scorecard */

export interface Scorecard {
  strategy: string;
  label: string;
  description: string;
  backtest: BacktestResult | null;
  liveResolved: number;
  liveOpen: number;
  liveWinRate: number | null;
  liveExpectancy: number | null;
  /** backtest edge shrunk toward the live evidence as it accumulates. */
  blendedExpectancy: number | null;
  /** true when the blended edge is positive — the board acts only on these. */
  edge: boolean;
}

/**
 * Merge the backtested edge (the prior) with the live journal (the evidence).
 * Early on, the backtest dominates; as real resolved signals pile up they
 * outvote it. A strategy is only "actionable" when the blend stays positive —
 * this is the learning that quietly retires setups that stop working.
 */
export async function scorecards(): Promise<Scorecard[]> {
  const [{ results }, signals] = await Promise.all([loadBacktests(), getSignals()]);
  const live = liveStats(signals);

  return STRATEGIES.map((strat) => {
    const bt = results.find((r) => r.strategy === strat.name) ?? null;
    const ls = live.get(strat.name);
    const btExp = bt?.expectancy ?? null;
    const liveExp = ls?.expectancy ?? null;
    const n = ls?.resolved ?? 0;

    let blended: number | null = null;
    if (btExp !== null && liveExp !== null) {
      blended = +((btExp * PRIOR_WEIGHT + liveExp * n) / (PRIOR_WEIGHT + n)).toFixed(3);
    } else if (btExp !== null) blended = btExp;
    else if (liveExp !== null) blended = liveExp;

    return {
      strategy: strat.name,
      label: strat.label,
      description: strat.description,
      backtest: bt,
      liveResolved: ls?.resolved ?? 0,
      liveOpen: ls?.open ?? 0,
      liveWinRate: ls?.winRate ?? null,
      liveExpectancy: liveExp,
      blendedExpectancy: blended,
      edge: blended !== null && blended > 0,
    };
  });
}

/** Open signals whose strategy currently carries a positive blended edge. */
export async function actionableSignals(): Promise<JournalSignal[]> {
  const [open, cards] = await Promise.all([openSignals(), scorecards()]);
  const good = new Set(cards.filter((c) => c.edge).map((c) => c.strategy));
  return open
    .filter((s) => good.has(s.strategy))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function engineStatus() {
  return {
    running: Boolean(state.timer),
    scanning: state.scanning,
    lastScan: state.lastScan,
    lastBacktest: state.lastBacktest,
  };
}

/* ------------------------------------------------------------- lifecycle */

const SCAN_EVERY_MS = 3 * 60 * 1_000;
const BACKTEST_EVERY_MS = 2 * 3_600 * 1_000;

/** Start the background loop. Idempotent — a second call is a no-op. */
export function startEngine(): void {
  if (state.timer || !groww.hasCredentials()) return;

  const tick = async () => {
    try {
      if (marketState().isLive) await runScan();
      if (!state.lastBacktest || Date.now() - state.lastBacktest > BACKTEST_EVERY_MS) {
        await refreshBacktests();
      }
    } catch (err) {
      console.error("[engine] tick failed:", err instanceof Error ? err.message : err);
    }
  };

  state.timer = setInterval(tick, SCAN_EVERY_MS);
  // Kick once on boot: backtest always, scan if the market is live.
  void tick();
  console.log("[engine] signal engine started");
}

export { strategyByName };
