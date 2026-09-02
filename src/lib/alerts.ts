import type { Quote } from "./api/yahoo";

/**
 * Turns real NSE quotes into buy setups.
 *
 * Nothing here is invented: the score, the stop distance and every tag are
 * computed from the day's real range, the real volume against its 20-session
 * average, and the real 30-day close series. Change the market data and the
 * setups change with it.
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
  stop: number;
  rr: number;
  rsi: number;
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

/** Wilder's RSI over the daily closes we have. */
function rsi(series: number[], period = 14): number | null {
  if (series.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = series.length - period; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  if (gain + loss === 0) return 50;
  return Math.round((gain / (gain + loss)) * 100);
}

export function buildAlert(q: Quote): StockAlert | null {
  const { last, dayHigh, dayLow, spark } = q;
  if (!last || spark.length < 5) return null;

  const hi = dayHigh ?? last;
  const lo = dayLow ?? last;
  const range = Math.max(hi - lo, last * 0.006);

  const volX = q.avgVolume && q.volume ? +(q.volume / q.avgVolume).toFixed(1) : null;
  const ma20 = sma(spark, 20);
  const ma10 = sma(spark, 10);
  const high20 = Math.max(...spark.slice(-20));
  const rsiVal = rsi(spark) ?? 50;

  /* Score: momentum, participation, and where the close sits in the range. */
  const closePos = (last - lo) / (hi - lo || 1); // 1 = closed on the high
  const score = Math.round(
    clamp(
      46 +
        q.changePct * 4.2 +
        Math.min(volX ?? 1, 6) * 3.4 +
        closePos * 12 +
        (ma20 && last > ma20 ? 5 : -6),
      35,
      98,
    ),
  );

  /* Risk is the day's own volatility, floored so a quiet stock still has room. */
  const risk = +Math.max(range * 0.55, last * 0.011).toFixed(2);
  const rr = +(1.7 + score / 140).toFixed(1);

  const entry = +last.toFixed(2);
  const stop = +(entry - risk).toFixed(2);
  const target = +(entry + risk * rr).toFixed(2);

  const tags: string[] = [];
  if (volX && volX >= 1.5) tags.push(`Volume ${volX.toFixed(1)}x average`);
  if (last >= high20 * 0.999) tags.push("20-day breakout");
  if (closePos >= 0.85) tags.push("Closed at the day's high");
  if (ma20 && ma10 && ma10 > ma20 && last > ma10) tags.push("Above 10 & 20 DMA");
  else if (ma20 && last > ma20) tags.push("Above 20 DMA");
  if (q.changePct >= 2) tags.push("Fresh upward momentum");
  if (rsiVal >= 70) tags.push(`RSI ${rsiVal} — extended`);

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
      if (high20 && q.last >= high20 * 0.999) setup = "Breakout";
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
        rsi: a?.rsi ?? rsi(q.spark) ?? 50,
        score: a?.score ?? 0,
        setup,
        spark: q.spark,
      };
    })
    .sort((a, b) => b.changePct - a.changePct);
}

export type ScanRow = ReturnType<typeof buildScanRows>[number];
