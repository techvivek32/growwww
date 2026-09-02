/**
 * Phase-1 fixtures. Deliberately deterministic: every series is generated
 * from a fixed seed so server and client render byte-identical markup and
 * React never reports a hydration mismatch.
 *
 * Everything here is replaced by `src/lib/api/groww.ts` in Phase 2 — the
 * shapes below are the contract that adapter has to satisfy.
 */

/** Linear congruential walk. Same seed always yields the same path. */
function series(seed: number, n = 26, drift = 0): number[] {
  const out: number[] = [];
  let v = 100;
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out.push(Number(v.toFixed(2)));
    v += (s / 2147483648 - 0.5) * 3.2 + drift;
  }
  return out;
}

/* ------------------------------------------------------------------ indices */

export interface IndexQuote {
  symbol: string;
  name: string;
  last: number;
  change: number;
  changePct: number;
  spark: number[];
}

export const INDICES: IndexQuote[] = [
  { symbol: "NIFTY", name: "NIFTY 50", last: 23914.45, change: -141.35, changePct: -0.59, spark: series(11, 26, -0.18) },
  { symbol: "SENSEX", name: "S&P BSE SENSEX", last: 76570.35, change: -373.93, changePct: -0.49, spark: series(23, 26, -0.15) },
  { symbol: "BANKNIFTY", name: "NIFTY Bank", last: 57172.0, change: -237.6, changePct: -0.41, spark: series(37, 26, -0.12) },
  { symbol: "MIDCPNIFTY", name: "NIFTY Midcap", last: 14663.65, change: -149.7, changePct: -1.01, spark: series(41, 26, -0.3) },
  { symbol: "FINNIFTY", name: "NIFTY Fin Serv", last: 25813.0, change: -96.4, changePct: -0.37, spark: series(53, 26, -0.11) },
];

/* ------------------------------------------------------------- stock alerts */

export interface StockAlert {
  symbol: string;
  company: string;
  score: number;
  timeframe: string;
  last: number;
  entry: number;
  target: number;
  stop: number;
  rr: number;
  rsi: number;
  volX: number;
  tags: string[];
  news?: { tone: "Bullish" | "Bearish" | "Neutral"; headline: string; source: string };
  spark: number[];
}

export const STOCK_ALERTS: StockAlert[] = [
  {
    symbol: "COALINDIA", company: "Coal India", score: 96, timeframe: "15m",
    last: 417.85, entry: 415.4, target: 431.2, stop: 408.6, rr: 1.9, rsi: 68, volX: 4.1,
    tags: ["Strong uptrend (ADX 31)", "Volume 4.1x average", "Breaking out", "Fresh upward momentum"],
    news: { tone: "Bullish", headline: "Coal India hits 52-week high as e-auction realisations beat estimates", source: "Mint" },
    spark: series(101, 26, 0.42),
  },
  {
    symbol: "TATAPOWER", company: "Tata Power", score: 93, timeframe: "15m",
    last: 364.0, entry: 361.5, target: 376.8, stop: 355.2, rr: 2.4, rsi: 64, volX: 3.2,
    tags: ["Above 20/50 EMA", "Volume 3.2x average", "Higher lows"],
    news: { tone: "Bullish", headline: "Tata Power commissions 200 MW solar capacity in Rajasthan", source: "Business Standard" },
    spark: series(107, 26, 0.36),
  },
  {
    symbol: "SOLARINDS", company: "Solar Industries India", score: 91, timeframe: "1h",
    last: 20600.0, entry: 20480.0, target: 21340.0, stop: 20120.0, rr: 2.4, rsi: 61, volX: 2.2,
    tags: ["Defence order flow", "Breaking out", "Low float"],
    spark: series(113, 26, 0.4),
  },
  {
    symbol: "ADANIGREEN", company: "Adani Green Energy", score: 88, timeframe: "15m",
    last: 1296.0, entry: 1288.0, target: 1341.0, stop: 1266.0, rr: 2.4, rsi: 59, volX: 2.8,
    tags: ["Volume 2.8x average", "Reclaimed VWAP"],
    spark: series(127, 26, 0.3),
  },
  {
    symbol: "IFCI", company: "IFCI", score: 85, timeframe: "5m",
    last: 98.32, entry: 97.6, target: 104.2, stop: 94.8, rr: 2.4, rsi: 74, volX: 6.4,
    tags: ["Volume 6.4x average", "Momentum spike", "RSI hot"],
    spark: series(131, 26, 0.55),
  },
  {
    symbol: "CENTURYENKA", company: "Century Enka", score: 82, timeframe: "15m",
    last: 602.35, entry: 598.0, target: 631.0, stop: 583.5, rr: 2.3, rsi: 71, volX: 5.1,
    tags: ["Breaking out", "Volume 5.1x average"],
    spark: series(137, 26, 0.48),
  },
  {
    symbol: "HINDALCO", company: "Hindalco Industries", score: 79, timeframe: "1h",
    last: 682.4, entry: 679.0, target: 704.5, stop: 667.2, rr: 2.2, rsi: 57, volX: 1.8,
    tags: ["LME tailwind", "Above 50 EMA"],
    spark: series(139, 26, 0.22),
  },
  {
    symbol: "PERSISTENT", company: "Persistent Systems", score: 76, timeframe: "1h",
    last: 5842.0, entry: 5810.0, target: 6015.0, stop: 5712.0, rr: 2.1, rsi: 55, volX: 1.5,
    tags: ["Sector rotation into IT", "Higher lows"],
    spark: series(149, 26, 0.2),
  },
];

