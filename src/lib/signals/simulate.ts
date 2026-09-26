import "server-only";
import * as groww from "@/lib/api/groww";
import { STRATEGIES } from "./strategies";
import { collectTrades, type BacktestTrade } from "./backtest";

/**
 * A portfolio simulation of the signals over REAL history — the "forward test,
 * run on the past". It takes a starting capital, sizes each position by risk,
 * caps how many run at once and how much capital each takes, and — crucially —
 * charges realistic Indian delivery costs and slippage on every trade. It
 * reports the gross curve AND the net curve so the cost drag is impossible to
 * hide, splits the timeline into an in-sample and a held-out out-of-sample half
 * so a fitted-to-the-past number cannot masquerade as an edge, and never
 * invents a fill: entries and exits are the strategy's own real levels.
 *
 * This is the honest answer to "can this make 20% a month": you watch the real
 * equity curve, after costs, and read it for yourself.
 */

const UNIVERSE = [
  "NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX",
  "RELIANCE", "HDFCBANK", "INFY", "TCS", "ITC", "SBIN", "LT", "AXISBANK",
  "ICICIBANK", "MARUTI", "TITAN", "SUNPHARMA", "WIPRO", "ONGC", "BAJFINANCE",
  "TATASTEEL", "JSWSTEEL", "POWERGRID", "NTPC", "ADANIPORTS", "KOTAKBANK",
  "HINDUNILVR", "COALINDIA", "TATAPOWER", "HINDALCO", "BEL", "TRENT",
];

export interface SimParams {
  startCapital: number;
  /** fraction of equity risked per trade (0.01 = 1%). */
  riskPct: number;
  maxConcurrent: number;
  /** cap on one position's notional as a fraction of equity. */
  maxPositionPct: number;
  /**
   * Round-trip cost as a fraction of notional — brokerage + STT + exchange +
   * GST + stamp for NSE delivery, plus slippage. ~0.45% is a realistic, mildly
   * conservative all-in for a swing trade held days.
   */
  costRoundTrip: number;
}

export const DEFAULT_SIM: SimParams = {
  startCapital: 100_000,
  riskPct: 0.01,
  maxConcurrent: 6,
  maxPositionPct: 0.2,
  costRoundTrip: 0.0045,
};

interface SimTrade extends BacktestTrade {
  symbol: string;
}

export interface EquityPoint {
  t: number;
  equity: number;
}

export interface MonthReturn {
  month: string; // YYYY-MM
  pct: number;
}

export interface SimResult {
  params: SimParams;
  strategies: string[];
  from: number | null;
  to: number | null;
  years: number;
  signals: number;
  taken: number;
  skipped: number;
  wins: number;
  losses: number;
  winRate: number | null;
  startCapital: number;
  endGross: number;
  endNet: number;
  totalReturnPct: number | null;
  cagrPct: number | null;
  maxDrawdownPct: number | null;
  avgHoldDays: number | null;
  costPaid: number;
  curveNet: EquityPoint[];
  curveGross: EquityPoint[];
  months: MonthReturn[];
  /** the held-out second half — the number that has NOT been fitted. */
  oos: { from: number; to: number; returnPct: number } | null;
}

const g = globalThis as { __mnhaSim?: Map<string, { at: number; data: SimResult }> };
g.__mnhaSim ??= new Map();
const cache = g.__mnhaSim;

const monthKey = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" })
    .format(new Date(ms))
    .slice(0, 7);

async function gatherTrades(strategyNames: string[]): Promise<SimTrade[]> {
  const strats = STRATEGIES.filter((s) => strategyNames.includes(s.name));
  const all: SimTrade[] = [];
  for (const sym of UNIVERSE) {
    for (const strat of strats) {
      const candles = await groww.getCandles(sym, strat.interval, strat.lookbackDays).catch(() => []);
      if (candles.length < 60) continue;
      for (const t of collectTrades(strat, candles)) all.push({ ...t, symbol: sym });
    }
  }
  return all.sort((a, b) => a.entryTime - b.entryTime);
}

