// Consistency audit for the trade book. Recomputes every published figure
// from TRADES alone and fails loudly on any disagreement.
import * as B from "./src/lib/book.ts";


let fails = 0;
const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function check(name: string, got: number, want: number, tol = 0.02) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(42)} got ${inr(got).padStart(14)}  want ${inr(want).padStart(14)}`);
}

function flag(name: string, ok: boolean, detail = "") {
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

console.log("\n=== TRADE BOOK ===");
console.log(`trades ${B.TRADES.length} · sessions ${B.SESSIONS.length} · capital ₹${inr(B.OPENING_CAPITAL)}\n`);

// 1. totals recomputed independently
const gross = B.TRADES.reduce((s, t) => s + (t.exit - t.entry) * t.qty * (t.side === "BUY" ? 1 : -1), 0);
const charges = B.TRADES.reduce((s, t) => s + t.charges, 0);
check("gross = Σ (exit-entry)×qty×dir", B.TOTAL_GROSS, gross);
check("charges = Σ t.charges", B.TOTAL_CHARGES, charges);
check("net = gross - charges", B.TOTAL_NET, gross - charges);
check("closing = capital + net", B.CLOSING_BALANCE, B.OPENING_CAPITAL + (gross - charges));
check("return % = net / capital", B.RETURN_PCT, ((gross - charges) / B.OPENING_CAPITAL) * 100, 0.01);
check("ACCOUNT.balance = closing", B.ACCOUNT.balance, B.CLOSING_BALANCE);

console.log("\n=== SESSION ROLL-UP ===");
const sGross = B.BY_SESSION.reduce((s, r) => s + r.gross, 0);
const sNet = B.BY_SESSION.reduce((s, r) => s + r.net, 0);
const sChg = B.BY_SESSION.reduce((s, r) => s + r.charges, 0);
check("Σ session gross = total gross", sGross, B.TOTAL_GROSS);
check("Σ session charges = total charges", sChg, B.TOTAL_CHARGES);
check("Σ session net = total net", sNet, B.TOTAL_NET);
for (const r of B.BY_SESSION) {
  check(`  ${r.day} net = gross - charges`, r.net, r.gross - r.charges);
}

console.log("\n=== SYMBOL ROLL-UP ===");
check("Σ symbol net = total net", B.BY_SYMBOL.reduce((s, r) => s + r.net, 0), B.TOTAL_NET);
flag(
  "symbol trade counts sum to book",
  B.BY_SYMBOL.reduce((s, r) => s + r.trades, 0) === B.TRADES.length,
);

console.log("\n=== WIN / LOSS ===");
flag("wins + losses = trades", B.WINS.length + B.LOSSES.length === B.TRADES.length);
check("win rate", B.WIN_RATE, Math.round((B.WINS.length / B.TRADES.length) * 100), 0.51);
check("best trade is max net", B.netPnl(B.BEST_TRADE), Math.max(...B.TRADES.map(B.netPnl)));
check("worst trade is min net", B.netPnl(B.WORST_TRADE), Math.min(...B.TRADES.map(B.netPnl)));

console.log("\n=== ORDERS ===");
const complete = B.ORDERS.filter((o) => o.status === "COMPLETE");
const todayTrades = B.TRADES.filter((t) => t.date === B.TODAY.date);
flag(
  "every today trade has an entry + exit order",
  complete.length >= todayTrades.length * 2,
  `${complete.length} complete vs ${todayTrades.length} trades`,
);
for (const t of todayTrades) {
  const legs = B.ORDERS.filter((o) => o.symbol === t.symbol && o.status === "COMPLETE");
  const entryLeg = legs.find((o) => o.avg !== null && Math.abs(o.avg - t.entry) < 0.011);
  const exitLeg = legs.find((o) => o.avg !== null && Math.abs(o.avg - t.exit) < 0.011);
  flag(`  ${t.symbol} entry+exit orders match trade prices`, !!entryLeg && !!exitLeg);
  if (entryLeg) flag(`  ${t.symbol} entry qty`, entryLeg.qty === t.qty, `${entryLeg.qty} vs ${t.qty}`);
}

console.log("\n=== POSITIONS (today) ===");
check("Σ position realised = today net", B.POSITIONS.reduce((s, p) => s + p.realised, 0), B.TODAY_NET);
check("today gross - charges = today net", B.TODAY_NET, B.TODAY_GROSS - B.TODAY_CHARGES);

console.log("\n=== PLAUSIBILITY ===");
// charges: intraday equity all-in is roughly 0.03%-0.15% of turnover
for (const t of B.TRADES) {
  const to = (t.entry + t.exit) * t.qty;
  const bps = (t.charges / to) * 10000;
  flag(`  ${t.id} ${t.symbol.padEnd(11)} charges ${bps.toFixed(1)} bps of turnover`, bps > 2 && bps < 20);
}

// Every fill must sit inside that session's real traded range. Bars are
// pulled live from Yahoo rather than from the snapshot, which stores only
// quotes — this is the check that keeps the book honest.
console.log("\n=== FILLS INSIDE THE REAL TRADED RANGE ===");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

async function bars(sym: string) {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${sym}.NS?interval=1d&range=1mo`,
    { headers: { "User-Agent": UA } },
  );
  const j = (await r.json()) as {
    chart: { result: [{ timestamp: number[]; indicators: { quote: [{ low: (number | null)[]; high: (number | null)[] }] } }] };
  };
  const res = j.chart.result[0];
  const q = res.indicators.quote[0];
  const out = new Map<string, { l: number; h: number }>();
  res.timestamp.forEach((ts: number, i: number) => {
    const l = q.low[i], h = q.high[i];
    if (typeof l === "number" && typeof h === "number") {
      out.set(new Date(ts * 1000).toISOString().slice(0, 10), { l: +l.toFixed(2), h: +h.toFixed(2) });
    }
  });
  return out;
}

const barCache = new Map<string, Map<string, { l: number; h: number }>>();
for (const sym of new Set(B.TRADES.map((t) => t.symbol))) {
  barCache.set(sym, await bars(sym));
}

for (const t of B.TRADES) {
  const bar = barCache.get(t.symbol)?.get(t.date);
  if (!bar) {
    flag(`  ${t.id} ${t.symbol} has a real bar for ${t.date}`, false);
    continue;
  }
  const inRange = (p: number) => p >= bar.l - 0.011 && p <= bar.h + 0.011;
  flag(
    `  ${t.id} ${t.symbol.padEnd(11)} ${t.entry}/${t.exit} inside ${bar.l}–${bar.h}`,
    inRange(t.entry) && inRange(t.exit),
  );
}

// MIS margin: position value must stay inside ~5x the capital available that day
console.log("\n=== MIS MARGIN (5x) ===");
let running = B.OPENING_CAPITAL;
for (const s of B.SESSIONS) {
  const dayTrades = B.TRADES.filter((t) => t.date === s.date);
  const peak = dayTrades.reduce((m, t) => Math.max(m, t.entry * t.qty), 0);
  const limit = running * 5;
  flag(
    `  ${s.day} peak position ₹${inr(peak)} within 5x ₹${inr(running)}`,
    peak <= limit + 1,
  );
  running += dayTrades.reduce((sum, t) => sum + B.netPnl(t), 0);
}

console.log(`\n${fails === 0 ? "PASS — every published number reconciles" : `${fails} FAILURE(S)`}\n`);
process.exit(fails === 0 ? 0 : 1);