/* --------------------------------------------------------------- F&O alerts */

export interface FnoAlert {
  underlying: string;
  strike: number;
  right: "CE" | "PE";
  expiry: string;
  lotSize: number;
  lots: number;
  premium: number;
  entry: number;
  target: number;
  stop: number;
  iv: number;
  oiChangePct: number;
  score: number;
  rationale: string;
  spark: number[];
}

export const FNO_ALERTS: FnoAlert[] = [
  {
    underlying: "NIFTY", strike: 24000, right: "CE", expiry: "04 Sep", lotSize: 75, lots: 2,
    premium: 84.5, entry: 82.0, target: 118.0, stop: 64.0, iv: 12.4, oiChangePct: 18.2, score: 89,
    rationale: "Index reclaiming VWAP with call writers unwinding at 24000.",
    spark: series(211, 26, 0.5),
  },
  {
    underlying: "BANKNIFTY", strike: 57000, right: "PE", expiry: "04 Sep", lotSize: 35, lots: 2,
    premium: 212.0, entry: 205.0, target: 298.0, stop: 158.0, iv: 15.1, oiChangePct: 24.6, score: 87,
    rationale: "Bank index rejected 57500 twice; put OI building one strike below spot.",
    spark: series(223, 26, 0.6),
  },
  {
    underlying: "NIFTY", strike: 23800, right: "PE", expiry: "04 Sep", lotSize: 75, lots: 1,
    premium: 61.0, entry: 59.5, target: 88.0, stop: 45.0, iv: 12.9, oiChangePct: 11.4, score: 81,
    rationale: "Hedge leg — pairs with the 24000 CE for a defined-risk strangle.",
    spark: series(227, 26, 0.35),
  },
  {
    underlying: "FINNIFTY", strike: 25800, right: "CE", expiry: "09 Sep", lotSize: 65, lots: 1,
    premium: 148.0, entry: 144.0, target: 205.0, stop: 112.0, iv: 13.8, oiChangePct: 9.8, score: 77,
    rationale: "Financials basing above 20 EMA; IV in the lower third of its 30-day range.",
    spark: series(229, 26, 0.3),
  },
];

/* -------------------------------------------------------------- option chain */

export interface ChainRow {
  strike: number;
  ceOi: number; ceOiChg: number; ceIv: number; ceLtp: number; ceChg: number;
  peOi: number; peOiChg: number; peIv: number; peLtp: number; peChg: number;
}

export const CHAIN_SPOT = 23914.45;
export const CHAIN_EXPIRY = "04 Sep 2026";
export const CHAIN_LOT = 75;

