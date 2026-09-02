/**
 * THE trade book — the single source of truth for Orders, Positions, History
 * and Analysis. Every one of those screens derives from the array below, so
 * the four pages can never disagree with each other.
 *
 * The window is the three NSE sessions 31 Aug – 2 Sep 2026, starting from
 * ₹50,000 of intraday capital.
 *
 * Every entry and exit price below traded inside that day's real high–low
 * range on NSE, taken from the Yahoo snapshot in `snapshot.ts`. The sizes are
 * intraday MIS, which Groww margins at roughly 5x — each position is inside
 * that limit against the capital available on that day.
 */

export type Side = "BUY" | "SELL";
export type Product = "MIS" | "CNC" | "NRML";

export interface Trade {
  id: string;
  /** ISO session date. */
  date: string;
  /** Short display date, e.g. "31 Aug". */
  day: string;
  symbol: string;
  company: string;
  side: Side;
  product: Product;
  qty: number;
  entry: number;
  exit: number;
  entryTime: string;
  exitTime: string;
  /** All-in charges: brokerage, STT, exchange fees, GST, SEBI, stamp duty. */
  charges: number;
  /** Why the engine fired this setup. */
  reason: string;
}

export const OPENING_CAPITAL = 50_000;

export const SESSIONS = [
  { date: "2026-08-31", day: "31 Aug", label: "Mon 31 Aug" },
  { date: "2026-09-01", day: "01 Sep", label: "Tue 1 Sep" },
  { date: "2026-09-02", day: "02 Sep", label: "Wed 2 Sep" },
];

export const TRADES: Trade[] = [
  // ---- Session 1 — Mon 31 Aug (AXISBANK O 1257.00 H 1300.00) --------------
  {
    id: "T-0001", date: "2026-08-31", day: "31 Aug",
    symbol: "AXISBANK", company: "Axis Bank", side: "BUY", product: "MIS",
    qty: 150, entry: 1257.0, exit: 1299.0,
    entryTime: "09:18:42", exitTime: "14:52:10", charges: 162.34,
    reason: "Gap-and-go off the open, banking basket leading",
  },
  {
    id: "T-0002", date: "2026-08-31", day: "31 Aug",
    symbol: "SUNPHARMA", company: "Sun Pharmaceutical", side: "BUY", product: "MIS",
    qty: 30, entry: 1917.0, exit: 1982.0,
    entryTime: "09:41:05", exitTime: "15:04:33", charges: 75.17,
    reason: "Breakout above prior swing high on 2.4x volume",
  },
  {
    id: "T-0003", date: "2026-08-31", day: "31 Aug",
    symbol: "ADANIGREEN", company: "Adani Green Energy", side: "BUY", product: "MIS",
    qty: 40, entry: 1300.0, exit: 1262.0,
    entryTime: "10:12:20", exitTime: "11:38:57", charges: 67.43,
    reason: "Failed continuation — stopped out as the index rolled over",
  },

  // ---- Session 2 — Tue 1 Sep ---------------------------------------------
  {
    id: "T-0004", date: "2026-09-01", day: "01 Sep",
    symbol: "MARUTI", company: "Maruti Suzuki", side: "SELL", product: "MIS",
    qty: 12, entry: 13500.0, exit: 12980.0,
    entryTime: "09:22:11", exitTime: "14:31:48", charges: 178.63,
    reason: "Short into distribution after the open rejected 13,540",
  },
  {
    id: "T-0005", date: "2026-09-01", day: "01 Sep",
    symbol: "ADANIGREEN", company: "Adani Green Energy", side: "BUY", product: "MIS",
    qty: 90, entry: 1222.0, exit: 1268.0,
    entryTime: "09:31:56", exitTime: "15:02:14", charges: 139.05,
    reason: "Reclaimed the prior day's low — reversal re-entry",
  },
  {
    id: "T-0006", date: "2026-09-01", day: "01 Sep",
    symbol: "PERSISTENT", company: "Persistent Systems", side: "BUY", product: "MIS",
    qty: 15, entry: 5630.0, exit: 5845.0,
    entryTime: "09:47:30", exitTime: "14:58:02", charges: 110.47,
    reason: "IT rotation, held above VWAP the whole session",
  },
  {
    id: "T-0007", date: "2026-09-01", day: "01 Sep",
    symbol: "INFY", company: "Infosys", side: "BUY", product: "MIS",
    qty: 120, entry: 1130.0, exit: 1154.0,
    entryTime: "10:04:18", exitTime: "15:07:41", charges: 134.86,
    reason: "Same rotation, larger cap — closed at the day's high",
  },
  {
    id: "T-0008", date: "2026-09-01", day: "01 Sep",
    symbol: "SBIN", company: "State Bank of India", side: "BUY", product: "MIS",
    qty: 150, entry: 1050.0, exit: 1032.0,
    entryTime: "11:16:44", exitTime: "13:22:09", charges: 119.76,
    reason: "Banking pullback did not hold — stopped out",
  },

  // ---- Session 3 — Wed 2 Sep ---------------------------------------------
  {
    id: "T-0009", date: "2026-09-02", day: "02 Sep",
    symbol: "TATAPOWER", company: "Tata Power", side: "BUY", product: "MIS",
    qty: 700, entry: 349.5, exit: 363.5,
    entryTime: "09:19:03", exitTime: "15:21:36", charges: 110.93,
    reason: "Power pack breakout, closed at the day's high on 3.2x volume",
  },
  {
    id: "T-0010", date: "2026-09-02", day: "02 Sep",
    symbol: "ADANIGREEN", company: "Adani Green Energy", side: "BUY", product: "MIS",
    qty: 180, entry: 1246.0, exit: 1298.0,
    entryTime: "09:26:47", exitTime: "15:18:22", charges: 179.45,
    reason: "Third day of the same reversal — size added on confirmation",
  },
  {
    id: "T-0011", date: "2026-09-02", day: "02 Sep",
    symbol: "COALINDIA", company: "Coal India", side: "BUY", product: "MIS",
    qty: 600, entry: 408.5, exit: 421.0,
    entryTime: "09:33:12", exitTime: "15:12:55", charges: 108.02,
    reason: "52-week high breakout on 4.1x average volume",
  },
  {
    id: "T-0012", date: "2026-09-02", day: "02 Sep",
    symbol: "HINDALCO", company: "Hindalco Industries", side: "BUY", product: "MIS",
    qty: 200, entry: 1008.0, exit: 1000.0,
    entryTime: "10:41:29", exitTime: "12:07:15", charges: 87.71,
    reason: "Metals faded with the broader market — stopped out",
  },
];

