import "server-only";
import { SNAPSHOT } from "../snapshot";

/**
 * Phase-1 market data: real NSE prices from Yahoo Finance.
 *
 * Yahoo's chart endpoint needs no key and returns `.NS` (NSE) and index data
 * directly, which is enough to build and validate the whole terminal before
 * paying for a Groww subscription. It is delayed, so it is fine for research
 * and paper trading and NOT fine for live execution — Phase 2 replaces this
 * with the Groww WebSocket behind the same function signatures.
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
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/** Cache window in seconds. NSE is delayed anyway; this keeps us well clear of throttling. */
const REVALIDATE = 300;

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
  return results.map((q, i) => q ?? SNAPSHOT.indices[i]).filter(Boolean);
}

/** Live equity quotes by NSE symbol, snapshot-backed the same way. */
export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  const wanted = symbols
    .map((s) => SNAPSHOT.stocks.find((x) => x.symbol === s))
    .filter((x): x is Quote => Boolean(x));

  const results = await Promise.all(wanted.map((s) => fetchOne(s.symbol, s.yahoo, s.name)));
  return results.map((q, i) => q ?? wanted[i]);
}

/** Every equity the app knows about. */
export async function getUniverse(): Promise<Quote[]> {
  return getQuotes(SNAPSHOT.stocks.map((s) => s.symbol));
}

export function snapshotTakenAt(): string {
  return SNAPSHOT.fetchedAt;
}
