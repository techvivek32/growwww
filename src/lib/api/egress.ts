import "server-only";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";

/**
 * Which address a broker call leaves from.
 *
 * An exchange ties ONE registered static IP to ONE trading account, so a
 * second client cannot reuse this server's address — their orders would be
 * refused at the gate. The way out is to send each account's traffic from the
 * address registered on *their* key:
 *
 *  - "local" — bind the socket to an address this host owns;
 *  - "proxy" — tunnel through a host that owns the address (CONNECT, HTTPS
 *    only, reachable from this server alone).
 *
 * Configured with GROWW_EGRESS_MAP, a JSON object keyed by the public address
 * the client registered on their Groww key:
 *
 *   {"69.62.66.123": {"proxy": "http://69.62.66.123:8888"},
 *    "72.60.30.154": {"local": true}}
 *
 * GROWW_REGISTERED_IP stays the default for the house account and is always
 * treated as a local address, so existing behaviour is unchanged.
 */

export type Egress =
  | { kind: "local"; ip: string }
  | { kind: "proxy"; url: string; ip: string };

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

type MapEntry = { proxy?: string; local?: boolean };

function parseMap(): Record<string, MapEntry> {
  const raw = env("GROWW_EGRESS_MAP");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, MapEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    console.error("[egress] GROWW_EGRESS_MAP is not valid JSON — ignoring it");
    return {};
  }
}

/** The address the house account (and any unmapped call) goes out from. */
export function houseIp(): string | null {
  return env("GROWW_REGISTERED_IP") ?? null;
}

/** How to send from `ip`, or null if this server cannot send from it at all. */
export function egressFor(ip: string | null | undefined): Egress | null {
  if (!ip) return null;
  const house = houseIp();
  if (house && ip === house) return { kind: "local", ip };
  const entry = parseMap()[ip];
  if (!entry) return null;
  if (entry.proxy) return { kind: "proxy", url: entry.proxy, ip };
  if (entry.local) return { kind: "local", ip };
  return null;
}

/** Every address a client may register on their key and still be able to trade. */
export function sendableIps(): string[] {
  const house = houseIp();
  const mapped = Object.keys(parseMap()).filter((ip) => egressFor(ip) !== null);
  return house ? [house, ...mapped.filter((ip) => ip !== house)] : mapped;
}

/* ------------------------------------------------------------------ agents */

// One agent per egress, kept alive. Building one per request would hand the
// broker a fresh TCP + TLS handshake on every call.
const agents = new Map<string, https.Agent>();

const BASE = { family: 4 as const, autoSelectFamily: false, keepAlive: true, maxSockets: 8 };

/** The default agent: house address when configured, otherwise the OS default. */
export const defaultAgent = new https.Agent({
  ...BASE,
  ...(houseIp() ? { localAddress: houseIp() as string } : {}),
});

export function agentFor(egress: Egress | undefined | null): https.Agent {
  if (!egress) return defaultAgent;
  const key = egress.kind === "local" ? `local:${egress.ip}` : `proxy:${egress.url}`;
  const cached = agents.get(key);
  if (cached) return cached;

  const agent =
    egress.kind === "local"
      ? new https.Agent({ ...BASE, localAddress: egress.ip })
      : (new HttpsProxyAgent(egress.url, BASE) as unknown as https.Agent);

  agents.set(key, agent);
  return agent;
}