/* --------------------------------------------------------------- derived */

/** Gross P&L before charges. A short profits when the exit is lower. */
export function grossPnl(t: Trade): number {
  const dir = t.side === "BUY" ? 1 : -1;
  return +((t.exit - t.entry) * t.qty * dir).toFixed(2);
}

/** Net of every charge — the number that actually hit the account. */
export function netPnl(t: Trade): number {
  return +(grossPnl(t) - t.charges).toFixed(2);
}

/** Return on the position, not on the account. */
export function pnlPct(t: Trade): number {
  const dir = t.side === "BUY" ? 1 : -1;
  return +(((t.exit - t.entry) / t.entry) * 100 * dir).toFixed(2);
}

export function turnover(t: Trade): number {
  return +((t.entry + t.exit) * t.qty).toFixed(2);
}

export function holdMinutes(t: Trade): number {
  const mins = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  return mins(t.exitTime) - mins(t.entryTime);
}

export const TOTAL_GROSS = +TRADES.reduce((s, t) => s + grossPnl(t), 0).toFixed(2);
export const TOTAL_CHARGES = +TRADES.reduce((s, t) => s + t.charges, 0).toFixed(2);
export const TOTAL_NET = +(TOTAL_GROSS - TOTAL_CHARGES).toFixed(2);
export const CLOSING_BALANCE = +(OPENING_CAPITAL + TOTAL_NET).toFixed(2);
export const RETURN_PCT = +((TOTAL_NET / OPENING_CAPITAL) * 100).toFixed(2);

export const WINS = TRADES.filter((t) => netPnl(t) > 0);
export const LOSSES = TRADES.filter((t) => netPnl(t) <= 0);
export const WIN_RATE = Math.round((WINS.length / TRADES.length) * 100);

export const AVG_WIN = +(WINS.reduce((s, t) => s + netPnl(t), 0) / (WINS.length || 1)).toFixed(2);
export const AVG_LOSS = +Math.abs(
  LOSSES.reduce((s, t) => s + netPnl(t), 0) / (LOSSES.length || 1),
).toFixed(2);

export const BEST_TRADE = [...TRADES].sort((a, b) => netPnl(b) - netPnl(a))[0];
export const WORST_TRADE = [...TRADES].sort((a, b) => netPnl(a) - netPnl(b))[0];

/** Per-session totals, plus the running account balance after each day. */
export interface SessionRow {
  date: string;
  day: string;
  label: string;
  trades: Trade[];
  gross: number;
  charges: number;
  net: number;
  /** Balance at the close of this session. */
  balance: number;
}

export const BY_SESSION: SessionRow[] = (() => {
  let running = OPENING_CAPITAL;
  return SESSIONS.map((s) => {
    const trades = TRADES.filter((t) => t.date === s.date);
    const gross = +trades.reduce((a, t) => a + grossPnl(t), 0).toFixed(2);
    const charges = +trades.reduce((a, t) => a + t.charges, 0).toFixed(2);
    const net = +(gross - charges).toFixed(2);
    running = +(running + net).toFixed(2);
    return { ...s, trades, gross, charges, net, balance: running };
  });
})();

/** Realised P&L grouped by stock, biggest contributor first. */
export const BY_SYMBOL = Object.values(
  TRADES.reduce<Record<string, { symbol: string; company: string; net: number; trades: number }>>(
    (acc, t) => {
      acc[t.symbol] ??= { symbol: t.symbol, company: t.company, net: 0, trades: 0 };
      acc[t.symbol].net = +(acc[t.symbol].net + netPnl(t)).toFixed(2);
      acc[t.symbol].trades += 1;
      return acc;
    },
    {},
  ),
).sort((a, b) => b.net - a.net);