function run(trades: SimTrade[], p: SimParams, withCost: boolean): {
  curve: EquityPoint[];
  end: number;
  taken: number;
  skipped: number;
  wins: number;
  losses: number;
  costPaid: number;
  holdDaysTotal: number;
} {
  let cash = p.startCapital;
  let reserved = 0;
  const open: { exitTime: number; notional: number; netPnl: number }[] = [];
  const curve: EquityPoint[] = [{ t: trades[0]?.entryTime ?? Date.now(), equity: cash }];
  let taken = 0, skipped = 0, wins = 0, losses = 0, costPaid = 0, holdDaysTotal = 0;

  const closeDue = (until: number) => {
    open.sort((a, b) => a.exitTime - b.exitTime);
    while (open.length && open[0].exitTime <= until) {
      const pos = open.shift()!;
      cash += pos.notional + pos.netPnl;
      reserved -= pos.notional;
      curve.push({ t: pos.exitTime, equity: cash + reserved });
    }
  };

  for (const tr of trades) {
    closeDue(tr.entryTime);
    const equity = cash + reserved;
    if (open.length >= p.maxConcurrent) { skipped++; continue; }

    const riskDist = Math.abs(tr.entry - tr.stop);
    if (!(riskDist > 0)) { skipped++; continue; }
    let shares = Math.floor((equity * p.riskPct) / riskDist);
    let notional = shares * tr.entry;
    const capNotional = equity * p.maxPositionPct;
    if (notional > capNotional) { shares = Math.floor(capNotional / tr.entry); notional = shares * tr.entry; }
    if (notional > cash) { shares = Math.floor(cash / tr.entry); notional = shares * tr.entry; }
    if (shares < 1) { skipped++; continue; }

    const dir = tr.side === "LONG" ? 1 : -1;
    const grossPnl = shares * (tr.exit - tr.entry) * dir;
    const cost = withCost ? notional * p.costRoundTrip : 0;
    const netPnl = grossPnl - cost;
    costPaid += cost;
    if (netPnl > 0) wins++; else losses++;
    holdDaysTotal += Math.max(0, (tr.exitTime - tr.entryTime) / (24 * 3_600 * 1_000));

    cash -= notional;
    reserved += notional;
    open.push({ exitTime: tr.exitTime, notional, netPnl });
    taken++;
  }
  // close whatever is still open
  open.sort((a, b) => a.exitTime - b.exitTime);
  for (const pos of open) {
    cash += pos.notional + pos.netPnl;
    reserved -= pos.notional;
    curve.push({ t: pos.exitTime, equity: cash });
  }
  return { curve, end: cash, taken, skipped, wins, losses, costPaid, holdDaysTotal };
}

export async function simulatePortfolio(
  strategyNames: string[] = ["mean-reversion"],
  params: SimParams = DEFAULT_SIM,
): Promise<SimResult> {
  const key = `${strategyNames.slice().sort().join(",")}|${JSON.stringify(params)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.data;

  const trades = await gatherTrades(strategyNames);
  const from = trades[0]?.entryTime ?? null;
  const to = trades.at(-1)?.exitTime ?? null;
  const years = from && to ? (to - from) / (365.25 * 24 * 3_600 * 1_000) : 0;

  const net = run(trades, params, true);
  const gross = run(trades, params, false);

  // drawdown on the net curve
  let peak = -Infinity, maxDD = 0;
  for (const pt of net.curve) {
    if (pt.equity > peak) peak = pt.equity;
    if (peak > 0) maxDD = Math.max(maxDD, (peak - pt.equity) / peak);
  }

  // monthly returns from the net curve (month-end equity vs prior month-end)
  const byMonthEnd = new Map<string, number>();
  for (const pt of net.curve) byMonthEnd.set(monthKey(pt.t), pt.equity);
  const monthsSorted = [...byMonthEnd.keys()].sort();
  const months: MonthReturn[] = [];
  let prevEq = params.startCapital;
  for (const m of monthsSorted) {
    const eq = byMonthEnd.get(m)!;
    months.push({ month: m, pct: prevEq > 0 ? +(((eq - prevEq) / prevEq) * 100).toFixed(2) : 0 });
    prevEq = eq;
  }

  // out-of-sample: trades whose entry is in the second half of the timeline
  let oos: SimResult["oos"] = null;
  if (from && to && to > from) {
    const mid = from + (to - from) * 0.6;
    const oosTrades = trades.filter((t) => t.entryTime >= mid);
    if (oosTrades.length > 5) {
      const oosRun = run(oosTrades, params, true);
      oos = { from: mid, to, returnPct: +(((oosRun.end - params.startCapital) / params.startCapital) * 100).toFixed(2) };
    }
  }

  const totalReturnPct = +(((net.end - params.startCapital) / params.startCapital) * 100).toFixed(2);
  const cagrPct = years > 0.1 ? +((Math.pow(net.end / params.startCapital, 1 / years) - 1) * 100).toFixed(2) : null;

  const result: SimResult = {
    params,
    strategies: strategyNames,
    from,
    to,
    years: +years.toFixed(2),
    signals: trades.length,
    taken: net.taken,
    skipped: net.skipped,
    wins: net.wins,
    losses: net.losses,
    winRate: net.taken ? +((net.wins / net.taken) * 100).toFixed(1) : null,
    startCapital: params.startCapital,
    endGross: Math.round(gross.end),
    endNet: Math.round(net.end),
    totalReturnPct,
    cagrPct,
    maxDrawdownPct: +(maxDD * 100).toFixed(1),
    avgHoldDays: net.taken ? +(net.holdDaysTotal / net.taken).toFixed(1) : null,
    costPaid: Math.round(net.costPaid),
    curveNet: net.curve,
    curveGross: gross.curve,
    months,
    oos,
  };
  cache.set(key, { at: Date.now(), data: result });
  return result;
}
