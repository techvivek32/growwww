/**
 * The broker contract.
 *
 * These are the shapes `src/lib/api/broker.ts` returns, and the shapes the
 * Groww adapter has to fill in Phase 2. Nothing in here carries data — it is
 * the interface the screens are written against, so the screens do not change
 * when a real account is connected.
 */

export type Side = "BUY" | "SELL";
export type Product = "CNC" | "MIS" | "NRML";
export type OrderType = "MARKET" | "LIMIT" | "SL" | "SL_M";
export type OrderStatus =
  | "COMPLETE"
  | "OPEN"
  | "REJECTED"
  | "CANCELLED"
  | "TRIGGER PENDING";

export interface Account {
  name: string;
  email: string;
  broker: string;
  /** Available cash. null when no account is connected. */
  balance: number | null;
  /** Margin currently blocked. null when unknown. */
  usedMargin: number | null;
  /** Exchange client code, straight from the broker. null until connected. */
  ucc: string | null;
  /** Segments the account can trade, e.g. ["CASH", "FNO"]. */
  segments: string[];
}

export interface Holding {
  symbol: string;
  company: string;
  qty: number;
  avg: number;
  /** Live price; null when the feed did not return one — never the avg cost. */
  ltp: number | null;
  /** Today's move in percent; null when unknown. */
  dayPct: number | null;
}

export interface Position {
  symbol: string;
  product: Product;
  side: Side;
  qty: number;
  avg: number;
  /** Live price; null when the feed did not return one — never the avg cost. */
  ltp: number | null;
  /** Booked P&L on the closed part of the position. */
  realised: number;
}

export interface Order {
  id: string;
  /** Session date of the fill, ISO (YYYY-MM-DD); null when unparseable. */
  date: string | null;
  time: string;
  symbol: string;
  side: Side;
  type: OrderType;
  product: Product;
  qty: number;
  filled: number;
  price: number | null;
  avg: number | null;
  status: OrderStatus;
  note?: string;
}

export interface Trade {
  id: string;
  date: string;
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
  /**
   * Per-trade charges. Groww's order payload does not carry them, so this is
   * null and the UI says so — an account-level figure is not a substitute.
   */
  charges: number | null;
}

/** One leg of a strike, with everything needed to display and to order it. */
export interface ChainLeg {
  tradingSymbol: string;
  exchange: "NSE" | "BSE";
  ltp: number | null;
  /** Day change percent, from the exchange. */
  changePct: number | null;
  oi: number | null;
  /** OI change vs the previous session, percent. */
  oiChgPct: number | null;
  volume: number | null;
}

export interface ChainRow {
  strike: number;
  ce: ChainLeg | null;
  pe: ChainLeg | null;
}

export interface OptionChain {
  underlying: string;
  underlyings: string[];
  spot: number;
  expiry: string;
  expiries: string[];
  lotSize: number;
  rows: ChainRow[];
}
