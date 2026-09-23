import "server-only";
import * as groww from "./groww";
import { CHAIN_UNDERLYINGS, getExpiries, getStrikesAround } from "../instruments";
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

/* ------------------------------------------------------------------ writes */

/**
 * Order placement is a separate switch from reading. Set TRADING_ENABLED=false
 * to make the terminal read-only without pulling the credentials — useful when
 * you want the screens live but nobody placing anything.
 */
export function canTrade(): boolean {
  return groww.hasCredentials() && process.env.TRADING_ENABLED !== "false";
}

export interface PlacedOrder {
  ok: boolean;
  orderId: string | null;
  /** Status read BACK from the broker, not the one the write echoed. */
  status: string | null;
  filled: number | null;
  message: string | null;
  referenceId: string | null;
}

/**
 * Place an order, then read it back.
 *
 * The write's own reply is not taken as proof: a submission can be accepted
 * and then rejected at the exchange moments later, so the status shown comes
 * from a fresh read of the order. If that read fails the order id is still
 * returned — an order that exists but cannot be described is very different
 * from one that was never placed, and the UI says so.
 */
export async function placeOrder(input: groww.PlaceOrderInput): Promise<PlacedOrder> {
  if (!canTrade()) {
    return {
      ok: false,
      orderId: null,
      status: null,
      filled: null,
      message: "Order placement is disabled on this server.",
      referenceId: null,
    };
  }

  let res: groww.PlaceOrderResult;
  try {
    res = await groww.placeOrder(input);
  } catch (err) {
    console.error("[broker] placeOrder failed:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      orderId: null,
      status: null,
      filled: null,
      message:
        "The order request did not complete. Check the order book in Groww before retrying — it may still have reached the exchange.",
      referenceId: null,
    };
  }

  if (!res.ok || !res.orderId) {
    return {
      ok: false,
      orderId: res.orderId,
      status: res.status,
      filled: null,
      message: res.message ?? "Groww rejected the order.",
      referenceId: res.referenceId,
    };
  }

  const segment = input.segment ?? "CASH";
  const readBack = await safe("order-status", () => groww.getOrderStatus(res.orderId as string, segment), null);

  return {
    ok: true,
    orderId: res.orderId,
    status: readBack?.status ?? res.status,
    filled: readBack?.filled ?? null,
    message: readBack?.remark ?? res.message,
    referenceId: res.referenceId,
  };
}

export async function cancelOrder(
  orderId: string,
  segment: "CASH" | "FNO" = "CASH",
): Promise<{ ok: boolean; message: string | null }> {
  if (!canTrade()) return { ok: false, message: "Order placement is disabled on this server." };
  try {
    return await groww.cancelOrder(orderId, segment);
  } catch (err) {
    console.error("[broker] cancelOrder failed:", err instanceof Error ? err.message : err);
    return { ok: false, message: "The cancel request did not complete. Check Groww." };
  }
}

/**
 * A real option chain, assembled the only way Groww's API allows: the strike
 * grid and lot size come from the instrument master, the per-leg numbers from
 * live FNO quotes. OI change is today's open interest against the previous
 * session's, from the same payload.
 */
export async function getOptionChain(
  underlying = "NIFTY",
  expiry?: string,
): Promise<OptionChain | null> {
  if (!groww.hasCredentials()) return null;

  const u = (CHAIN_UNDERLYINGS as readonly string[]).includes(underlying) ? underlying : "NIFTY";

  try {
    const expiries = await getExpiries(u);
    if (expiries.length === 0) return null;
    const e = expiry && expiries.includes(expiry) ? expiry : expiries[0];

    // The ATM anchor: the underlying's live level.
    const ticks = await groww.getTicks([u]);
    const spot = ticks[u]?.last;
    if (!spot) return null;

    const { strikes, lotSize } = await getStrikesAround(u, e, spot, 10);
    if (strikes.length === 0) return null;

    const symbols = strikes
      .flatMap((s) => [s.CE?.tradingSymbol, s.PE?.tradingSymbol])
      .filter((t): t is string => Boolean(t));
    const quotes = await groww.getFnoQuotes(symbols);

    const leg = (t?: string) => {
      if (!t) return null;
      const q = quotes[t];
      if (!q) return { tradingSymbol: t, ltp: null, changePct: null, oi: null, oiChgPct: null, volume: null };
      const oiChgPct =
        q.oi !== null && q.prevOi !== null && q.prevOi > 0
          ? +(((q.oi - q.prevOi) / q.prevOi) * 100).toFixed(1)
          : null;
      return {
        tradingSymbol: t,
        ltp: q.ltp,
        changePct: q.changePct,
        oi: q.oi,
        oiChgPct,
        volume: q.volume,
      };
    };

    return {
      underlying: u,
      underlyings: [...CHAIN_UNDERLYINGS],
      spot,
      expiry: e,
      expiries: expiries.slice(0, 8),
      lotSize,
      rows: strikes.map((s) => ({
        strike: s.strike,
        ce: leg(s.CE?.tradingSymbol),
        pe: leg(s.PE?.tradingSymbol),
      })),
    };
  } catch (err) {
    console.error("[broker] option chain failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
