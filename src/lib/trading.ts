import "server-only";
import { OWNER_ID } from "./auth";
import { getUserBrokerMeta, ipsInUse, lastStaticIp } from "./users";
import { egressFor, houseIp, sendableIps } from "./api/egress";

/**
 * Who may place an order, and why not.
 *
 * Exchange rules tie one registered static IP to one client, and each account's
 * Groww calls leave from the address registered on ITS key (see api/egress): the
 * house account's from GROWW_REGISTERED_IP, a member's from the pool address they
 * were handed. So a member can trade precisely when the IP on their Groww key is
 * one this server can send from — otherwise Groww would refuse the order at the
 * gate, and refusing it here is both honest and faster.
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
    "Your Groww connection has no order address yet. Re-connect Groww from Settings: you will be shown the address to register on your Groww key — orders are refused by the exchange without it.",
  "ip-mismatch":
    "The order address on record for your Groww key is not one this platform can send from now, so Groww would refuse the order. Re-connect Groww from Settings to get an address to register on your key (if none is free, the page says so).",
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
  if (!(await egressFor(meta.staticIp))) {
    return (await sendableIps()).length === 0
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
 * One address serves one client, so an address another member already
 * registered is not offered again — and the house account's own address
 * (GROWW_REGISTERED_IP, registered on the owner's Groww key) is not given to a
 * new member. A user who already has one keeps it — reconnecting must not
 * silently move them to a different address and invalidate the key they already
 * registered.
 *
 * A member who was handed the house address before that rule and has
 * disconnected since gets a free pool address when there is one (that is how
 * the admin moves them off it), and otherwise their old address back, so they
 * are never left unable to connect.
 */
export async function assignableIp(userId: string): Promise<string | null> {
  const mine = (await getUserBrokerMeta(userId))?.staticIp ?? null;
  if (mine && (await egressFor(mine))) return mine;
  const taken = new Set(await ipsInUse(userId));
  const house = houseIp();
  const free = (await sendableIps()).find((ip) => ip !== house && !taken.has(ip));
  if (free) return free;
  if (house && !taken.has(house) && (await lastStaticIp(userId)) === house && (await egressFor(house))) return house;
  return null;
}

/** True when this user may register that address: we can send from it, no other
 *  member has claimed it, and — for the house account's own address — it is the
 *  one this user is handed above (a member who already held it). */
export async function mayClaimIp(userId: string, ip: string): Promise<boolean> {
  if (!(await egressFor(ip))) return false;
  const taken = new Set(await ipsInUse(userId));
  if (taken.has(ip)) return false;
  if (ip === houseIp()) return (await assignableIp(userId)) === ip;
  return true;
}
