import "server-only";

/**
 * Groww's instrument master — the same file its own SDK uses.
 *
 * One ~20MB CSV holds every tradable instrument: trading symbols, exchange
 * tokens, option strikes, expiries, lot sizes, tick sizes. It is fetched once
 * and kept in memory for a day; strikes and lot sizes change on exchange
 * schedules, not intraday, so a daily refresh is the honest cadence.
 */

const CSV_URL = "https://growwapi-assets.groww.in/instruments/instrument.csv";

export interface OptionInstrument {
  tradingSymbol: string;
  strike: number;
  right: "CE" | "PE";
  expiry: string; // YYYY-MM-DD
  lotSize: number;
}

export interface EquityInstrument {
  tradingSymbol: string;
  name: string;
}

interface Master {
  loadedAt: number;
  /** underlying -> expiry -> strike -> { CE, PE } */
  options: Map<string, Map<string, Map<number, { CE?: OptionInstrument; PE?: OptionInstrument }>>>;
  /** underlying -> sorted expiries */
  expiries: Map<string, string[]>;
  /** NSE cash equities, for search and lot-free orders. */
  equities: EquityInstrument[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The index underlyings the chain UI offers. */
export const CHAIN_UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"] as const;

const store = globalThis as { __mnhaInstruments?: { master: Master | null; loading: Promise<Master> | null } };
store.__mnhaInstruments ??= { master: null, loading: null };

async function load(): Promise<Master> {
  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`instrument master: HTTP ${res.status}`);
  const text = await res.text();

  const options: Master["options"] = new Map();
  const expirySets = new Map<string, Set<string>>();
  const equities: EquityInstrument[] = [];
  const wanted = new Set<string>(CHAIN_UNDERLYINGS);

  const lines = text.split("\n");
  // exchange,exchange_token,trading_symbol,groww_symbol,name,instrument_type,
  // segment,series,isin,underlying_symbol,...,expiry_date,strike_price,lot_size,...
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 15 || cols[0] !== "NSE") continue;

    const segment = cols[6];
    if (segment === "CASH") {
      // Series EQ only — the tradable common stock, not bonds or rights.
      if (cols[7] === "EQ" && cols[2]) {
        equities.push({ tradingSymbol: cols[2], name: cols[4] || cols[2] });
      }
      continue;
    }

    if (segment !== "FNO") continue;
    const right = cols[5];
    if (right !== "CE" && right !== "PE") continue;
    const underlying = cols[9];
    if (!wanted.has(underlying)) continue;

    const expiry = cols[11];
    const strike = Number(cols[12]);
    const lotSize = Number(cols[13]);
    if (!expiry || !Number.isFinite(strike) || !Number.isFinite(lotSize)) continue;

    let byExpiry = options.get(underlying);
    if (!byExpiry) options.set(underlying, (byExpiry = new Map()));
    let byStrike = byExpiry.get(expiry);
    if (!byStrike) byExpiry.set(expiry, (byStrike = new Map()));
    let pair = byStrike.get(strike);
    if (!pair) byStrike.set(strike, (pair = {}));
    pair[right] = { tradingSymbol: cols[2], strike, right, expiry, lotSize };

    let exps = expirySets.get(underlying);
    if (!exps) expirySets.set(underlying, (exps = new Set()));
    exps.add(expiry);
  }

  const expiries = new Map<string, string[]>();
  for (const [u, set] of expirySets) expiries.set(u, [...set].sort());

  return { loadedAt: Date.now(), options, expiries, equities };
}

async function master(): Promise<Master> {
  const s = store.__mnhaInstruments!;
  if (s.master && Date.now() - s.master.loadedAt < DAY_MS) return s.master;
  s.loading ??= load()
    .then((m) => {
      s.master = m;
      return m;
    })
    .finally(() => {
      s.loading = null;
    });
  // While a refresh runs, a stale-but-yesterday master is still fine to serve.
  return s.master ?? s.loading;
}

/** Expiries for an underlying from today onward. */
export async function getExpiries(underlying: string): Promise<string[]> {
  const m = await master();
  const today = new Date().toISOString().slice(0, 10);
  return (m.expiries.get(underlying) ?? []).filter((e) => e >= today);
}

/**
 * The strikes bracketing a spot level for one expiry — `span` on each side —
 * with both legs' real trading symbols and the lot size.
 */
export async function getStrikesAround(
  underlying: string,
  expiry: string,
  spot: number,
  span = 10,
): Promise<{ strikes: { strike: number; CE?: OptionInstrument; PE?: OptionInstrument }[]; lotSize: number }> {
  const m = await master();
  const byStrike = m.options.get(underlying)?.get(expiry);
  if (!byStrike || byStrike.size === 0) return { strikes: [], lotSize: 0 };

  const all = [...byStrike.keys()].sort((a, b) => a - b);
  let atmIdx = 0;
  let best = Infinity;
  all.forEach((s, i) => {
    const d = Math.abs(s - spot);
    if (d < best) {
      best = d;
      atmIdx = i;
    }
  });

  const lo = Math.max(0, atmIdx - span);
  const hi = Math.min(all.length, atmIdx + span + 1);
  const strikes = all.slice(lo, hi).map((strike) => ({ strike, ...byStrike.get(strike)! }));
  const lotSize =
    strikes[0]?.CE?.lotSize ?? strikes[0]?.PE?.lotSize ?? 0;

  return { strikes, lotSize };
}

/** Lot size for one FNO trading symbol; null when unknown. */
export async function lotSizeOf(tradingSymbol: string): Promise<number | null> {
  const m = await master();
  for (const byExpiry of m.options.values()) {
    for (const byStrike of byExpiry.values()) {
      for (const pair of byStrike.values()) {
        if (pair.CE?.tradingSymbol === tradingSymbol) return pair.CE.lotSize;
        if (pair.PE?.tradingSymbol === tradingSymbol) return pair.PE.lotSize;
      }
    }
  }
  return null;
}

/** Case-insensitive search over NSE equities, best-prefix first. */
export async function searchEquities(query: string, limit = 8): Promise<EquityInstrument[]> {
  const q = query.trim().toUpperCase();
  if (q.length < 2) return [];
  const m = await master();

  const starts: EquityInstrument[] = [];
  const contains: EquityInstrument[] = [];
  for (const e of m.equities) {
    const sym = e.tradingSymbol.toUpperCase();
    const name = e.name.toUpperCase();
    if (sym.startsWith(q)) starts.push(e);
    else if (sym.includes(q) || name.includes(q)) contains.push(e);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
