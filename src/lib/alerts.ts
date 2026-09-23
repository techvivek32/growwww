import type { Quote } from "./api/yahoo";

/**
 * Turns real NSE quotes into buy setups.
 *
 * Every number here is computed from market data: the day's real range, real
 * volume against its 20-session average, and the real 30-day close series.
 * Where an input is missing the field is null and the UI prints a dash — a
 * constant dressed as a measurement is worse than an honest blank.
 *
 * The levels are mechanical, and presented as such:
 *  - entry  = the last traded price ("at market", not a chosen level)
 *  - risk   = max(0.55 × today's range, 14-day average daily move)
 *  - target = the 20-day closing high when it sits above entry, else a 2R
 *             projection from the risk distance
 *  - R/R    = (target − entry) / risk — an OUTCOME of those two, not an input
 */

export interface StockAlert {
  symbol: string;
  company: string;
  score: number;
  timeframe: string;
  last: number;
  change: number;
  changePct: number;
  entry: number;
  target: number;
  /** True when the target is the observed 20-day closing high. */
  targetIsLevel: boolean;
  stop: number;
  rr: number;
  rsi: number | null;
  volX: number | null;
  tags: string[];
  spark: number[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function sma(series: number[], n: number): number | null {
  if (series.length < n) return null;
  const w = series.slice(-n);
  return w.reduce((a, b) => a + b, 0) / n;
}

/** Wilder's RSI: simple-average seed, then Wilder smoothing over the rest. */
function rsi(series: number[], period = 14): number | null {
  if (series.length < period + 2) return null;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = series[i] - series[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period + 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }

  if (avgGain + avgLoss === 0) return null; // a flat series has no RSI
  return Math.round((avgGain / (avgGain + avgLoss)) * 100);
}

/** Mean absolute close-to-close move over the last `n` sessions. */
function avgDailyMove(series: number[], n = 14): number | null {
  if (series.length < n + 1) return null;
  const w = series.slice(-(n + 1));
  let sum = 0;
  for (let i = 1; i < w.length; i++) sum += Math.abs(w[i] - w[i - 1]);
  return sum / n;
}

export function buildAlert(q: Quote): StockAlert | null {
  const { last, dayHigh, dayLow, spark } = q;
  // A snapshot quote's history and previous close are from another day —
  // deriving a "today" setup from it would present old data as current.
  if (q.stale) return null;
  if (!last || spark.length < 21) return null;

  const volX = q.avgVolume && q.volume ? +(q.volume / q.avgVolume).toFixed(1) : null;
  const ma20 = sma(spark, 20);
  const ma10 = sma(spark, 10);
  const high20 = Math.max(...spark.slice(-20));
  const rsiVal = rsi(spark);

  // Where the price sits in today's real range; null when the feed did not
  // carry a high/low — an unknown range is not a close on the low.
  const closePos =
    dayHigh !== null && dayLow !== null && dayHigh > dayLow
      ? clamp((last - dayLow) / (dayHigh - dayLow), 0, 1)
      : null;

  const score = Math.round(
    clamp(
      46 +
        q.changePct * 4.2 +
        Math.min(volX ?? 1, 6) * 3.4 +
        (closePos !== null ? closePos * 12 : 0) +
        (ma20 && last > ma20 ? 5 : -6),
      35,
      98,
    ),
  );

  // Risk: today's range, or the stock's own recent daily move when today is
  // quiet — so the stop is stock-specific, not a flat percentage template.
  const range = dayHigh !== null && dayLow !== null ? dayHigh - dayLow : 0;
  const adm = avgDailyMove(spark);
  const risk = +Math.max(range * 0.55, adm ?? 0, last * 0.004).toFixed(2);
  if (risk <= 0) return null;

  const entry = +last.toFixed(2);
  const stop = +(entry - risk).toFixed(2);

  // Target: an observable level when one exists above the entry, otherwise a
  // plain 2R projection, and the card says which it is.
  const targetIsLevel = high20 > entry * 1.002;
  const target = targetIsLevel ? +high20.toFixed(2) : +(entry + risk * 2).toFixed(2);
  const rr = +((target - entry) / risk).toFixed(1);

  const tags: string[] = [];
  if (volX && volX >= 1.5) tags.push(`Vol ${volX.toFixed(1)}x 20-day avg so far`);
  if (last > high20) tags.push("Above the 20-day closing high");
  if (closePos !== null && closePos >= 0.85) tags.push("Closed near the day's high");
  if (ma20 && ma10 && ma10 > ma20 && last > ma10) tags.push("Above 10 & 20 DMA");
  else if (ma20 && last > ma20) tags.push("Above 20 DMA");
  if (q.changePct >= 2) tags.push("Fresh upward momentum");
  if (rsiVal !== null && rsiVal >= 70) tags.push(`RSI ${rsiVal} — extended`);

  return {
    symbol: q.symbol,
    company: q.name,
    score,
    timeframe: "1D",
    last: entry,
    change: q.change,
    changePct: q.changePct,
    entry,
    target,
    targetIsLevel,
    stop,
    rr,
    rsi: rsiVal,
    volX,
    tags: tags.slice(0, 4),
    spark,
  };
}

/**
 * Long setups only, best first. Stocks that closed red are excluded — the
 * engine does not publish a long into a down day.
 */
export function buildAlerts(quotes: Quote[], limit = 9): StockAlert[] {
  return quotes
    .filter((q) => q.changePct > 0)
    .map(buildAlert)
    .filter((a): a is StockAlert => a !== null && a.tags.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Everything the scanner shows, ranked, regardless of direction. */
export function buildScanRows(quotes: Quote[]) {
  return quotes
    .map((q) => {
      const a = buildAlert(q);
      const volX = q.avgVolume && q.volume ? +(q.volume / q.avgVolume).toFixed(1) : null;
      const ma20 = sma(q.spark, 20);
      const high20 = q.spark.length >= 20 ? Math.max(...q.spark.slice(-20)) : null;

      let setup = "Watching";
      if (high20 && q.last > high20) setup = "Breakout";
      else if (volX && volX >= 2.5) setup = "Volume spike";
      else if (ma20 && q.last > ma20 && q.changePct > 0) setup = "Trend pullback";
      else if (ma20 && q.last < ma20 && q.changePct < 0) setup = "Below trend";
      else if (ma20) setup = "Base";

      return {
        symbol: q.symbol,
        company: q.name,
        last: q.last,
        change: q.change,
        changePct: q.changePct,
        volX,
        rsi: a?.rsi ?? rsi(q.spark),
        score: a?.score ?? null,
        setup,
        stale: q.stale === true,
        spark: q.spark,
      };
    })
    .sort((a, b) => b.changePct - a.changePct);
}

export type ScanRow = ReturnType<typeof buildScanRows>[number];
