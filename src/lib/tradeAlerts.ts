import "server-only";
import { randomBytes } from "node:crypto";
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { notifyAdmin, type NotifTone } from "@/lib/notifications";
import type { LiveToday } from "@/lib/research";

/**
 * Stock alerts for the admin during the live market. The owner asked for this on 27 Nov 2026: "no auto trade, only
 * alerts about stocks daily in the live market". Nothing in this file places, changes or cancels an order. It only
 * reads, and tells.
 *
 * Two kinds:
 *  - Book A's signals, read from the research box's /live/today:
 *      the 09:20 short, or a regime-skip day;
 *      the market stop;
 *      the 10:15 flip, or no flip;
 *      the 15:15 square-off.
 *    Each carries the price and about how many shares the ₹ base (on /admin/live) buys.
 *  - Watchlist moves: a stock in any of the watchlists 2%, 3% or 5% away from yesterday's close. Each level fires once a
 *    day per direction, and only the highest level reached is sent, so a jump straight to 5% sends one alert, not three.
 *
 * Automatic or by hand: while Automatic trading opens or holds a leg (`auto`), its alerts say so ("(automatic) …
 *   no action needed"), so nobody trades by hand what the executor already does. Without that, a SELL by hand next to
 *   the executor's own exit would leave a fresh short.
 * Every alert is written to data/trade-alerts.json, which the /admin/alerts page lists. It is also sent to the admin with
 * notifyAdmin, which puts it in the notification feed and on the admin's phone, as an urgent push.
 * - No repeats: each alert has a key, so neither a retry nor a restart sends it twice.
 * - Nothing late: a Book A alert is sent only within 20 minutes of the event. A restart after the event never delivers
 *   a stale "SELL now".
 *
 * The loop runs every 15 s on trading days from 09:14 to 15:35 IST, separately from the live-trading executor. A slow read
 * here can never delay an order there.
 */

export type AlertKind = "bookA" | "watch";

export interface TradeAlert {
  id: string;
  /** Epoch ms. */
  at: number;
  /** IST date, YYYY-MM-DD. */
  date: string;
  kind: AlertKind;
  tone: NotifTone;
  symbol: string | null;
  title: string;
  body: string;
  key: string;
}

export type AlertDraft = Omit<TradeAlert, "id" | "at">;

interface Store {
  items: TradeAlert[];
  /** "date|SYMBOL|up|down" → the highest watchlist level already sent that day. */
  watch: Record<string, number>;
}

/** A Book A alert older than this (seconds) is never sent: it would be a stale instruction. */
export const FRESH_S = 20 * 60;
/** Watchlist levels, % from yesterday's close. */
export const WATCH_LEVELS = [2, 3, 5];
const MAX_ITEMS = 3000;

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** IST date and minute of the day (with seconds as a fraction) of an epoch-ms instant. */
export function istClock(ms: number): { date: string; minute: number } {
  const d = new Date(ms + 19_800_000);
  return { date: d.toISOString().slice(0, 10), minute: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 };
}

/** What Automatic trading does itself today. `open`: it opens Book A's legs (the switch is LIVE). `short` / `long`: it
 *  holds or will hold that leg, so it also closes it (the executor closes a leg it opened even after the switch goes OFF). */
export interface AutoState {
  open: boolean;
  short: boolean;
  long: boolean;
}
export const NO_AUTO: AutoState = { open: false, short: false, long: false };
const AUTO_NOTE = " Automatic trading does this itself: no action needed (don't also trade it by hand).";

