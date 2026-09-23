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

/** Same envelope, for writes. Returns the full body so callers can read
 *  Groww's own error message rather than a bare null. */
async function post<T>(
  path: string,
  json: unknown,
): Promise<{ ok: boolean; payload: T | null; message: string | null }> {
  const token = await accessToken();
  const res = await request<{
    status?: string;
    payload?: T;
    error?: { message?: string; code?: string };
  }>(path, { method: "POST", token, json });

  const ok = res.status === 200 && res.body?.status === "SUCCESS";
  return {
    ok,
    payload: res.body?.payload ?? null,
    message: res.body?.error?.message ?? (ok ? null : `HTTP ${res.status}`),
  };
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

/* ------------------------------------------------------------- day change */

/**
 * Today's percent move for one symbol, from the full quote endpoint. Used for
 * holdings, which arrive without one. null when the call misses — the UI
 * prints a dash rather than a zero.
 */
async function dayChangePct(symbol: string): Promise<number | null> {
  const p = await get<{ day_change_perc?: number }>(
    `/v1/live-data/quote?exchange=NSE&segment=CASH&trading_symbol=${encodeURIComponent(symbol)}`,
  );
  return typeof p?.day_change_perc === "number" ? +p.day_change_perc.toFixed(2) : null;
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

  const keep = rows.filter((h) => h.trading_symbol && (h.quantity ?? 0) > 0);

  // The holdings payload carries neither a live price nor a day move; both
  // come from the live-data endpoints, and stay null when a call misses —
  // a missing price is not the average cost, and an unknown move is not 0%.
  const dayMoves = await Promise.all(
    keep.map((h) => dayChangePct(h.trading_symbol as string).catch(() => null)),
  );

  return keep.map((h, i) => {
    const symbol = h.trading_symbol as string;
    return {
      symbol,
      company: symbol,
      qty: h.quantity ?? 0,
      avg: h.average_price ?? 0,
      ltp: ltp[symbol] ?? null,
      dayPct: dayMoves[i],
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
      ltp: ltp[symbol] ?? null,
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

/** IST session date (YYYY-MM-DD) of a fill timestamp; null when unparseable. */
function dateOf(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

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
        date: dateOf(o.exchange_time ?? o.created_at),
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

/* --------------------------------------------------------------- FNO data */

export interface FnoQuote {
  ltp: number;
  prevClose: number | null;
  changePct: number | null;
  oi: number | null;
  prevOi: number | null;
  volume: number | null;
}

/** Batched last prices for FNO trading symbols (options, futures). */
export async function getFnoLtp(tradingSymbols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < tradingSymbols.length; i += 40) {
    const batch = tradingSymbols.slice(i, i + 40);
    const q = batch.map((t) => `NSE_${t}`).join(",");
    const p = await get<Record<string, number>>(
      `/v1/live-data/ltp?segment=FNO&exchange_symbols=${encodeURIComponent(q)}`,
    );
    if (!p) continue;
    for (const t of batch) {
      const v = p[`NSE_${t}`];
      if (typeof v === "number") out[t] = v;
    }
  }
  return out;
}

const fnoQuoteCache = new Map<string, { at: number; q: FnoQuote }>();

/** OI and previous close move slowly next to the price; 45s is plenty. */
const FNO_QUOTE_TTL_MS = 45_000;

async function fnoQuoteOnce(tradingSymbol: string): Promise<FnoQuote | null> {
  const p = await get<{
    last_price?: number;
    day_change_perc?: number;
    open_interest?: number;
    previous_open_interest?: number;
    volume?: number;
    ohlc?: { close?: number };
  }>(`/v1/live-data/quote?exchange=NSE&segment=FNO&trading_symbol=${encodeURIComponent(tradingSymbol)}`);
  if (!p || typeof p.last_price !== "number") return null;
  return {
    ltp: p.last_price,
    prevClose: typeof p.ohlc?.close === "number" ? p.ohlc.close : null,
    changePct: typeof p.day_change_perc === "number" ? +p.day_change_perc.toFixed(2) : null,
    oi: typeof p.open_interest === "number" ? p.open_interest : null,
    prevOi: typeof p.previous_open_interest === "number" ? p.previous_open_interest : null,
    volume: typeof p.volume === "number" ? p.volume : null,
  };
}

/**
 * Full FNO quotes for a set of trading symbols, cached and pooled. A chain of
 * 21 strikes is 42 legs; at a 45-second cache that is well inside the
 * live-data budget alongside the tick hub.
 */
export async function getFnoQuotes(tradingSymbols: string[]): Promise<Record<string, FnoQuote>> {
  const now = Date.now();
  const out: Record<string, FnoQuote> = {};
  const due: string[] = [];

  for (const t of tradingSymbols) {
    const hit = fnoQuoteCache.get(t);
    if (hit && now - hit.at < FNO_QUOTE_TTL_MS) out[t] = hit.q;
    else due.push(t);
  }

  if (due.length) {
    const fresh = await pool(due, 6, (t) => fnoQuoteOnce(t).catch(() => null));
    fresh.forEach((q, i) => {
      if (q) {
        fnoQuoteCache.set(due[i], { at: now, q });
        out[due[i]] = q;
      }
    });
  }

  // Overlay the freshest LTP in one batched call — the quote cache may be up
  // to 45s old on price, which is the one field that must not be.
  try {
    const live = await getFnoLtp(tradingSymbols.filter((t) => out[t]));
    for (const [t, ltp] of Object.entries(live)) {
      if (out[t]) out[t] = { ...out[t], ltp };
    }
  } catch {
    /* cached prices stand */
  }

  return out;
}

/* ------------------------------------------------------------ placing an order */

export interface PlaceOrderInput {
  symbol: string;
  side: Side;
  qty: number;
  type: OrderType;
  product: Product;
  /** Required for LIMIT and SL; ignored otherwise. */
  price?: number | null;
  /** Required for SL and SL_M; ignored otherwise. */
  triggerPrice?: number | null;
  segment?: "CASH" | "FNO";
}

export interface PlaceOrderResult {
  ok: boolean;
  orderId: string | null;
  status: string | null;
  /** Groww's own message on rejection — shown to the user verbatim. */
  message: string | null;
  /** The reference we sent, so the order can be found again if a reply is lost. */
  referenceId: string;
}

/**
 * A client-side reference Groww echoes back. If the response never arrives —
 * a timeout, a dropped connection — this is how the order is identified in
 * the order book rather than being blind-retried into a double fill.
 */
function referenceId(): string {
  return `mnha-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const segment = input.segment ?? "CASH";
  const ref = referenceId();

  const body: Record<string, unknown> = {
    trading_symbol: input.symbol,
    quantity: input.qty,
    validity: "DAY",
    exchange: "NSE",
    segment,
    product: input.product,
    order_type: input.type,
    transaction_type: input.side,
    order_reference_id: ref,
  };

  // Only send the fields the order type actually uses — a stray price on a
  // MARKET order is the kind of thing a broker rejects the whole ticket for.
  if (input.type === "LIMIT" || input.type === "SL") body.price = input.price;
  if (input.type === "SL" || input.type === "SL_M") body.trigger_price = input.triggerPrice;

  const res = await post<{ groww_order_id?: string; order_status?: string; remark?: string }>(
    "/v1/order/create",
    body,
  );

  return {
    ok: res.ok,
    orderId: res.payload?.groww_order_id ?? null,
    status: res.payload?.order_status ?? null,
    message: res.payload?.remark ?? res.message,
    referenceId: ref,
  };
}

export async function cancelOrder(
  orderId: string,
  segment: "CASH" | "FNO" = "CASH",
): Promise<{ ok: boolean; message: string | null }> {
  const res = await post<{ order_status?: string }>("/v1/order/cancel", {
    segment,
    groww_order_id: orderId,
  });
  return { ok: res.ok, message: res.message };
}

/** Read an order back after submitting — never trust the write alone. */
export async function getOrderStatus(
  orderId: string,
  segment: "CASH" | "FNO" = "CASH",
): Promise<{ status: string | null; filled: number | null; remark: string | null } | null> {
  const p = await get<{ order_status?: string; filled_quantity?: number; remark?: string }>(
    `/v1/order/status/${encodeURIComponent(orderId)}?segment=${segment}`,
  );
  if (!p) return null;
  return {
    status: p.order_status ?? null,
    filled: typeof p.filled_quantity === "number" ? p.filled_quantity : null,
    remark: p.remark ?? null,
  };
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
  if (hit && Date.now() - hit.at < 3_000) return hit.data;

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

/* ------------------------------------------------------------ full quotes */

export interface Tick {
  symbol: string;
  last: number;
  /** Previous session's close, from the exchange — not derived. */
  prevClose: number;
  change: number;
  changePct: number;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
}

interface GrowwQuote {
  last_price?: number;
  day_change?: number;
  day_change_perc?: number;
  volume?: number;
  ohlc?: { open?: number; high?: number; low?: number; close?: number };
}

/**
 * Groww spells the indices its own way; equities are just the symbol.
 * `NIFTY` and friends still live in the CASH segment.
 */
const INDEX_WIRE: Record<string, string> = {
  NIFTY: "NSE_NIFTY",
  SENSEX: "BSE_SENSEX",
  BANKNIFTY: "NSE_BANKNIFTY",
  MIDCPNIFTY: "NSE_NIFTYMIDSELECT",
  FINNIFTY: "NSE_FINNIFTY",
};

const QUOTE_SYMBOL: Record<string, string> = {
  MIDCPNIFTY: "NIFTYMIDSELECT",
};

/** Exchange for the quote endpoint — SENSEX is BSE, everything else NSE. */
function exchangeOf(symbol: string): string {
  return symbol === "SENSEX" ? "BSE" : "NSE";
}

/**
 * One symbol's full quote. This is the honest source for a day change:
 * Groww returns the exchange's own `day_change` and the previous close in
 * `ohlc.close`, so nothing has to be differenced against a third party's
 * history — which is exactly where the old numbers went wrong, because
 * Yahoo's daily series can silently omit a whole session.
 */
export async function getQuote(symbol: string): Promise<Tick | null> {
  const wire = QUOTE_SYMBOL[symbol] ?? symbol;
  const p = await get<GrowwQuote>(
    `/v1/live-data/quote?exchange=${exchangeOf(symbol)}&segment=CASH&trading_symbol=${encodeURIComponent(wire)}`,
  );

  const last = p?.last_price;
  const prevClose = p?.ohlc?.close;
  if (typeof last !== "number" || typeof prevClose !== "number" || prevClose <= 0) return null;

  const change = typeof p?.day_change === "number" ? p.day_change : last - prevClose;
  const changePct =
    typeof p?.day_change_perc === "number" ? p.day_change_perc : (change / prevClose) * 100;

  return {
    symbol,
    last: +last.toFixed(2),
    prevClose: +prevClose.toFixed(2),
    change: +change.toFixed(2),
    changePct: +changePct.toFixed(2),
    dayHigh: typeof p?.ohlc?.high === "number" ? p.ohlc.high : null,
    dayLow: typeof p?.ohlc?.low === "number" ? p.ohlc.low : null,
    volume: typeof p?.volume === "number" ? p.volume : null,
  };
}

/** Bounded concurrency — the live-data budget is 10/s, 300/min. */
async function pool<T, R>(items: T[], size: number, run: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await run(items[i]);
      }
    }),
  );
  return out;
}

const quoteCache = new Map<string, { at: number; tick: Tick }>();

/**
 * The session-stable half of a quote — previous close, day high/low — moves
 * rarely, so full quotes are refreshed on a slow cycle while the last price
 * rides the batched LTP endpoint every poll. That keeps a 3-second cadence
 * across ~40 on-screen symbols at roughly one LTP request per poll plus a
 * trickle of quote refreshes: comfortably inside the 300/min budget, where
 * per-symbol full quotes every poll would blow straight through it.
 */
const QUOTE_TTL_MS = 60_000;

/** Wire spelling for the batched LTP endpoint. */
function ltpWire(symbol: string): string {
  return INDEX_WIRE[symbol] ?? `NSE_${symbol}`;
}

async function ltpBatch(symbols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < symbols.length; i += 40) {
    const batch = symbols.slice(i, i + 40);
    const q = batch.map(ltpWire).join(",");
    const p = await get<Record<string, number>>(
      `/v1/live-data/ltp?segment=CASH&exchange_symbols=${encodeURIComponent(q)}`,
    );
    if (!p) continue;
    for (const sym of batch) {
      const v = p[ltpWire(sym)];
      if (typeof v === "number") out[sym] = v;
    }
  }
  return out;
}

/**
 * Live ticks for a set of symbols.
 *
 * Change is last price minus the exchange's own previous close (from the
 * full quote's ohlc) — same source, same session, never a third party's
 * history. When a symbol's quote has not loaded yet its tick is simply
 * absent this round rather than guessed.
 */
export async function getTicks(symbols: string[]): Promise<Record<string, Tick>> {
  if (symbols.length === 0) return {};
  const now = Date.now();

  // Refresh the slow half for whoever needs it, a few at a time.
  const due = symbols.filter((sym) => {
    const hit = quoteCache.get(sym);
    return !hit || now - hit.at >= QUOTE_TTL_MS;
  });
  if (due.length) {
    const fresh = await pool(due, 6, (sym) => getQuote(sym).catch(() => null));
    fresh.forEach((tick, i) => {
      if (tick) quoteCache.set(due[i], { at: now, tick });
    });
  }

  // The fast half: one batched request for every last price.
  let live: Record<string, number> = {};
  try {
    live = await ltpBatch(symbols);
  } catch {
    // The cached quotes still carry a usable last price.
  }

  const out: Record<string, Tick> = {};
  for (const sym of symbols) {
    const base = quoteCache.get(sym)?.tick;
    if (!base) continue;
    const last = live[sym] ?? base.last;
    const change = last - base.prevClose;
    out[sym] = {
      ...base,
      last: +last.toFixed(2),
      change: +change.toFixed(2),
      changePct: +((change / base.prevClose) * 100).toFixed(2),
    };
  }
  return out;
}
