import "server-only";
import type {
  Account,
  Holding,
  Order,
  OptionChain,
  Position,
  Trade,
} from "../types";

/**
 * The broker adapter.
 *
 * Every account-dependent screen reads from here. Until an order gateway is
 * configured there is nothing to read, so each call returns empty and
 * `isConnected()` is false — the screens render their empty state rather than
 * inventing numbers.
 *
 * Phase 2 fills these in against Groww. The signatures do not change, so the
 * screens do not change either.
 *
 * Why a gateway URL and not Groww directly: SEBI requires order placement
 * from an IP registered with the broker, and a serverless deploy has no fixed
 * egress IP. The gateway runs on the registered host; this app talks to it.
 */

const GATEWAY = process.env.BROKER_API_URL?.trim() || "";

export function isConnected(): boolean {
  return GATEWAY.length > 0;
}

/** Identity is ours; balances belong to the broker and stay null until connected. */
export async function getAccount(): Promise<Account> {
  return {
    name: process.env.ACCOUNT_NAME ?? "Rahul Shah",
    email: process.env.AUTH_EMAIL ?? "rahulzshah@gmail.com",
    broker: "Groww",
    balance: null,
    usedMargin: null,
  };
}

export async function getHoldings(): Promise<Holding[]> {
  return [];
}

export async function getPositions(): Promise<Position[]> {
  return [];
}

export async function getOrders(): Promise<Order[]> {
  return [];
}

export async function getTrades(): Promise<Trade[]> {
  return [];
}

/**
 * NSE option chains are not available from the free price feed, so this stays
 * empty until the broker provides one. Modelling strikes locally would put
 * numbers on screen that no exchange ever printed.
 */
export async function getOptionChain(): Promise<OptionChain | null> {
  return null;
}
