/**
 * Linked accounts data — the multi-account view: each account's capital,
 * recent trades and P&L, rolled up per account.
 *
 * NOTE FOR DEVELOPERS: the trade rows below are hand-set constants, not broker
 * data. Wire `getLinkedAccounts()` to the broker/holdings source before these
 * figures are treated as an account's actual position.
 */

export interface LinkedTrade {
  day: string; // e.g. "Mon, 28 Sep"
  symbol: string;
  segment: "CASH" | "FNO";
  qty: number;
  buy: number;
  sell: number;
  pnl: number;
}

export interface LinkedAccount {
  id: string;
  name: string;
  role: string;
  capital: number;
  trades: LinkedTrade[];
  pnl: number;
  value: number;
  pnlPct: number;
}

/** The last `n` weekday (Mon–Fri) dates, oldest first — an approximation of
 *  market days (exchange holidays are ignored here). */
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

function build(id: string, name: string, role: string, capital: number, raw: Omit<LinkedTrade, "day" | "pnl">[]): LinkedAccount {
  const days = lastMarketDays(5);
  const trades: LinkedTrade[] = raw.map((t, i) => ({
    ...t,
    day: days[i % days.length],
    pnl: (t.sell - t.buy) * t.qty,
  }));
  const pnl = trades.reduce((s, t) => s + t.pnl, 0);
  const value = capital + pnl;
  return { id, name, role, capital, trades, pnl, value, pnlPct: +((pnl / capital) * 100).toFixed(2) };
}

// Trades hand-set so each account's P&L sums to its target exactly.
export function getLinkedAccounts(): LinkedAccount[] {
  return [
    build("vivek", "Vivek Hemantbhai Vora", "Primary linked account", 500_000, [
      { symbol: "NIFTY 24800 CE", segment: "FNO", qty: 225, buy: 142, sell: 212 }, // 15,750
      { symbol: "NIFTY 24600 PE", segment: "FNO", qty: 225, buy: 96, sell: 176 }, // 18,000
      { symbol: "BANKNIFTY 54500 CE", segment: "FNO", qty: 60, buy: 360, sell: 560 }, // 12,000
      { symbol: "RELIANCE", segment: "CASH", qty: 250, buy: 1244, sell: 1300 }, // 14,000
      { symbol: "HDFCBANK", segment: "CASH", qty: 150, buy: 1660, sell: 1720 }, // 9,000
      { symbol: "INFY", segment: "CASH", qty: 120, buy: 1480, sell: 1555 }, // 9,000
      { symbol: "SBIN", segment: "CASH", qty: 400, buy: 612, sell: 642 }, // 12,000
      { symbol: "TATASTEEL", segment: "CASH", qty: 600, buy: 149, sell: 164 }, // 9,000
      { symbol: "ICICIBANK", segment: "CASH", qty: 65, buy: 1010, sell: 1060 }, // 3,250
    ]), // total = 1,02,000
    build("vikas", "Mr. Vikas", "Linked account", 50_000, [
      { symbol: "TATAPOWER", segment: "CASH", qty: 300, buy: 420, sell: 440 }, // 6,000
      { symbol: "SBIN", segment: "CASH", qty: 100, buy: 612, sell: 642 }, // 3,000
      { symbol: "NIFTY 24800 CE", segment: "FNO", qty: 75, buy: 142, sell: 182 }, // 3,000
    ]), // total = 12,000
    build("shah", "Dr. Shah", "Linked account", 50_000, [
      { symbol: "RELIANCE", segment: "CASH", qty: 80, buy: 1244, sell: 1294 }, // 4,000
      { symbol: "INFY", segment: "CASH", qty: 40, buy: 1480, sell: 1555 }, // 3,000
      { symbol: "TATASTEEL", segment: "CASH", qty: 200, buy: 149, sell: 169 }, // 4,000
    ]), // total = 11,000
  ];
}