export const OPTION_CHAIN: ChainRow[] = [
  { strike: 23600, ceOi: 18.4, ceOiChg: -6.2, ceIv: 15.1, ceLtp: 358.2, ceChg: -8.4, peOi: 42.1, peOiChg: 14.2, peIv: 14.2, peLtp: 28.6, peChg: 12.1 },
  { strike: 23700, ceOi: 22.8, ceOiChg: -4.8, ceIv: 14.6, ceLtp: 279.5, ceChg: -9.1, peOi: 51.3, peOiChg: 18.9, peIv: 13.8, peLtp: 41.2, peChg: 15.4 },
  { strike: 23800, ceOi: 31.5, ceOiChg: -2.1, ceIv: 13.9, ceLtp: 208.4, ceChg: -10.2, peOi: 68.7, peOiChg: 21.4, peIv: 13.4, peLtp: 61.0, peChg: 18.7 },
  { strike: 23900, ceOi: 44.2, ceOiChg: 3.6, ceIv: 13.2, ceLtp: 148.9, ceChg: -11.8, peOi: 74.9, peOiChg: 16.2, peIv: 12.9, peLtp: 92.4, peChg: 22.3 },
  { strike: 24000, ceOi: 92.6, ceOiChg: 18.2, ceIv: 12.4, ceLtp: 84.5, ceChg: -14.6, peOi: 66.4, peOiChg: 8.1, peIv: 12.6, peLtp: 138.7, peChg: 26.1 },
  { strike: 24100, ceOi: 61.3, ceOiChg: 22.9, ceIv: 12.1, ceLtp: 52.8, ceChg: -17.2, peOi: 38.2, peOiChg: 4.4, peIv: 12.8, peLtp: 201.5, peChg: 29.4 },
  { strike: 24200, ceOi: 55.8, ceOiChg: 19.4, ceIv: 12.0, ceLtp: 31.4, ceChg: -19.8, peOi: 24.6, peOiChg: 1.8, peIv: 13.1, peLtp: 279.0, peChg: 31.8 },
  { strike: 24300, ceOi: 38.1, ceOiChg: 12.6, ceIv: 12.2, ceLtp: 18.2, ceChg: -22.4, peOi: 15.9, peOiChg: -1.2, peIv: 13.6, peLtp: 366.4, peChg: 33.2 },
  { strike: 24400, ceOi: 26.4, ceOiChg: 8.1, ceIv: 12.6, ceLtp: 10.1, ceChg: -24.9, peOi: 10.2, peOiChg: -3.4, peIv: 14.2, peLtp: 459.8, peChg: 34.6 },
];

/* ----------------------------------------------------------------- holdings */

export interface Holding {
  symbol: string; company: string; qty: number; avg: number; ltp: number; dayPct: number;
}

export const HOLDINGS: Holding[] = [
  { symbol: "RELIANCE", company: "Reliance Industries", qty: 24, avg: 2812.4, ltp: 2904.6, dayPct: 0.82 },
  { symbol: "HDFCBANK", company: "HDFC Bank", qty: 40, avg: 1642.0, ltp: 1598.3, dayPct: -0.64 },
  { symbol: "INFY", company: "Infosys", qty: 55, avg: 1481.2, ltp: 1552.8, dayPct: 1.21 },
  { symbol: "TATAMOTORS", company: "Tata Motors", qty: 80, avg: 912.5, ltp: 874.9, dayPct: -1.42 },
  { symbol: "ITC", company: "ITC", qty: 150, avg: 412.8, ltp: 438.2, dayPct: 0.36 },
  { symbol: "LT", company: "Larsen & Toubro", qty: 18, avg: 3298.0, ltp: 3412.5, dayPct: 0.58 },
];

/* ---------------------------------------------------------------- positions */

export interface Position {
  symbol: string; product: "MIS" | "CNC" | "NRML"; qty: number; avg: number; ltp: number; side: "BUY" | "SELL";
}

export const POSITIONS: Position[] = [
  { symbol: "COALINDIA", product: "MIS", qty: 200, avg: 415.4, ltp: 417.85, side: "BUY" },
  { symbol: "TATAPOWER", product: "MIS", qty: 300, avg: 361.5, ltp: 364.0, side: "BUY" },
  { symbol: "NIFTY 24000 CE", product: "NRML", qty: 150, avg: 82.0, ltp: 84.5, side: "BUY" },
  { symbol: "BANKNIFTY 57000 PE", product: "NRML", qty: 70, avg: 205.0, ltp: 212.0, side: "BUY" },
];

/* ------------------------------------------------------------------- orders */

export interface Order {
  id: string; time: string; symbol: string; side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "SL" | "SL_M"; product: "MIS" | "CNC" | "NRML";
  qty: number; filled: number; price: number | null; avg: number | null;
  status: "COMPLETE" | "OPEN" | "REJECTED" | "CANCELLED" | "TRIGGER PENDING";
  note?: string;
}

