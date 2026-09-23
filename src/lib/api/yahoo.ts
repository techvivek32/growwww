import "server-only";
import { SNAPSHOT } from "../snapshot";
import * as groww from "./groww";

/**
 * Market data. Yahoo supplies the daily HISTORY — sparks, previous closes,
 * volume baselines — which needs no key and moves once a day. The live last
 * price on top of it comes from Groww's real-time feed when credentials
 * exist (see overlayLive below), so during market hours the screen prints
 * the exchange tick, not Yahoo's delayed one.
 */

export interface Quote {
  /** NSE trading symbol, e.g. RELIANCE. */
  symbol: string;
  /** Yahoo ticker the quote came from, e.g. RELIANCE.NS. */
  yahoo: string;
  name: string;
  last: number;
  prevClose: number;
  change: number;
  changePct: number;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  /** 20-session average volume — what "4.1x average" is measured against. */
  avgVolume: number | null;
  /** Daily closes, oldest first — drives the sparklines. */
  spark: number[];
  /** True when this quote came from the committed snapshot, not a live fetch. */
  stale?: boolean;
  /** Capture date of the snapshot this quote came from, e.g. "2026-09-02". */
  asOf?: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/**
 * Cache window in seconds — for the daily HISTORY only (sparks, previous
 * close, volume baselines), which moves once a day. The live last price is
 * overlaid from Groww's real-time feed below, so this can stay comfortably
 * inside Yahoo's rate limits without making the screen feel stale.
 */
const REVALIDATE = 60;

interface YahooBar {
  d: string;
  c: number;
  v: number | null;
}

interface ChartResult {
  meta: {
    symbol?: string;
    shortName?: string;
    longName?: string;
    regularMarketPrice?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketVolume?: number;
    chartPreviousClose?: number;
    previousClose?: number;
  };
  timestamp?: number[];
  indicators: { quote: { close?: (number | null)[]; volume?: (number | null)[] }[] };
}

async function chart(yahoo: string, range: string): Promise<ChartResult | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}` +
    `?interval=1d&range=${range}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { chart?: { result?: ChartResult[] } };
    return json?.chart?.result?.[0] ?? null;
  } catch {
    // Offline build, DNS failure, Yahoo rate limit — the caller falls back.
    return null;
  }
}

function bars(res: ChartResult): YahooBar[] {
  const ts = res.timestamp ?? [];
  const q = res.indicators?.quote?.[0] ?? {};
  const out: YahooBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (typeof c === "number" && Number.isFinite(c)) {
      const v = q.volume?.[i];
      out.push({
        d: new Date(ts[i] * 1000).toISOString().slice(0, 10),
        c: +c.toFixed(2),
        v: typeof v === "number" ? v : null,
      });
    }
  }
  return out;
}

async function fetchOne(symbol: string, yahoo: string, name?: string): Promise<Quote | null> {
  const res = await chart(yahoo, "3mo");
  if (!res) return null;

  const series = bars(res);
  const last = res.meta.regularMarketPrice ?? series.at(-1)?.c;
  if (typeof last !== "number") return null;

  // Previous close is normally the second-last bar. Some derived NSE index
  // tickers (MIDCPNIFTY, FINNIFTY) have gap-ridden daily history on Yahoo, and
  // differencing bars two months apart would report that gap as today's move.
  // For those, a 1-month window makes chartPreviousClose resolve correctly.
  let prev: number | undefined;
  if (series.length >= 2) {
    const gapDays = (Date.parse(series[series.length - 1].d) - Date.parse(series[series.length - 2].d)) / 86_400_000;
    if (gapDays <= 4) prev = series[series.length - 2].c;
  }
  if (prev === undefined) {
    const short = await chart(yahoo, "1mo");
    prev = short?.meta.chartPreviousClose ?? short?.meta.previousClose ?? last;
  }

  // 20 sessions ending at yesterday — today is excluded so a volume spike is
  // measured against a baseline it is not itself part of.
  const vols = series.map((b) => b.v).filter((v): v is number => typeof v === "number" && v > 0);
  const window = vols.slice(-21, -1);
  const avgVolume = window.length
    ? Math.round(window.reduce((a, b) => a + b, 0) / window.length)
    : null;

  const change = last - prev;
  return {
    symbol,
    yahoo,
    name: name ?? res.meta.shortName ?? res.meta.longName ?? symbol,
    last: +last.toFixed(2),
    prevClose: +prev.toFixed(2),
    change: +change.toFixed(2),
    changePct: +((change / prev) * 100).toFixed(2),
    dayHigh: res.meta.regularMarketDayHigh ?? null,
    dayLow: res.meta.regularMarketDayLow ?? null,
    volume: res.meta.regularMarketVolume ?? null,
    avgVolume,
    spark: series.slice(-30).map((b) => b.c),
  };
}

