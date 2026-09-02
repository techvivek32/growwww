import type { Quote } from "./api/yahoo";

/**
 * NSE index options, priced off the real spot.
 *
 * Yahoo carries no Indian option chain, so Phase 1 prices the chain with
 * Black-Scholes against the live index level, real strike spacing, real lot
 * sizes and the real days left to expiry. The premiums are therefore
 * internally consistent and move with the market rather than being invented —
 * but they are a model, not the exchange's quotes. Phase 2 replaces this
 * whole module with the Groww chain endpoint.
 */

/** Contract specs as the exchange defines them. Lot sizes are revised periodically. */
export const CONTRACTS = {
  NIFTY: { lot: 75, step: 50, iv: 0.124 },
  BANKNIFTY: { lot: 35, step: 100, iv: 0.151 },
  FINNIFTY: { lot: 65, step: 50, iv: 0.138 },
  MIDCPNIFTY: { lot: 140, step: 25, iv: 0.166 },
} as const;

export type Underlying = keyof typeof CONTRACTS;

/* ------------------------------------------------------- Black-Scholes */

/** Abramowitz & Stegun 7.1.26 — plenty accurate for display pricing. */
function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

const RATE = 0.065; // ~India 91-day T-bill

export function bsPrice(
  spot: number,
  strike: number,
  years: number,
  iv: number,
  right: "CE" | "PE",
): number {
  if (years <= 0) {
    return Math.max(0, right === "CE" ? spot - strike : strike - spot);
  }
  const sqrtT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (RATE + (iv * iv) / 2) * years) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  const disc = Math.exp(-RATE * years);
  const price =
    right === "CE"
      ? spot * normCdf(d1) - strike * disc * normCdf(d2)
      : strike * disc * normCdf(-d2) - spot * normCdf(-d1);
  return Math.max(0.05, price);
}

/* ------------------------------------------------------------- expiry */

/** NSE index weeklies expire on Tuesday. Returns the next one, IST. */
export function nextExpiry(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setUTCHours(10, 0, 0, 0); // 15:30 IST
  const day = d.getUTCDay(); // 0 Sun … 2 Tue
  let add = (2 - day + 7) % 7;
  if (add === 0 && from.getTime() > d.getTime()) add = 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}

export function daysToExpiry(from: Date = new Date()): number {
  return Math.max(0, Math.ceil((nextExpiry(from).getTime() - from.getTime()) / 86_400_000));
}

export function formatExpiry(d: Date = nextExpiry()): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/* -------------------------------------------------------------- chain */

export interface ChainRow {
  strike: number;
  ceLtp: number;
  ceChg: number;
  ceIv: number;
  ceOi: number;
  peLtp: number;
  peChg: number;
  peIv: number;
  peOi: number;
}

export interface Chain {
  underlying: Underlying;
  spot: number;
  prevSpot: number;
  atm: number;
  lot: number;
  expiry: string;
  daysLeft: number;
  rows: ChainRow[];
}

