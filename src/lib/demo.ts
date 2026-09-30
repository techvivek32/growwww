import "server-only";
import { getTicks } from "@/lib/api/groww";

/**
 * Demo workspace data — a LABELLED sample multi-account view.
 *
 * Prices are pulled LIVE from Groww so the levels are real; the positions and
 * the per-trade P&L are illustrative sample figures (shown behind a clear
 * "Demo — sample data" label). It never touches a real account and is not a
 * record of real trades or returns.
 */

export interface DemoTrade {
  day: string;
  symbol: string;
  segment: "CASH" | "FNO";
  qty: number;
  buy: number;
  sell: number;
  pnl: number;
}

export interface DemoAccount {
  id: string;
  name: string;
  role: string;
  capital: number;
  trades: DemoTrade[];
  pnl: number;
  value: number;
  pnlPct: number;
}

interface RawTrade {
  symbol: string;
  /** symbol to price off (equity ticker or index); the shown price = its LTP. */
  priceSym: string;
  segment: "CASH" | "FNO";
  qty: number;
  /** the illustrative P&L this sample trade shows. */
  targetPnl: number;
  /** used only if the live price is unavailable. */
  fallback: number;
}

function lastMarketDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" });
  while (out.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) out.push(fmt.format(d));
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

const ACCOUNTS: { id: string; name: string; role: string; capital: number; raw: RawTrade[] }[] = [
  {
    id: "vivek", name: "Vivek Hemantbhai Vora", role: "Primary linked account", capital: 500_000,
    raw: [
      { symbol: "NIFTY", priceSym: "NIFTY", segment: "FNO", qty: 225, targetPnl: 15_750, fallback: 22700 },
      { symbol: "NIFTY", priceSym: "NIFTY", segment: "FNO", qty: 225, targetPnl: 18_000, fallback: 22700 },
      { symbol: "BANKNIFTY", priceSym: "BANKNIFTY", segment: "FNO", qty: 60, targetPnl: 12_000, fallback: 54500 },
      { symbol: "RELIANCE", priceSym: "RELIANCE", segment: "CASH", qty: 250, targetPnl: 14_000, fallback: 1300 },
      { symbol: "HDFCBANK", priceSym: "HDFCBANK", segment: "CASH", qty: 150, targetPnl: 9_000, fallback: 1720 },
      { symbol: "INFY", priceSym: "INFY", segment: "CASH", qty: 120, targetPnl: 9_000, fallback: 1555 },
      { symbol: "SBIN", priceSym: "SBIN", segment: "CASH", qty: 400, targetPnl: 12_000, fallback: 642 },
      { symbol: "TATASTEEL", priceSym: "TATASTEEL", segment: "CASH", qty: 600, targetPnl: 9_000, fallback: 164 },
      { symbol: "ICICIBANK", priceSym: "ICICIBANK", segment: "CASH", qty: 65, targetPnl: 3_250, fallback: 1060 },
    ],
  },
  {
    id: "vikas", name: "Mr. Vikas", role: "Linked account", capital: 50_000,
    raw: [
      { symbol: "TATAPOWER", priceSym: "TATAPOWER", segment: "CASH", qty: 300, targetPnl: 6_000, fallback: 440 },
      { symbol: "SBIN", priceSym: "SBIN", segment: "CASH", qty: 100, targetPnl: 3_000, fallback: 642 },
      { symbol: "NIFTY", priceSym: "NIFTY", segment: "FNO", qty: 75, targetPnl: 3_000, fallback: 22700 },
    ],
  },
  {
    id: "shah", name: "Dr. Shah", role: "Linked account", capital: 50_000,
    raw: [
      { symbol: "RELIANCE", priceSym: "RELIANCE", segment: "CASH", qty: 80, targetPnl: 4_000, fallback: 1294 },
      { symbol: "INFY", priceSym: "INFY", segment: "CASH", qty: 40, targetPnl: 3_000, fallback: 1555 },
      { symbol: "TATASTEEL", priceSym: "TATASTEEL", segment: "CASH", qty: 200, targetPnl: 4_000, fallback: 169 },
    ],
  },
];

/** Real prices from Groww; sample positions/P&L behind the Demo label. */
export async function getDemoAccounts(): Promise<DemoAccount[]> {
  const symbols = [...new Set(ACCOUNTS.flatMap((a) => a.raw.map((r) => r.priceSym)))];
  let ltp: Record<string, number> = {};
  try {
    const ticks = await getTicks(symbols);
    ltp = Object.fromEntries(Object.entries(ticks).map(([k, v]) => [k, v.last]));
  } catch {
    /* fall back to the sample levels below */
  }

  const days = lastMarketDays(5);
  return ACCOUNTS.map((a) => {
    const trades: DemoTrade[] = a.raw.map((r, i) => {
      const sell = +(ltp[r.priceSym] ?? r.fallback).toFixed(2); // real current price
      const buy = +(sell - r.targetPnl / r.qty).toFixed(2); // sits below the live price
      return { day: days[i % days.length], symbol: r.symbol, segment: r.segment, qty: r.qty, buy, sell, pnl: r.targetPnl };
    });
    const pnl = trades.reduce((s, t) => s + t.pnl, 0);
    const value = a.capital + pnl;
    return { id: a.id, name: a.name, role: a.role, capital: a.capital, trades, pnl, value, pnlPct: +((pnl / a.capital) * 100).toFixed(2) };
  });
}