/** The Book A alerts that today's decisions call for at `nowMs`. Pure: the caller records them and drops repeats. */
export function bookADrafts(lt: LiveToday, base: number, nowMs: number, auto: AutoState = NO_AUTO): AlertDraft[] {
  const { date, minute } = istClock(nowMs);
  if (lt.date !== date) return [];
  const now = nowMs / 1000;
  const fresh = (at: number | null | undefined) => at != null && now - at <= FRESH_S && now >= at - 60;
  const key = (s: string) => `A|${date}|${s}`;
  const out: Omit<AlertDraft, "date" | "kind">[] = [];
  const pick = lt.pick;
  const px = lt.pick_px;
  const traded = !!pick && px != null && px > 0 && lt.skip === false && !lt.late;

  if (lt.skip === true && fresh(lt.decided_at)) {
    out.push({
      key: key("skip"),
      tone: "neutral",
      symbol: null,
      title: "Book A: no trade today",
      body: "Regime skip day: the rule sits out today (at least two of: a strong NIFTY gap, broad first-bar strength, a Monday).",
    });
  }
  if (traded && fresh(lt.decided_at)) {
    out.push({
      key: key("entry"),
      tone: "down",
      symbol: pick,
      title: `SELL ${pick} @ ${rs(px)}${auto.open ? " (automatic)" : ""}`,
      body:
        `Book A, 09:20: short about ${Math.floor(base / px).toLocaleString("en-IN")} shares (${rupees(base)}), intraday (MIS). ` +
        `Cover if the market rises ${(lt.mstop_at * 100).toFixed(1)}% from 09:20, at 10:15 on a flip day, otherwise at 15:15.` +
        (auto.open ? AUTO_NOTE : ""),
    });
  }
  if (traded && lt.mstop && fresh(lt.mstop.at)) {
    const mv = lt.mstop.move != null ? ` ${(lt.mstop.move * 100).toFixed(2)}%` : "";
    out.push({
      key: key("mstop"),
      tone: "warn",
      symbol: pick,
      title: `COVER ${pick} now (market stop)${auto.short ? " (automatic)" : ""}`,
      body: `The average stock is up${mv} since 09:20: Book A covers the ${pick} short here.` + (auto.short ? AUTO_NOTE : ""),
    });
  }
  if (traded && lt.flip && fresh(lt.flip.at)) {
    const f = lt.flip;
    if (f.do) {
      const coverNote = lt.mstop ? ` (the ${pick} short is already covered by the market stop)` : `: cover the ${pick} short`;
      const both = (lt.mstop || auto.short) && auto.open;
      const who = both
        ? AUTO_NOTE
        : auto.short && !lt.mstop
          ? " Automatic trading covers the short itself; the BUY is yours to place."
          : "";
      out.push(
        f.symbol && f.px
          ? {
              key: key("flip"),
              tone: "up",
              symbol: f.symbol,
              title: `COVER ${pick}, BUY ${f.symbol} @ ${rs(f.px)}${both ? " (automatic)" : ""}`,
              body:
                `10:15 flip, the market is strong${coverNote}, and buy about ${Math.floor(base / f.px).toLocaleString("en-IN")} ` +
                `${f.symbol} (${rupees(base)}), held to 15:15.` +
                who,
            }
          : {
              key: key("flip"),
              tone: "warn",
              symbol: pick,
              title: `COVER ${pick} (10:15 flip)${auto.short && !lt.mstop ? " (automatic)" : ""}`,
              body: `10:15 flip, the market is strong${coverNote}. No stock to buy today.` + (auto.short && !lt.mstop ? AUTO_NOTE : ""),
            },
      );
    } else if (!lt.mstop) {
      out.push({
        key: key("noflip"),
        tone: "neutral",
        symbol: pick,
        title: `10:15: keep the ${pick} short`,
        body: "No flip today: Book A holds the short to 15:15 unless the market stop hits first.",
      });
    }
  }
  if (traded && minute >= 15 * 60 + 15 && minute < 15 * 60 + 30) {
    const flipped = !!lt.flip?.do;
    const legs = [
      !lt.mstop && !flipped ? { text: `BUY back ${pick} (cover the short)`, auto: auto.short } : null,
      flipped && lt.flip?.symbol ? { text: `SELL ${lt.flip.symbol} (close the long)`, auto: auto.long } : null,
    ].filter((x): x is { text: string; auto: boolean } => !!x);
    if (legs.length) {
      const all = legs.every((l) => l.auto);
      out.push({
        key: key("close"),
        tone: all ? "neutral" : "warn",
        symbol: null,
        title: all ? "15:15 square-off (automatic)" : "SQUARE OFF now (15:15)",
        body:
          `Book A closes the day: ${legs.map((l) => l.text + (l.auto && !all ? " — automatic, no action needed" : "")).join("; ")}.` +
          (all ? AUTO_NOTE : ""),
      });
    }
  }
  return out.map((d) => ({ ...d, date, kind: "bookA" as const }));
}

export interface WatchTick {
  symbol: string;
  last: number;
  prevClose: number;
  dayHigh?: number | null;
  dayLow?: number | null;
}

