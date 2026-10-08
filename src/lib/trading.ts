import "server-only";
import { OWNER_ID } from "./auth";
import { getUserBrokerMeta, ipsInUse } from "./users";
import { egressFor, houseIp, sendableIps } from "./api/egress";

/**
 * Who may place an order, and why not.
 *
 * Exchange rules tie one registered static IP to one Groww account, and this
 * server sends every order from exactly one address (GROWW_REGISTERED_IP). So
 * a member can trade precisely when the IP registered on THEIR Groww key is
 * the address our orders actually leave from — otherwise Groww would refuse
 * the order at the gate, and refusing it here is both honest and faster.
 *
 * The owner's house account keeps the full desk, unchanged.
 */

export type TradeDenial =
  | "not-signed-in"
  | "no-broker"
  | "no-ip"
  | "ip-mismatch"
  | "no-server-ip";

export interface TradePermission {
  allowed: boolean;
  reason?: TradeDenial;
  /** The address this server sends orders from, when configured. */
  serverIp: string | null;
  /** The address the member registered on their own Groww key. */
  userIp?: string | null;
}

export const DENIAL_MESSAGE: Record<TradeDenial, string> = {
  "not-signed-in": "Your session expired. Sign in again.",
  "no-broker": "Connect your Groww account before placing an order.",
  "no-ip":
    "Your Groww key has no static IP registered yet. Add our server's IP to the key on Groww, then reconnect — orders are refused by the exchange without it.",
  "ip-mismatch":
    "The static IP on your Groww key is not one this platform can send from, so Groww would refuse the order. Reconnect and pick the address we gave you, then register that one on your key.",
  "no-server-ip":
    "This server has no registered outbound IP configured, so orders cannot be sent. Please contact support.",
};

export async function tradePermission(userId: string | null): Promise<TradePermission> {
  const serverIp = houseIp();
  if (!userId) return { allowed: false, reason: "not-signed-in", serverIp };

  // The owner trades the house account, which is what the server IP is for.
  if (userId === OWNER_ID) return { allowed: true, serverIp };

  const meta = await getUserBrokerMeta(userId);
  if (!meta) return { allowed: false, reason: "no-broker", serverIp };
  if (!meta.staticIp) return { allowed: false, reason: "no-ip", serverIp, userIp: null };
  // Tradeable from any address this server can actually send from: its own, or
  // one lent by a host it can tunnel through.
  if (!egressFor(meta.staticIp)) {
    return sendableIps().length === 0
      ? { allowed: false, reason: "no-server-ip", serverIp, userIp: meta.staticIp }
      : { allowed: false, reason: "ip-mismatch", serverIp, userIp: meta.staticIp };
  }
  return { allowed: true, serverIp, userIp: meta.staticIp };
}

/** Convenience for the places that only need the yes/no. */
export async function mayTrade(userId: string | null): Promise<boolean> {
  return (await tradePermission(userId)).allowed;
}

/**
 * The address to hand THIS user, so they register it on their own Groww key.
 *
 * One address serves one account, so an address another member already
 * registered is not offered again. A user who already has one keeps it —
 * reconnecting must not silently move them to a different address and
 * invalidate the key they already registered.
 */
export async function assignableIp(userId: string): Promise<string | null> {
  const mine = (await getUserBrokerMeta(userId))?.staticIp ?? null;
  if (mine && egressFor(mine)) return mine;
  const taken = new Set(await ipsInUse(userId));
  return sendableIps().find((ip) => !taken.has(ip)) ?? null;
}

/** True when this user may register that address: we can send from it, and
 *  nobody else has claimed it. */
export async function mayClaimIp(userId: string, ip: string): Promise<boolean> {
  if (!egressFor(ip)) return false;
  const taken = new Set(await ipsInUse(userId));
  return !taken.has(ip);
}