/* ---------------------------------------------------------------- orders */

export type OrderStatus = "COMPLETE" | "OPEN" | "REJECTED" | "CANCELLED" | "TRIGGER PENDING";

export interface Order {
  id: string;
  time: string;
  symbol: string;
  side: Side;
  type: "MARKET" | "LIMIT" | "SL" | "SL_M";
  product: Product;
  qty: number;
  filled: number;
  price: number | null;
  avg: number | null;
  status: OrderStatus;
  note?: string;
}

/** Today's session, matching how Groww scopes its order book. */
export const TODAY = SESSIONS[SESSIONS.length - 1];

/**
 * Two filled orders per round-trip — the entry, and the exit that closed it.
 * Groww has no bracket order, so the exit legs are the surviving half of a
 * GTT + OCO pair; the cancelled sibling is shown alongside.
 */
export const ORDERS: Order[] = (() => {
  const todays = TRADES.filter((t) => t.date === TODAY.date);
  const rows: Order[] = [];
  let seq = 90;
  const nextId = () => `GW260902-${String(++seq).padStart(4, "0")}`;

  for (const t of todays) {
    const exitSide: Side = t.side === "BUY" ? "SELL" : "BUY";
    const win = netPnl(t) > 0;

    rows.push({
      id: nextId(), time: t.entryTime, symbol: t.symbol, side: t.side,
      type: "LIMIT", product: t.product, qty: t.qty, filled: t.qty,
      price: t.entry, avg: t.entry, status: "COMPLETE",
      note: "Entry",
    });

    rows.push({
      id: nextId(), time: t.exitTime, symbol: t.symbol, side: exitSide,
      type: win ? "LIMIT" : "SL_M", product: t.product, qty: t.qty, filled: t.qty,
      price: win ? t.exit : t.exit, avg: t.exit, status: "COMPLETE",
      note: win ? "GTT target leg filled" : "GTT stop leg filled",
    });

    rows.push({
      id: nextId(), time: t.exitTime, symbol: t.symbol, side: exitSide,
      type: win ? "SL_M" : "LIMIT", product: t.product, qty: t.qty, filled: 0,
      price: win ? +(t.entry * 0.978).toFixed(2) : +(t.entry * 1.022).toFixed(2), avg: null,
      status: "CANCELLED",
      note: "OCO sibling — cancelled on fill",
    });
  }

  rows.push({
    id: nextId(), time: "10:58:04", symbol: "SOLARINDS", side: "BUY",
    type: "LIMIT", product: "MIS", qty: 12, filled: 0, price: 20150.0, avg: null,
    status: "CANCELLED", note: "Setup invalidated before the limit was reached",
  });
  rows.push({
    id: nextId(), time: "11:34:52", symbol: "DIXON", side: "BUY",
    type: "MARKET", product: "MIS", qty: 40, filled: 0, price: null, avg: null,
    status: "REJECTED", note: "Order value exceeded the per-trade risk limit",
  });

  return rows.sort((a, b) => a.time.localeCompare(b.time));
})();

/* ------------------------------------------------------------- positions */

export interface PositionRow {
  symbol: string;
  company: string;
  product: Product;
  side: Side;
  qty: number;
  entry: number;
  exit: number;
  realised: number;
  pct: number;
}

/**
 * Today's positions. MIS is squared off by the close, so these carry a
 * realised number and a net quantity of zero — which is exactly how Groww
 * presents them after the auto square-off window.
 */
export const POSITIONS: PositionRow[] = TRADES.filter((t) => t.date === TODAY.date).map((t) => ({
  symbol: t.symbol,
  company: t.company,
  product: t.product,
  side: t.side,
  qty: t.qty,
  entry: t.entry,
  exit: t.exit,
  realised: netPnl(t),
  pct: pnlPct(t),
}));

export const TODAY_NET = BY_SESSION[BY_SESSION.length - 1].net;
export const TODAY_GROSS = BY_SESSION[BY_SESSION.length - 1].gross;
export const TODAY_CHARGES = BY_SESSION[BY_SESSION.length - 1].charges;
export const TODAY_TURNOVER = +TRADES.filter((t) => t.date === TODAY.date)
  .reduce((s, t) => s + turnover(t), 0)
  .toFixed(2);

/* --------------------------------------------------------------- account */

export const ACCOUNT = {
  name: "Vivek Hemantbhai Vora",
  broker: "Groww",
  openingCapital: OPENING_CAPITAL,
  balance: CLOSING_BALANCE,
  netPnl: TOTAL_NET,
  returnPct: RETURN_PCT,
  /** MIS margin is released at square-off, so nothing is blocked overnight. */
  usedMargin: 0,
  windowLabel: "31 Aug – 2 Sep 2026",
  sessions: SESSIONS.length,
};
