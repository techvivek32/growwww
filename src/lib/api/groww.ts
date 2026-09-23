import "server-only";
import crypto from "node:crypto";
import https from "node:https";
import type { Holding, Order, OrderStatus, OrderType, Position, Product, Side } from "../types";

/**
 * Groww Trading API adapter.
 *
 * Two things this file exists to get right.
 *
 * 1. IPv4. `api.groww.in` is dual-stack and this host has a working IPv6
 *    route, but only its IPv4 address is registered with Groww. Node 20+ has
 *    Happy Eyeballs on by default, so a request can leave over IPv6 and be
 *    rejected — intermittently, which is the worst kind. Every call here goes
 *    through node:https with `family: 4` and an explicit `localAddress`, so a
 *    misconfigured host fails loudly instead of leaking out of the wrong
 *    address. Global fetch() is deliberately not used: undici silently ignores
 *    both options.
 *
 * 2. Tokens. The access token expires at 06:00 IST daily. It is minted from
 *    the API key plus a TOTP code, cached until shortly before its own `exp`,
 *    and re-minted on demand — so nothing needs a human at 6 AM.
 */

const HOST = "api.groww.in";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : undefined;
}

export function hasCredentials(): boolean {
  return Boolean(env("GROWW_API_KEY") && env("GROWW_TOTP_SECRET"));
}

/* ------------------------------------------------------------------ agent */

const agent = new https.Agent({
  family: 4,
  autoSelectFamily: false,
  keepAlive: true,
  maxSockets: 8,
  // When set, binds the source address. A wrong value throws EADDRNOTAVAIL
  // rather than quietly going out of an unregistered interface.
  ...(env("GROWW_REGISTERED_IP") ? { localAddress: env("GROWW_REGISTERED_IP") } : {}),
});

interface Reply<T> {
  status: number;
  body: T;
}

function request<T>(
  path: string,
  opts: { method?: string; token: string; json?: unknown } ,
): Promise<Reply<T>> {
  const payload = opts.json === undefined ? undefined : JSON.stringify(opts.json);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        path,
        method: opts.method ?? "GET",
        agent,
        timeout: 15_000,
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: "application/json",
          "X-API-VERSION": "1.0",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) as T });
          } catch {
            reject(new Error(`groww ${path}: ${res.statusCode} non-JSON: ${raw.slice(0, 160)}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`groww ${path}: timed out`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ------------------------------------------------------------------- TOTP */

/** RFC 6238, SHA-1, 30-second step, six digits — what authenticator apps do. */
function base32Decode(s: string): Buffer {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret: string, at: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/* ------------------------------------------------------------------ token */

let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

/** Seconds of headroom before the token's own expiry. */
const SKEW_MS = 5 * 60 * 1000;

function expiryOf(jwt: string): number {
  try {
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()) as { exp?: number };
    return claims.exp ? claims.exp * 1000 : Date.now() + 60 * 60 * 1000;
  } catch {
    return Date.now() + 60 * 60 * 1000;
  }
}

async function mint(): Promise<string> {
  const apiKey = env("GROWW_API_KEY");
  const secret = env("GROWW_TOTP_SECRET");
  if (!apiKey || !secret) throw new Error("GROWW_API_KEY and GROWW_TOTP_SECRET are required");

  const res = await request<{ status?: string; token?: string; error?: unknown }>("/v1/token/api/access", {
    method: "POST",
    token: apiKey,
    json: { key_type: "totp", totp: totp(secret) },
  });

  if (res.status !== 200 || !res.body?.token) {
    throw new Error(`groww auth failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }

  cached = { token: res.body.token, expiresAt: expiryOf(res.body.token) };
  return cached.token;
}

async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - SKEW_MS) return cached.token;
  // Collapse concurrent refreshes onto one request.
  inFlight ??= mint().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Envelope unwrap: Groww wraps everything in { status, payload }. */
async function get<T>(path: string): Promise<T | null> {
  const token = await accessToken();
  const res = await request<{ status?: string; payload?: T }>(path, { token });
  if (res.status !== 200 || res.body?.status !== "SUCCESS") return null;
  return res.body.payload ?? null;
}

/* ------------------------------------------------------------ user detail */