/* ------------------------------------------------------------------ public */

export const INDEX_TICKERS: { symbol: string; yahoo: string; name: string }[] = [
  { symbol: "NIFTY", yahoo: "^NSEI", name: "NIFTY 50" },
  { symbol: "SENSEX", yahoo: "^BSESN", name: "S&P BSE SENSEX" },
  { symbol: "BANKNIFTY", yahoo: "^NSEBANK", name: "NIFTY Bank" },
  { symbol: "MIDCPNIFTY", yahoo: "NIFTY_MID_SELECT.NS", name: "NIFTY Midcap Select" },
  { symbol: "FINNIFTY", yahoo: "NIFTY_FIN_SERVICE.NS", name: "NIFTY Fin Services" },
];

/**
 * Live index quotes, falling back to the committed snapshot per-symbol so one
 * flaky ticker never blanks the whole strip.
 */
export async function getIndices(): Promise<Quote[]> {
  const results = await Promise.all(
    INDEX_TICKERS.map((t) => fetchOne(t.symbol, t.yahoo, t.name)),
  );
  const quotes = results
    .map((q, i) => q ?? markStale(SNAPSHOT.indices[i]))
    .filter((q): q is Quote => Boolean(q));
  return overlayLive(quotes, () => groww.getIndexLtp());
}

/** Live equity quotes by NSE symbol, snapshot-backed the same way. */
export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  // Any NSE symbol resolves — `SYMBOL.NS` is Yahoo's spelling — so a symbol
  // outside the snapshot universe still fetches instead of silently dropping.
  const wanted = symbols.map((sym) => {
    const snap = SNAPSHOT.stocks.find((x) => x.symbol === sym);
    return { symbol: sym, yahoo: snap?.yahoo ?? `${sym}.NS`, name: snap?.name, snap };
  });

  const results = await Promise.all(wanted.map((w) => fetchOne(w.symbol, w.yahoo, w.name)));
  const quotes = results
    .map((q, i) => q ?? markStale(wanted[i].snap))
    .filter((q): q is Quote => Boolean(q));
  return overlayLive(quotes, () => groww.getLtp(quotes.map((q) => q.symbol)));
}

/** A snapshot substitute carries its vintage so no screen prints it as today. */
function markStale(snap: Quote | undefined): Quote | null {
  if (!snap) return null;
  return { ...snap, stale: true, asOf: SNAPSHOT.fetchedAt.slice(0, 10) };
}

/**
 * Replace each quote's last price with Groww's real-time tick and recompute
 * the day change against the same previous close. Yahoo's feed is delayed;
 * Groww's is the exchange tick, so when credentials exist the screen shows
 * the number the market is actually printing. Any failure falls back to the
 * Yahoo price — market data must never blank because the broker blipped.
 */
async function overlayLive(
  quotes: Quote[],
  fetchLtp: () => Promise<Record<string, number>>,
): Promise<Quote[]> {
  if (!groww.hasCredentials()) return quotes;
  try {
    const live = await fetchLtp();
    return quotes.map((q) => {
      // A stale quote's previous close is from another day; differencing a
      // live tick against it would print a multi-day move as today's change.
      if (q.stale) return q;
      const ltp = live[q.symbol];
      if (typeof ltp !== "number" || !Number.isFinite(ltp) || q.prevClose <= 0) return q;
      const change = ltp - q.prevClose;
      return {
        ...q,
        last: +ltp.toFixed(2),
        change: +change.toFixed(2),
        changePct: +((change / q.prevClose) * 100).toFixed(2),
      };
    });
  } catch (err) {
    console.error("[yahoo] live overlay failed:", err instanceof Error ? err.message : err);
    return quotes;
  }
}

/** Every equity the app knows about. */
export async function getUniverse(): Promise<Quote[]> {
  return getQuotes(SNAPSHOT.stocks.map((s) => s.symbol));
}

export function snapshotTakenAt(): string {
  return SNAPSHOT.fetchedAt;
}