/** Watchlist alerts for these ticks, given the levels already sent today (`done`, updated in place). Pure otherwise. */
export function watchDrafts(ticks: WatchTick[], done: Record<string, number>, date: string): AlertDraft[] {
  const out: AlertDraft[] = [];
  for (const t of ticks) {
    if (!(t.prevClose > 0) || !(t.last > 0)) continue;
    const pct = (t.last / t.prevClose - 1) * 100;
    const lvl = [...WATCH_LEVELS].reverse().find((l) => Math.abs(pct) >= l);
    if (!lvl) continue;
    const dir = pct >= 0 ? "up" : "down";
    const dk = `${date}|${t.symbol}|${dir}`;
    if ((done[dk] ?? 0) >= lvl) continue;
    done[dk] = lvl;
    const range = t.dayLow != null && t.dayHigh != null ? `; today's range ${rs(t.dayLow)}–${rs(t.dayHigh)}` : "";
    out.push({
      key: `W|${dk}|${lvl}`,
      date,
      kind: "watch",
      tone: dir === "up" ? "up" : "down",
      symbol: t.symbol,
      title: `${t.symbol} ${dir === "up" ? "+" : "−"}${lvl}%: ${rs(t.last)}`,
      body: `${t.symbol} is ${dir} ${Math.abs(pct).toFixed(2)}% today (yesterday's close ${rs(t.prevClose)}${range}). Watchlist alert: no trade is made.`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ store */

const file = () => process.env.TRADE_ALERTS_FILE ?? path.join(process.cwd(), "data", "trade-alerts.json");

const g = globalThis as {
  __mnhaTradeAlerts?: { queue: Promise<unknown>; timer: NodeJS.Timeout | null; busy: boolean; lastWatch: number; lastError: string | null };
};
g.__mnhaTradeAlerts ??= { queue: Promise.resolve(), timer: null, busy: false, lastWatch: 0, lastError: null };
const S = g.__mnhaTradeAlerts;

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = S.queue.then(job, job);
  S.queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<Store> {
  try {
    const s = JSON.parse(await readFile(file(), "utf8")) as Partial<Store>;
    return { items: Array.isArray(s.items) ? s.items : [], watch: s.watch && typeof s.watch === "object" ? s.watch : {} };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { items: [], watch: {} };
    throw e;
  }
}

async function write(s: Store): Promise<void> {
  try {
    await copyFile(file(), `${file()}.bak`);
  } catch {
    /* first write */
  }
  const tmp = `${file()}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 1), "utf8");
  await rename(tmp, file());
}

/** Newest first. */
export async function listAlerts(limit = 400): Promise<TradeAlert[]> {
  const s = await enqueue(read);
  return s.items.slice(-limit).reverse();
}

/** Record the drafts whose key is new (and today's watchlist levels), then send each new one to the admin. */
export async function emit(
  drafts: AlertDraft[],
  watch?: { date: string; make: (done: Record<string, number>) => AlertDraft[] },
): Promise<TradeAlert[]> {
  const fresh = await enqueue(async () => {
    const s = await read();
    const all = [...drafts];
    if (watch) {
      for (const k of Object.keys(s.watch)) if (!k.startsWith(`${watch.date}|`)) delete s.watch[k]; // only today's levels are kept
      all.push(...watch.make(s.watch));
    }
    const seen = new Set(s.items.map((i) => i.key));
    const now = Date.now();
    const added: TradeAlert[] = [];
    for (const d of all) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      added.push({ ...d, id: `ta-${now.toString(36)}-${randomBytes(3).toString("hex")}`, at: now });
    }
    if (!added.length && !watch) return added;
    s.items.push(...added);
    if (s.items.length > MAX_ITEMS) s.items = s.items.slice(-MAX_ITEMS);
    await write(s);
    return added;
  });
  for (const a of fresh) {
    await notifyAdmin({ tone: a.tone, title: a.title, body: a.body, key: `trade-alert|${a.key}`, route: "admin:alerts" });
  }
  return fresh;
}

/* ------------------------------------------------------------------- loop */

/** One pass: Book A every call, the watchlists at most once a minute. Never throws. */
async function tick(): Promise<void> {
  if (S.busy) return;
  S.busy = true;
  try {
    const now = Date.now();
    const { date, minute } = istClock(now);
    const { isTradingDate } = await import("@/lib/market");
    if (!isTradingDate(date) || minute < 9 * 60 + 14 || minute > 15 * 60 + 35) return;
    const [{ liveToday }, store] = await Promise.all([import("@/lib/research"), import("@/lib/liveTrading/store")]);
    const lt = await liveToday();
    if (lt) {
      const [settings, [day]] = await Promise.all([store.getSettings(), store.recentDays(1)]);
      const held = day && day.date === date && day.mode === "live" && (day.accounts?.length ?? 0) > 0 ? day.legs : {};
      const open = settings.mode === "live";
      await emit(bookADrafts(lt, settings.base, now, { open, short: open || !!held.short, long: open || !!held.long }));
    }
    if (now - S.lastWatch >= 60_000 && minute >= 9 * 60 + 15 && minute <= 15 * 60 + 30) {
      S.lastWatch = now;
      const [{ getWatchlists }, groww] = await Promise.all([import("@/lib/watchlists"), import("@/lib/api/groww")]);
      if (groww.hasCredentials()) {
        const symbols = [...new Set((await getWatchlists()).flatMap((w) => w.symbols))];
        const ticks = symbols.length ? Object.values(await groww.getTicks(symbols)) : [];
        await emit([], { date, make: (done) => watchDrafts(ticks, done, date) });
      }
    }
    S.lastError = null;
  } catch (e) {
    S.lastError = e instanceof Error ? e.message : String(e);
    console.error("[trade-alerts]", S.lastError);
  } finally {
    S.busy = false;
  }
}

export function startTradeAlerts(): void {
  if (S.timer) return;
  S.timer = setInterval(() => void tick(), 15_000);
  S.timer.unref?.();
}

export function tradeAlertsStatus(): { running: boolean; lastError: string | null } {
  return { running: !!S.timer, lastError: S.lastError };
}