export interface UserDetail {
  ucc: string | null;
  nseEnabled: boolean;
  bseEnabled: boolean;
  segments: string[];
}

export async function getUserDetail(): Promise<UserDetail | null> {
  const p = await get<{
    ucc?: string;
    nse_enabled?: boolean;
    bse_enabled?: boolean;
    active_segments?: string[];
  }>("/v1/user/detail");
  if (!p) return null;
  return {
    ucc: p.ucc ?? null,
    nseEnabled: Boolean(p.nse_enabled),
    bseEnabled: Boolean(p.bse_enabled),
    segments: p.active_segments ?? [],
  };
}

/* ---------------------------------------------------------------- margins */

export interface Margin {
  clearCash: number;
  marginUsed: number;
  charges: number;
}

export async function getMargin(): Promise<Margin | null> {
  const p = await get<{
    clear_cash?: number;
    net_margin_used?: number;
    brokerage_and_charges?: number;
  }>("/v1/margins/detail/user");
  if (!p) return null;
  return {
    clearCash: p.clear_cash ?? 0,
    marginUsed: p.net_margin_used ?? 0,
    charges: p.brokerage_and_charges ?? 0,
  };
}

/* --------------------------------------------------------------- holdings */

interface GrowwHolding {
  trading_symbol?: string;
  quantity?: number;
  average_price?: number;
}

export async function getHoldings(): Promise<Holding[]> {
  const p = await get<{ holdings?: GrowwHolding[] }>("/v1/holdings/user");
  const rows = p?.holdings ?? [];

  const symbols = rows.map((h) => h.trading_symbol).filter((s): s is string => Boolean(s));
  const ltp = symbols.length ? await getLtp(symbols) : {};

  return rows
    .filter((h) => h.trading_symbol && (h.quantity ?? 0) > 0)
    .map((h) => {
      const symbol = h.trading_symbol as string;
      const avg = h.average_price ?? 0;
      // Groww's holdings payload carries no live price, so it is fetched
      // separately; the average cost is the honest fallback if that fails.
      const last = ltp[symbol] ?? avg;
      return {
        symbol,
        company: symbol,
        qty: h.quantity ?? 0,
        avg,
        ltp: last,
        dayPct: 0,
      };
    });
}

/* -------------------------------------------------------------- positions */

interface GrowwPosition {
  trading_symbol?: string;
  quantity?: number;
  net_price?: number;
  product?: string;
  realised_pnl?: number;
  credit_quantity?: number;
  debit_quantity?: number;
}

const PRODUCTS: Product[] = ["CNC", "MIS", "NRML"];
const asProduct = (v?: string): Product =>
  PRODUCTS.includes(v as Product) ? (v as Product) : "MIS";

export async function getPositions(): Promise<Position[]> {
  const p = await get<{ positions?: GrowwPosition[] }>("/v1/positions/user");
  const rows = (p?.positions ?? []).filter((r) => r.trading_symbol && (r.quantity ?? 0) !== 0);

  const symbols = rows.map((r) => r.trading_symbol as string);
  const ltp = symbols.length ? await getLtp(symbols) : {};

  return rows.map((r) => {
    const symbol = r.trading_symbol as string;
    const qty = r.quantity ?? 0;
    const avg = r.net_price ?? 0;
    return {
      symbol,
      product: asProduct(r.product),
      // A negative net quantity is a short.
      side: (qty >= 0 ? "BUY" : "SELL") as Side,
      qty: Math.abs(qty),
      avg,
      ltp: ltp[symbol] ?? avg,
      realised: r.realised_pnl ?? 0,
    };
  });
}

/* ----------------------------------------------------------------- orders */

interface GrowwOrder {
  groww_order_id?: string;
  trading_symbol?: string;
  order_status?: string;
  remark?: string;
  quantity?: number;
  price?: number;
  trigger_price?: number;
  filled_quantity?: number;
  average_fill_price?: number;
  order_type?: string;
  transaction_type?: string;
  product?: string;
  created_at?: string;
  exchange_time?: string;
}

