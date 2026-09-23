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

/**
 * Groww exposes no trade-list endpoint, so history is derived from orders
 * that actually filled. Entry and exit are not paired into round-trips here —
 * that needs both legs, and the screens treat each fill on its own terms.
 */
export async function getTrades(): Promise<Trade[]> {
  const orders = await getOrders();

  return orders
    .filter((o) => o.status === "COMPLETE" && o.avg !== null && o.filled > 0)
    .map((o) => ({
      id: o.id,
      date: new Date().toISOString().slice(0, 10),
      day: o.time,
      symbol: o.symbol,
      company: o.symbol,
      side: o.side,
      product: o.product,
      qty: o.filled,
      entry: o.avg as number,
      exit: o.avg as number,
      entryTime: o.time,
      exitTime: o.time,
      charges: 0,
    }));
}

/**
 * NSE option chains are not in the free price feed and Groww's REST surface
 * exposes quotes per instrument rather than a whole chain, so this stays null
 * until a chain builder exists. Modelling strikes locally would put numbers on
 * screen that no exchange ever printed.
 */
export async function getOptionChain(): Promise<OptionChain | null> {
  return null;
}