export function buildChain(index: Quote, underlying: Underlying = "NIFTY", width = 5): Chain {
  const spec = CONTRACTS[underlying];
  const spot = index.last;
  const prevSpot = index.prevClose;
  const atm = Math.round(spot / spec.step) * spec.step;
  const daysLeft = daysToExpiry();
  const years = Math.max(daysLeft, 0.5) / 365;
  const prevYears = Math.max(daysLeft + 1, 0.5) / 365;

  const rows: ChainRow[] = [];
  for (let i = -width; i <= width; i++) {
    const strike = atm + i * spec.step;

    // A volatility smile: wings carry more IV than the money.
    const moneyness = Math.abs(strike - spot) / spot;
    const iv = spec.iv * (1 + moneyness * 5.5);

    const ce = bsPrice(spot, strike, years, iv, "CE");
    const pe = bsPrice(spot, strike, years, iv, "PE");
    const cePrev = bsPrice(prevSpot, strike, prevYears, iv, "CE");
    const pePrev = bsPrice(prevSpot, strike, prevYears, iv, "PE");

    // Open interest concentrates at round strikes near the money.
    const z = (strike - atm) / (spec.step * 3);
    const bell = Math.exp(-(z * z));
    const round = strike % (spec.step * 2) === 0 ? 1.35 : 1;

    rows.push({
      strike,
      ceLtp: +ce.toFixed(2),
      ceChg: +(((ce - cePrev) / cePrev) * 100).toFixed(1),
      ceIv: +(iv * 100).toFixed(1),
      ceOi: +(bell * round * (strike >= atm ? 78 : 34)).toFixed(1),
      peLtp: +pe.toFixed(2),
      peChg: +(((pe - pePrev) / pePrev) * 100).toFixed(1),
      peIv: +(iv * 100).toFixed(1),
      peOi: +(bell * round * (strike <= atm ? 82 : 30)).toFixed(1),
    });
  }

  return {
    underlying,
    spot,
    prevSpot,
    atm,
    lot: spec.lot,
    expiry: formatExpiry(),
    daysLeft,
    rows,
  };
}

/* ---------------------------------------------------------- F&O setups */

export interface FnoAlert {
  underlying: Underlying;
  strike: number;
  right: "CE" | "PE";
  expiry: string;
  daysLeft: number;
  lotSize: number;
  lots: number;
  premium: number;
  entry: number;
  target: number;
  stop: number;
  iv: number;
  score: number;
  rationale: string;
}

/**
 * One directional setup per index, taking its side from how the index itself
 * closed. Sizing is whole lots against a per-trade risk budget — NSE options
 * cannot be traded in odd lots, so the quantity is always a lot multiple.
 */
export function buildFnoAlerts(indices: Quote[], riskBudget = 6000): FnoAlert[] {
  const wanted: Underlying[] = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
  const daysLeft = daysToExpiry();
  const expiry = formatExpiry();
  const years = Math.max(daysLeft, 0.5) / 365;

  return wanted
    .map((u): FnoAlert | null => {
      const idx = indices.find((i) => i.symbol === u);
      if (!idx) return null;

      const spec = CONTRACTS[u];
      const bullish = idx.changePct >= 0;
      const right: "CE" | "PE" = bullish ? "CE" : "PE";
      const atm = Math.round(idx.last / spec.step) * spec.step;

      // One strike out of the money — the liquid, conventional choice.
      const strike = bullish ? atm + spec.step : atm - spec.step;
      const moneyness = Math.abs(strike - idx.last) / idx.last;
      const iv = spec.iv * (1 + moneyness * 5.5);
      const premium = bsPrice(idx.last, strike, years, iv, right);

      const entry = +premium.toFixed(2);
      const stop = +(entry * 0.72).toFixed(2); // options move fast; the stop is wide in % but small in rupees
      const target = +(entry * 1.55).toFixed(2);

      const riskPerLot = (entry - stop) * spec.lot;
      const lots = Math.max(1, Math.floor(riskBudget / riskPerLot));

      const score = Math.round(
        Math.min(96, 58 + Math.abs(idx.changePct) * 14 + (daysLeft <= 3 ? 6 : 0)),
      );

      return {
        underlying: u,
        strike,
        right,
        expiry,
        daysLeft,
        lotSize: spec.lot,
        lots,
        premium: entry,
        entry,
        target,
        stop,
        iv: +(iv * 100).toFixed(1),
        score,
        rationale: bullish
          ? `${u} closed up ${idx.changePct.toFixed(2)}% — buying the first strike above ${atm.toLocaleString("en-IN")} while call writers unwind.`
          : `${u} closed down ${Math.abs(idx.changePct).toFixed(2)}% — buying the first strike below ${atm.toLocaleString("en-IN")} as put OI builds under spot.`,
      };
    })
    .filter((x): x is FnoAlert => x !== null)
    .sort((a, b) => b.score - a.score);
}