/** Groww's vocabulary mapped onto the one the screens already speak. */
const STATUS: Record<string, OrderStatus> = {
  COMPLETED: "COMPLETE",
  COMPLETE: "COMPLETE",
  EXECUTED: "COMPLETE",
  OPEN: "OPEN",
  NEW: "OPEN",
  ACKED: "OPEN",
  PENDING: "OPEN",
  TRIGGER_PENDING: "TRIGGER PENDING",
  REJECTED: "REJECTED",
  FAILED: "REJECTED",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
};

const ORDER_TYPES: OrderType[] = ["MARKET", "LIMIT", "SL", "SL_M"];

function clockOf(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

export async function getOrders(): Promise<Order[]> {
  const p = await get<{ order_list?: GrowwOrder[] }>("/v1/order/list?page=0&page_size=100");
  return (p?.order_list ?? [])
    .filter((o) => o.trading_symbol)
    .map((o) => {
      const status = STATUS[(o.order_status ?? "").toUpperCase()] ?? "OPEN";
      const type = (ORDER_TYPES.includes((o.order_type ?? "") as OrderType)
        ? o.order_type
        : "MARKET") as OrderType;

      // SL orders carry their level in trigger_price, not price.
      const level = type === "SL" || type === "SL_M" ? o.trigger_price : o.price;

      return {
        id: o.groww_order_id ?? "—",
        time: clockOf(o.exchange_time ?? o.created_at),
        symbol: o.trading_symbol as string,
        side: (o.transaction_type === "SELL" ? "SELL" : "BUY") as Side,
        type,
        product: asProduct(o.product),
        qty: o.quantity ?? 0,
        filled: o.filled_quantity ?? 0,
        price: level ?? null,
        avg: o.average_fill_price && o.average_fill_price > 0 ? o.average_fill_price : null,
        status,
        note: o.remark || undefined,
      };
    });
}

/* -------------------------------------------------------------- live data */

/**
 * Last traded price for NSE cash symbols. Groww keys the response by
 * `NSE_<SYMBOL>`; this hands back plain symbols so callers do not have to
 * care about the wire format.
 */
export async function getLtp(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};

  // Short-lived cache: several screens render per request and each wants the
  // same batch. 15 seconds keeps the strip visibly live while staying far
  // inside the 300/min live-data budget.
  const key = [...symbols].sort().join(",");
  const hit = ltpCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.data;

  const out: Record<string, number> = {};
  // Keep each request well inside the URL length and rate limits.
  for (let i = 0; i < symbols.length; i += 40) {
    const batch = symbols.slice(i, i + 40);
    const q = batch.map((s) => `NSE_${s}`).join(",");
    const p = await get<Record<string, number>>(
      `/v1/live-data/ltp?segment=CASH&exchange_symbols=${encodeURIComponent(q)}`,
    );
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === "number") out[k.replace(/^NSE_/, "")] = v;
    }
  }
  ltpCache.set(key, { at: Date.now(), data: out });
  return out;
}

const ltpCache = new Map<string, { at: number; data: Record<string, number> }>();

/**
 * Live index levels. Groww spells these its own way — NSE_NIFTYMIDSELECT for
 * the midcap select index, SENSEX on the BSE prefix — so the mapping lives
 * here and callers speak the app's symbols.
 */
const INDEX_WIRE: Record<string, string> = {
  NIFTY: "NSE_NIFTY",
  SENSEX: "BSE_SENSEX",
  BANKNIFTY: "NSE_BANKNIFTY",
  MIDCPNIFTY: "NSE_NIFTYMIDSELECT",
  FINNIFTY: "NSE_FINNIFTY",
};

export async function getIndexLtp(): Promise<Record<string, number>> {
  const key = "indices";
  const hit = ltpCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.data;

  const q = Object.values(INDEX_WIRE).join(",");
  const p = await get<Record<string, number>>(
    `/v1/live-data/ltp?segment=CASH&exchange_symbols=${encodeURIComponent(q)}`,
  );
  const out: Record<string, number> = {};
  if (p) {
    for (const [ours, wire] of Object.entries(INDEX_WIRE)) {
      const v = p[wire];
      if (typeof v === "number") out[ours] = v;
    }
  }
  ltpCache.set(key, { at: Date.now(), data: out });
  return out;
}
