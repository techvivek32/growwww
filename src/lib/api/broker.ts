import "server-only";
import * as groww from "./groww";
import type { Account, Holding, Order, OptionChain, Position, Trade } from "../types";

/**
 * The broker adapter every account-dependent screen reads from.
 *
 * With Groww credentials present it talks to the live account. Without them
 * it returns empty and `isConnected()` is false, so those screens show their
 * empty state rather than inventing numbers.
 *
 * Read failures are swallowed into empty results on purpose: a broker blip
 * should leave the terminal usable and visibly empty, not throw a 500 over
 * the whole page. Failures are logged for the journal.
 */

export function isConnected(): boolean {
  return groww.hasCredentials();
}

async function safe<T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> {
  if (!groww.hasCredentials()) return fallback;
  try {
    return await run();
  } catch (err) {
    console.error(`[broker] ${what} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

/* -------------------------------------------------------------- connection */

export interface ConnectionStatus {
  /** API key + TOTP secret are configured. */
  credentials: boolean;
  /** A live authenticated call actually succeeded just now. */
  live: boolean;
  /** Outbound calls are pinned to the registered source address. */
  ipPinned: boolean;
}

/**
 * What can honestly be called "connected": not the presence of env vars, but
 * a real authenticated round-trip. The margin call doubles as that probe.
 */
export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const credentials = groww.hasCredentials();
  const live = credentials
    ? (await safe("margin-probe", () => groww.getMargin(), null)) !== null
    : false;
  return {
    credentials,
    live,
    ipPinned: Boolean(process.env.GROWW_REGISTERED_IP?.trim()),
  };
}

/* ----------------------------------------------------------------- account */

export async function getAccount(): Promise<Account> {
  const base: Account = {
    // The API carries no display name, so it comes from config; everything
    // else on the account is read from Groww.
    name: process.env.ACCOUNT_NAME ?? "Groww account",
    email: process.env.AUTH_EMAIL ?? "",
    broker: "Groww",
    balance: null,
    usedMargin: null,
    ucc: null,
    segments: [],
  };

  const [margin, detail] = await Promise.all([
    safe("margin", () => groww.getMargin(), null),
    safe("user-detail", () => groww.getUserDetail(), null),
  ]);

  return {
    ...base,
    balance: margin ? margin.clearCash : null,
    usedMargin: margin ? margin.marginUsed : null,
    ucc: detail?.ucc ?? null,
    segments: detail?.segments ?? [],
  };
}

export async function getHoldings(): Promise<Holding[]> {
  return safe("holdings", () => groww.getHoldings(), []);
}

export async function getPositions(): Promise<Position[]> {
  return safe("positions", () => groww.getPositions(), []);
}

export async function getOrders(): Promise<Order[]> {
  return safe("orders", () => groww.getOrders(), []);
}

/* ------------------------------------------------------------------- fills */

/** Orders that actually executed — the raw material of history. */
export async function getFills(): Promise<Order[]> {
  const orders = await getOrders();
  return orders.filter((o) => o.status === "COMPLETE" && o.avg !== null && o.filled > 0);
}

/* ------------------------------------------------------------ round trips */

/**
 * FIFO leg-matching over real fills: a fill on one side opens lots, a fill on
 * the other side closes the oldest open lots first. Only fully matched pairs
 * become round-trips — an open position is not a trade with a result yet.
 *
 * Charges stay null throughout: Groww's order payload carries no brokerage,
 * STT or stamp fields, and the account-level charges figure is not a
 * per-trade number. The screens label P&L "before charges" accordingly.
 */
export async function getTrades(): Promise<Trade[]> {
  const fills = await getFills();

  // Oldest first, so FIFO means what it says.
  const ordered = [...fills].sort((a, b) =>
    `${a.date ?? ""}T${a.time}`.localeCompare(`${b.date ?? ""}T${b.time}`),
  );

  interface Lot {
    qty: number;
    price: number;
    time: string;
    date: string | null;
  }
  const open = new Map<string, { side: "BUY" | "SELL"; lots: Lot[] }>();
  const trades: Trade[] = [];
  let seq = 0;

  for (const f of ordered) {
    const price = f.avg as number;
    let qty = f.filled;
    const book = open.get(f.symbol);

    if (book && book.side !== f.side) {
      // This fill closes open lots, oldest first.
      while (qty > 0 && book.lots.length > 0) {
        const lot = book.lots[0];
        const matched = Math.min(qty, lot.qty);
        const long = book.side === "BUY";
        trades.push({
          id: `RT-${++seq}`,
          date: lot.date ?? f.date ?? "",
          day: lot.date ?? "—",
          symbol: f.symbol,
          company: f.symbol,
          side: book.side,
          product: f.product,
          qty: matched,
          entry: long ? lot.price : price,
          exit: long ? price : lot.price,
          entryTime: lot.time,
          exitTime: f.time,
          charges: null,
        });
        lot.qty -= matched;
        qty -= matched;
        if (lot.qty === 0) book.lots.shift();
      }
      if (book.lots.length === 0) open.delete(f.symbol);
    }

    if (qty > 0) {
      // Remainder (or a fresh fill) opens lots on this side.
      const entry = open.get(f.symbol) ?? { side: f.side, lots: [] };
      entry.side = f.side;
      entry.lots.push({ qty, price, time: f.time, date: f.date });
      open.set(f.symbol, entry);
    }
  }

  return trades;
}

/**
 * NSE option chains are not in the free price feed, and Groww's REST surface
 * exposes quotes per instrument rather than a whole chain. Nothing builds one
 * yet, so this is null for everyone — including a fully connected account.
 */
export async function getOptionChain(): Promise<OptionChain | null> {
  return null;
}
