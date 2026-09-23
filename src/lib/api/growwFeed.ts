import "server-only";
import { WebSocket as NodeWebSocket } from "ws";
import { connect, jwtAuthenticator, type NatsConnection, type Subscription } from "nats.ws";
import { createUser } from "nkeys.js";
import protobuf from "protobufjs";
import { getAccessToken, hasCredentials } from "./groww";
import { feedTokensFor } from "../instruments";

/**
 * Groww's real-time feed: NATS over WebSocket, protobuf payloads — the same
 * wire its Python SDK speaks. Ticks are pushed by the exchange side, so a
 * price lands here in milliseconds instead of on the next REST poll.
 *
 * The feed is an ACCELERATOR, not a dependency: everything falls back to the
 * REST path when it is down, degraded, or disabled (FEED_ENABLED=false).
 * `latest()` only answers with ticks fresh inside a few seconds, so a wedged
 * connection can never serve old prices as live.
 */

const SOCKET_URL = "wss://socket-api.groww.in";
const TOKEN_URL = "https://api.groww.in/v1/api/apex/v1/socket/token/create/";

/** A feed tick is only trusted while younger than this. */
const FRESH_MS = 5_000;

/** Never subscribe more than this many subjects — the account cap is 1,000. */
const MAX_SUBJECTS = 300;

/* ------------------------------------------------------------------ proto */

const PROTO = `
syntax = "proto3";
package stocksData.response;

message StocksSocketResponseProtoDto {
  string symbol = 1;
  int32 segment = 2;
  int32 exchange = 3;
  oneof livePoint {
    StocksLivePriceProto stockLivePrice = 4;
    StocksMarketDepthProto stocksMarketDepth = 5;
    StocksLiveIndicesProto stocksLiveIndices = 6;
  }
}
message StocksLivePriceProto {
  double tsInMillis = 1;  double open = 2;   double high = 3;   double low = 4;
  double close = 5;       double volume = 6; double value = 7;  double bidQty = 8;
  double offerQty = 9;    double avgPrice = 10; double highPriceRange = 11;
  double lowPriceRange = 12; double ltp = 13; double openInterest = 14;
  double lowTradeRange = 15; double highTradeRange = 16;
}
message StocksLiveIndicesProto { double tsInMillis = 1; double value = 2; }
message BookProto { double price = 1; double qty = 2; }
message StocksMarketDepthProto {
  double tsInMillis = 1;
  map<int32, BookProto> buyBook = 2;
  map<int32, BookProto> sellBook = 3;
}
`;

const root = protobuf.parse(PROTO).root;
const ResponseProto = root.lookupType("stocksData.response.StocksSocketResponseProtoDto");

interface DecodedTick {
  stockLivePrice?: { ltp?: number; tsInMillis?: number };
  stocksLiveIndices?: { value?: number; tsInMillis?: number };
}

/* ------------------------------------------------------------------ state */

interface FeedState {
  nc: NatsConnection | null;
  connecting: Promise<void> | null;
  subs: Map<string, Subscription>; // subject -> subscription
  bySubject: Map<string, string>; // subject -> app symbol
  ticks: Map<string, { ltp: number; at: number }>;
  lastTickAt: number;
  backoffMs: number;
}

const g = globalThis as { __mnhaFeed?: FeedState };
g.__mnhaFeed ??= {
  nc: null,
  connecting: null,
  subs: new Map(),
  bySubject: new Map(),
  ticks: new Map(),
  lastTickAt: 0,
  backoffMs: 2_000,
};
const state = g.__mnhaFeed;

function enabled(): boolean {
  return hasCredentials() && process.env.FEED_ENABLED !== "false";
}

/* ------------------------------------------------------------ connection */

async function mintSocketJwt(): Promise<{ jwt: string; seed: Uint8Array }> {
  const kp = createUser();
  const rest = await getAccessToken();

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${rest}`,
      "Content-Type": "application/json",
      "x-api-version": "1.0",
    },
    body: JSON.stringify({ socketKey: kp.getPublicKey() }),
  });
  if (!res.ok) throw new Error(`socket token: HTTP ${res.status}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("socket token: empty response");

  return { jwt: body.token, seed: kp.getSeed() };
}