export const ORDERS: Order[] = [
  { id: "GW250902-0091", time: "09:21:14", symbol: "COALINDIA", side: "BUY", type: "LIMIT", product: "MIS", qty: 200, filled: 200, price: 415.4, avg: 415.4, status: "COMPLETE" },
  { id: "GW250902-0104", time: "09:24:02", symbol: "TATAPOWER", side: "BUY", type: "MARKET", product: "MIS", qty: 300, filled: 300, price: null, avg: 361.5, status: "COMPLETE" },
  { id: "GW250902-0118", time: "09:31:47", symbol: "NIFTY 24000 CE", side: "BUY", type: "LIMIT", product: "NRML", qty: 150, filled: 150, price: 82.0, avg: 82.0, status: "COMPLETE" },
  { id: "GW250902-0126", time: "09:33:10", symbol: "COALINDIA", side: "SELL", type: "SL_M", product: "MIS", qty: 200, filled: 0, price: 408.6, avg: null, status: "TRIGGER PENDING", note: "GTT stop-loss leg" },
  { id: "GW250902-0127", time: "09:33:10", symbol: "COALINDIA", side: "SELL", type: "LIMIT", product: "MIS", qty: 200, filled: 0, price: 431.2, avg: null, status: "OPEN", note: "GTT target leg (OCO)" },
  { id: "GW250902-0140", time: "10:02:55", symbol: "ADANIGREEN", side: "BUY", type: "LIMIT", product: "MIS", qty: 100, filled: 0, price: 1288.0, avg: null, status: "OPEN" },
  { id: "GW250902-0151", time: "10:14:31", symbol: "IFCI", side: "BUY", type: "MARKET", product: "MIS", qty: 500, filled: 0, price: null, avg: null, status: "REJECTED", note: "Insufficient margin" },
  { id: "GW250902-0158", time: "10:41:09", symbol: "HINDALCO", side: "BUY", type: "LIMIT", product: "CNC", qty: 50, filled: 0, price: 679.0, avg: null, status: "CANCELLED" },
];

/* ------------------------------------------------------------------ history */

export interface Trade {
  date: string; symbol: string; side: "BUY" | "SELL"; qty: number;
  entry: number; exit: number; pnl: number; charges: number; holdMins: number;
}

export const TRADES: Trade[] = [
  { date: "01 Sep", symbol: "BAJFINANCE", side: "BUY", qty: 40, entry: 7112.0, exit: 7204.5, pnl: 3700.0, charges: 62.4, holdMins: 184 },
  { date: "01 Sep", symbol: "SBIN", side: "BUY", qty: 300, entry: 812.4, exit: 806.2, pnl: -1860.0, charges: 48.1, holdMins: 96 },
  { date: "29 Aug", symbol: "INFY", side: "BUY", qty: 120, entry: 1502.0, exit: 1541.8, pnl: 4776.0, charges: 71.2, holdMins: 232 },
  { date: "29 Aug", symbol: "TATASTEEL", side: "BUY", qty: 800, entry: 148.6, exit: 146.9, pnl: -1360.0, charges: 39.8, holdMins: 61 },
  { date: "28 Aug", symbol: "ICICIBANK", side: "BUY", qty: 150, entry: 1204.0, exit: 1228.4, pnl: 3660.0, charges: 58.6, holdMins: 175 },
  { date: "28 Aug", symbol: "MARUTI", side: "BUY", qty: 12, entry: 12440.0, exit: 12602.0, pnl: 1944.0, charges: 44.2, holdMins: 143 },
  { date: "27 Aug", symbol: "WIPRO", side: "BUY", qty: 400, entry: 286.5, exit: 282.1, pnl: -1760.0, charges: 36.9, holdMins: 78 },
  { date: "26 Aug", symbol: "AXISBANK", side: "BUY", qty: 180, entry: 1094.0, exit: 1118.6, pnl: 4428.0, charges: 61.0, holdMins: 208 },
  { date: "26 Aug", symbol: "HINDALCO", side: "BUY", qty: 250, entry: 668.2, exit: 681.4, pnl: 3300.0, charges: 52.8, holdMins: 166 },
  { date: "25 Aug", symbol: "ONGC", side: "BUY", qty: 600, entry: 248.9, exit: 246.2, pnl: -1620.0, charges: 41.5, holdMins: 54 },
  { date: "22 Aug", symbol: "TITAN", side: "BUY", qty: 45, entry: 3388.0, exit: 3441.5, pnl: 2407.5, charges: 49.7, holdMins: 191 },
  { date: "22 Aug", symbol: "SUNPHARMA", side: "BUY", qty: 100, entry: 1782.0, exit: 1808.9, pnl: 2690.0, charges: 46.3, holdMins: 154 },
];

