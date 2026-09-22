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
}

export interface Holding {
  symbol: string;
  company: string;
  qty: number;
  avg: number;
  ltp: number;
  dayPct: number;
}

export interface Position {
  symbol: string;
  product: Product;
  side: Side;
  qty: number;
  avg: number;
  ltp: number;
  /** Booked P&L on the closed part of the position. */
  realised: number;
}

export interface Order {
  id: string;
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
  /** All-in: brokerage, STT, exchange fees, GST, SEBI, stamp duty. */
  charges: number;
}

/** One strike's two legs, as an exchange publishes them. */
export interface ChainRow {
  strike: number;
  ceOi: number;
  ceOiChg: number;
  ceIv: number;
  ceLtp: number;
  ceChg: number;
  peOi: number;
  peOiChg: number;
  peIv: number;
  peLtp: number;
  peChg: number;
}

export interface OptionChain {
  underlying: string;
  spot: number;
  expiry: string;
  lotSize: number;
  rows: ChainRow[];
}