async function establish(): Promise<void> {
  // nats.ws expects a browser WebSocket; Node 20 gets the ws shim.
  if (typeof globalThis.WebSocket === "undefined") {
    (globalThis as Record<string, unknown>).WebSocket = NodeWebSocket;
  }

  const { jwt, seed } = await mintSocketJwt();

  const nc = await connect({
    servers: SOCKET_URL,
    authenticator: jwtAuthenticator(jwt, seed),
    // Groww throttles rapid mint+dial cycles; a generous dial window plus
    // the backoff below beats hammering it.
    timeout: 30_000,
    pingInterval: 60_000,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2_000,
  });

  state.nc = nc;
  state.backoffMs = 2_000;

  // Resubscribe whatever was live before a full re-establish.
  const subjects = [...state.bySubject.keys()];
  state.subs.clear();
  for (const subject of subjects) attach(nc, subject);

  // A closed connection clears the slot so the next demand reconnects.
  void nc.closed().then(() => {
    if (state.nc === nc) {
      state.nc = null;
      state.subs.clear();
    }
  });
}

function ensureConnection(): void {
  if (!enabled() || state.nc || state.connecting) return;
  state.connecting = establish()
    .catch((err) => {
      console.error("[feed] connect failed:", err instanceof Error ? err.message : err);
      // Exponential backoff, capped — a dead feed must not hammer the mint.
      const wait = state.backoffMs;
      state.backoffMs = Math.min(60_000, state.backoffMs * 2);
      setTimeout(() => {
        state.connecting = null;
        ensureConnection();
      }, wait);
      throw err;
    })
    .then(
      () => {
        state.connecting = null;
      },
      () => undefined,
    );
}

/* ---------------------------------------------------------- subscriptions */

function attach(nc: NatsConnection, subject: string): void {
  const sub = nc.subscribe(subject, {
    callback: (err, msg) => {
      if (err) return;
      try {
        const decoded = ResponseProto.decode(msg.data) as unknown as DecodedTick;
        const ltp = decoded.stockLivePrice?.ltp ?? decoded.stocksLiveIndices?.value;
        if (typeof ltp !== "number" || !Number.isFinite(ltp) || ltp <= 0) return;
        const symbol = state.bySubject.get(msg.subject);
        if (!symbol) return;
        state.ticks.set(symbol, { ltp: +ltp.toFixed(2), at: Date.now() });
        state.lastTickAt = Date.now();
      } catch {
        // One undecodable frame is dropped; the stream continues.
      }
    },
  });
  state.subs.set(subject, sub);
}

/**
 * Make sure these symbols are on the feed. Fire-and-forget from the REST
 * path — the caller never waits on the socket.
 */
export function want(symbols: string[]): void {
  if (!enabled()) return;
  ensureConnection();

  void feedTokensFor(symbols)
    .then((tokens) => {
      for (const t of tokens) {
        if (state.bySubject.size >= MAX_SUBJECTS) return;
        const subject =
          t.kind === "index" ? `/ld/indices/nse/price.${t.token}` : `/ld/eq/nse/price.${t.token}`;
        if (state.bySubject.has(subject)) continue;
        state.bySubject.set(subject, t.symbol);
        if (state.nc) attach(state.nc, subject);
      }
    })
    .catch(() => undefined);
}

/* ---------------------------------------------------------------- reading */

/** Fresh feed prices for these symbols — absent means "use the REST path". */
export function latest(symbols: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const now = Date.now();
  for (const sym of symbols) {
    const t = state.ticks.get(sym);
    if (t && now - t.at < FRESH_MS) out[sym] = t.ltp;
  }
  return out;
}

/** True while ticks are actually arriving. */
export function healthy(): boolean {
  return state.nc !== null && Date.now() - state.lastTickAt < 15_000;
}