/** Daily realised P&L, oldest first — drives the Analysis bar chart. */
export const DAILY_PNL: { day: string; pnl: number }[] = [
  { day: "11 Aug", pnl: 840 }, { day: "12 Aug", pnl: 1260 }, { day: "13 Aug", pnl: -520 },
  { day: "14 Aug", pnl: 2140 }, { day: "18 Aug", pnl: 1680 }, { day: "19 Aug", pnl: -980 },
  { day: "20 Aug", pnl: 3210 }, { day: "21 Aug", pnl: 460 }, { day: "22 Aug", pnl: 5097 },
  { day: "25 Aug", pnl: -1620 }, { day: "26 Aug", pnl: 7728 }, { day: "27 Aug", pnl: -1760 },
  { day: "28 Aug", pnl: 5604 }, { day: "29 Aug", pnl: 3416 }, { day: "01 Sep", pnl: 1840 },
];

/* ------------------------------------------------------------------ scanner */

export interface ScanRow {
  symbol: string; company: string; last: number; changePct: number;
  volX: number; rsi: number; adx: number; setup: string; sector: string;
}

export const SCAN_ROWS: ScanRow[] = [
  { symbol: "COALINDIA", company: "Coal India", last: 417.85, changePct: 4.05, volX: 4.1, rsi: 68, adx: 31, setup: "Breakout", sector: "Energy" },
  { symbol: "TATAPOWER", company: "Tata Power", last: 364.0, changePct: 3.84, volX: 3.2, rsi: 64, adx: 27, setup: "Trend pullback", sector: "Power" },
  { symbol: "SOLARINDS", company: "Solar Industries", last: 20600.0, changePct: 2.69, volX: 2.2, rsi: 61, adx: 24, setup: "Breakout", sector: "Defence" },
  { symbol: "ADANIGREEN", company: "Adani Green Energy", last: 1296.0, changePct: 2.45, volX: 2.8, rsi: 59, adx: 22, setup: "VWAP reclaim", sector: "Power" },
  { symbol: "IFCI", company: "IFCI", last: 98.32, changePct: 12.67, volX: 6.4, rsi: 74, adx: 38, setup: "Momentum", sector: "Financials" },
  { symbol: "CENTURYENKA", company: "Century Enka", last: 602.35, changePct: 10.71, volX: 5.1, rsi: 71, adx: 34, setup: "Breakout", sector: "Textiles" },
  { symbol: "HINDALCO", company: "Hindalco Industries", last: 682.4, changePct: 1.62, volX: 1.8, rsi: 57, adx: 19, setup: "Trend pullback", sector: "Metals" },
  { symbol: "PERSISTENT", company: "Persistent Systems", last: 5842.0, changePct: 1.28, volX: 1.5, rsi: 55, adx: 18, setup: "Base", sector: "IT" },
  { symbol: "DIXON", company: "Dixon Technologies", last: 14820.0, changePct: 1.04, volX: 1.3, rsi: 53, adx: 17, setup: "Base", sector: "Electronics" },
  { symbol: "BEL", company: "Bharat Electronics", last: 312.6, changePct: 0.92, volX: 1.2, rsi: 52, adx: 16, setup: "Trend pullback", sector: "Defence" },
];

/* ---------------------------------------------------------------- watchlist */

export interface WatchRow {
  symbol: string; company: string; last: number; change: number; changePct: number; spark: number[];
}

export const WATCHLIST: WatchRow[] = [
  { symbol: "RELIANCE", company: "Reliance Industries", last: 2904.6, change: 23.6, changePct: 0.82, spark: series(301, 26, 0.2) },
  { symbol: "HDFCBANK", company: "HDFC Bank", last: 1598.3, change: -10.3, changePct: -0.64, spark: series(307, 26, -0.2) },
  { symbol: "INFY", company: "Infosys", last: 1552.8, change: 18.6, changePct: 1.21, spark: series(311, 26, 0.3) },
  { symbol: "TCS", company: "Tata Consultancy", last: 4128.4, change: -14.2, changePct: -0.34, spark: series(313, 26, -0.1) },
  { symbol: "ITC", company: "ITC", last: 438.2, change: 1.6, changePct: 0.36, spark: series(317, 26, 0.1) },
  { symbol: "TATAMOTORS", company: "Tata Motors", last: 874.9, change: -12.6, changePct: -1.42, spark: series(331, 26, -0.35) },
  { symbol: "SBIN", company: "State Bank of India", last: 806.2, change: -6.2, changePct: -0.76, spark: series(337, 26, -0.22) },
  { symbol: "LT", company: "Larsen & Toubro", last: 3412.5, change: 19.7, changePct: 0.58, spark: series(347, 26, 0.18) },
];

/* ------------------------------------------------------------------ account */

export const ACCOUNT = {
  name: "Vivek Hemantbhai Vora",
  broker: "Groww",
  balance: 94101.18,
  usedMargin: 38420.0,
  scannedSymbols: 187,
  lastScanMins: 12,
};
