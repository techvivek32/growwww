import "server-only";
import { isTradingDate } from "@/lib/market";
import { liveToday, type LiveToday } from "@/lib/research";
import { houseLtp } from "@/lib/api/broker";
import { checkAccounts } from "./accounts";
import { tradePermission } from "@/lib/trading";
import { notify, notifyAdmin } from "@/lib/notifications";
import { currentConsent } from "@/lib/consent";
import { OWNER_ID } from "@/lib/auth";
import { ACTION_LABEL, ACTIVE_MAX, acctToken, addNote, getDay, getSettings, ordersOfDay, updateDay, type ActiveDay, type ActiveLeg, type ActiveN, type DaySignals, type DayState, type LegPlan, type LiveSettings, type OrderAction, type Leg } from "./store";
import { cancelStuckOpeners, closeLegIn, followOrders, openLegIn, type CloseResult } from "./orders";
import { clock, hm, inr, istMinuteOfEpoch, istNow, pool, type IstNow } from "./util";

/**
 * The live executor: book A of the paper-trading engine, traded in real
 * accounts. It runs inside the website's server process (started by
 * src/instrumentation.ts) and, on trading days from 09:12 to 15:32 IST, every
 * few seconds:
 *
 *   09:13–09:19  reads every account's cash (and signs in to Groww for the day);
 *   09:20        when the research engine has decided: fixes the day's accounts
 *                (eligible ones only) and sells the pick short in each, the same
 *                quantity everywhere: base value ÷ price, rounded down;
 *   market stop  when the research engine records it: buys the short back;
 *   10:15 flip   when the research engine decides to flip: buys the short back,
 *                then buys the top gainer, base value ÷ price;
 *   15:15        closes whatever is left of both legs.
 *
 * Every step runs once a day (its time is written to the day's plan), every
 * order is written down before it is sent and never sent twice, and a close is
 * never larger than the live position (see orders.ts). In shadow mode the same
 * orders are recorded as filled at the live price and nothing is sent. Off
 * sends nothing. Orders already sent are followed up in every mode.
 */

const T = {
  ACTIVE_FROM: hm(9, 12),
  PREWARM_FROM: hm(9, 13),
  PREWARM_TO: hm(9, 19, 40),
  /** From here to WATCH_TO the market-stop watcher must be heard from (see watchdog). */
  WATCH_FROM: hm(9, 31),
  WATCH_TO: hm(15, 10),
  /** A decision made after this is a late replay: never traded. */
  LATEST_DECISION: hm(9, 35),
  /** No entry is sent after this. */
  ENTRY_CUTOFF: hm(9, 37),
  /** No flip is followed after this (the research engine gives up at 10:45). */
  FLIP_CUTOFF: hm(10, 50),
  CLOSE_AT: hm(15, 15, 3),
  /** Groww squares intraday positions off itself near 15:20; past this the close step reports and stops. */
  CLOSE_GIVE_UP: hm(15, 24),
  ACTIVE_TO: hm(15, 32),
  /** The active (auto) book opens nothing after 14:45; a trade it opened is followed only up to here. */
  ACTIVE_ENTRY_CUTOFF: hm(14, 50),
};
/** An active-book trade seen later than this after it opened is not followed (the price has moved on). */
const ACTIVE_FOLLOW_S = 180;
const ACTIVE_TICK_MS = 3_000;
const IDLE_TICK_MS = 60_000;
/** Quantity = base ÷ (price × 1.003), rounded down: the fill stays within the base even if the price moves a little. */
const QTY_CUSHION = 0.003;
/** How long the flip waits for its covers before buying the long anyway. */
const FLIP_COVER_WAIT_MS = 20_000;
const PREWARM_EVERY_MS = 3 * 60_000;
/** Longer than this without a completed market-stop check (two 5-minute closes and some slack) and the short is covered. */
const WATCH_SILENCE_MS = 12 * 60_000;
/** Cash readings this young are reused at 09:20, so the entry goes out in seconds. */
const READING_MAX_AGE_MS = 6 * 60_000;

type Step = "entry" | "stop" | "flipCover" | "flip" | "close";

interface ExecState {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  /** When the tick now running began (null between ticks). */
  tickStartedAt: number | null;
  startedAt: number;
  lastTickAt: number | null;
  lastError: string | null;
  research: { at: number; ok: boolean } | null;
  prewarm: { day: number; at: number } | null;
  flipWait: { day: number; since: number } | null;
  /** Since when each close (day|action|account) has been waiting or unclear. */
  held: { day: number; since: Map<string, number> };
  noted: { day: number; keys: Set<string> };
}

const g = globalThis as { __mnhaLiveExec?: ExecState };
g.__mnhaLiveExec ??= {
  timer: null,
  running: false,
  tickStartedAt: null,
  startedAt: 0,
  lastTickAt: null,
  lastError: null,
  research: null,
  prewarm: null,
  flipWait: null,
  held: { day: -1, since: new Map() },
  noted: { day: -1, keys: new Set() },
};
const E = g.__mnhaLiveExec;

/** Start the loop. Idempotent: a second call (another bundle, a dev reload) does nothing. */
export function startLiveExecutor(): void {
  if (E.timer) return;
  E.startedAt = Date.now();
  schedule(5_000);
  console.log("[live] executor started");
}

export function executorStatus() {
  const now = Date.now();
  return {
    started: E.startedAt > 0,
    startedAt: E.startedAt || null,
    lastTickAt: E.lastTickAt,
    /** A tick has been running for over 90 s, or none has finished for 3 minutes: the loop is stuck. */
    stalled:
      E.startedAt > 0 &&
      ((E.tickStartedAt !== null && now - E.tickStartedAt > 90_000) || now - (E.lastTickAt ?? E.startedAt) > 180_000),
    lastError: E.lastError,
    research: E.research,
  };
}

function schedule(ms: number): void {
  E.timer = setTimeout(() => void tick(), ms);
}

async function tick(): Promise<void> {
  if (E.running) return schedule(1_000);
  E.running = true;
  E.tickStartedAt = Date.now();
  let next = IDLE_TICK_MS;
  try {
    next = await step();
    E.lastError = null;
  } catch (err) {
    E.lastError = err instanceof Error ? err.message : String(err);
    console.error("[live] tick failed:", E.lastError);
    next = ACTIVE_TICK_MS;
  } finally {
    E.running = false;
    E.tickStartedAt = null;
    E.lastTickAt = Date.now();
    schedule(next);
  }
}

/* ------------------------------------------------------------------ notes */

async function noteOnce(now: IstNow, key: string, tone: "info" | "warn" | "error", text: string): Promise<void> {
  if (E.noted.day !== now.day) E.noted = { day: now.day, keys: new Set() };
  if (E.noted.keys.has(key)) return;
  E.noted.keys.add(key);
  console.log(`[live] ${text}`);
  try {
    await addNote(now.day, now.date, tone, text);
  } catch (err) {
    console.error("[live] note not saved:", err instanceof Error ? err.message : err);
  }
}

/** Mark a step done for the day, with a note saying how it ended. */
async function finish(now: IstNow, step: Step, tone: "info" | "warn" | "error", text: string): Promise<void> {
  console.log(`[live] ${step}: ${text}`);
  await updateDay(now.day, now.date, (d) => {
    if (d.done[step]) return;
    d.done[step] = Date.now();
    d.notes.push({ at: Date.now(), tone, text });
  });
}

/* ------------------------------------------------------------------ steps */

/**
 * Today's modes. `open`: what new positions (the entry, the flip's buy) go out
 * in — null when the strategy is switched off. `close`: what the day's own
 * positions are looked after in (market stop, flip cover, fail-safe, 15:15
 * close) — always the mode the day began in, whatever the switch says now:
 * switching off stops new trades, never the closing of ones already open.
 * A day that began in shadow stays simulated; a day that began live is never
 * "closed" on paper only.
 */
export function modesFor(settings: LiveSettings, day: DayState): { open: "live" | "shadow" | null; close: "live" | "shadow" | null } {
  if (day.mode === null) {
    const m = settings.mode === "off" ? null : settings.mode;
    return { open: m, close: m };
  }
  const close = day.mode;
  if (settings.mode === "off" || (day.mode === "live" && settings.mode === "shadow")) return { open: null, close };
  return { open: day.mode, close };
}

/** The mode new positions would go out in right now (null: none) — for re-checks mid-batch. */
function effectiveMode(settings: LiveSettings, day: DayState): "live" | "shadow" | null {
  return modesFor(settings, day).open;
}

/** One pass of the loop (exported for scripts/test-live-trading.cjs, which drives it with a fake clock and broker). */
export async function step(): Promise<number> {
  const now = istNow();
  // Orders already sent are followed whatever the mode or the hour: reading Groww back is never a risk.
  try {
    await followOrders();
  } catch (err) {
    console.error("[live] follow-up failed:", err instanceof Error ? err.message : err);
  }
  if (!isTradingDate(now.date) || now.minute < T.ACTIVE_FROM || now.minute > T.ACTIVE_TO) return IDLE_TICK_MS;
  // Whatever the mode: cancelling MNHA's own stuck opening order only ever takes risk away.
  try {
    await cancelStuckOpeners(now.day, (text) => void noteOnce(now, `stuck|${text}`, "warn", text));
  } catch (err) {
    console.error("[live] stuck-order check failed:", err instanceof Error ? err.message : err);
  }

  const settings = await getSettings();
  const day = await getDay(now.day, now.date);
  const { open, close } = modesFor(settings, day);
  const activeOn = (settings.activeMode ?? "off") !== "off" || Boolean(day.active);
  if (!open && !close) {
    if (activeOn) await activeStep(now, await research(now), settings);
    return ACTIVE_TICK_MS;
  }
  if (!open && day.mode !== null) {
    await noteOnce(now, `no-open-${settings.mode}`, "warn", `Switched to ${settings.mode} during the day: nothing new is opened; what the strategy opened today is still closed (market stop, 10:15 cover, 15:15).`);
  }
  if (day.mode === "shadow" && settings.mode === "live") {
    await noteOnce(now, "shadow-day", "info", "Live mode begins with the next 09:20 entry: today began in shadow mode and stays simulated.");
  }

  if (open && day.accounts === null && now.minute >= T.PREWARM_FROM && now.minute < T.PREWARM_TO) await prewarm(now, settings);

  const st = await research(now);
  let signals = await remember(now, st);
  if (close) signals = await watchdog(now, st, signals);
  if (open) await entryStep(now, st, signals, settings, open);
  else if (!day.done.entry && now.minute >= T.ENTRY_CUTOFF) await finish(now, "entry", "info", "No entry today: the strategy was switched off.");
  if (close) {
    await stopStep(now, signals);
    await flipCoverStep(now, signals);
  }
  if (open) await flipStep(now, signals, settings, open);
  else if (!day.done.flip && now.minute >= T.FLIP_CUTOFF) await finish(now, "flip", "info", "No flip buy today: the strategy was switched off.");
  if (close) await closeStep(now);
  if (activeOn) await activeStep(now, st, settings);
  return ACTIVE_TICK_MS;
}

/**
 * The short's only protection between 09:20 and 15:15 is the research engine's
 * market-stop watcher. If it goes quiet — the session process died, its quotes
 * failed, or the research engine cannot be read — for longer than
 * WATCH_SILENCE_MS while a short may be open, the short is covered as a
 * fail-safe (recorded as a market stop marked failsafe), rather than held with
 * no stop at all.
 */
async function watchdog(now: IstNow, st: LiveToday | null, signals: DaySignals): Promise<DaySignals> {
  const seen = st?.mstop_check?.at;
  if (seen !== undefined && seen > (signals.beat ?? 0)) {
    // Kept in the day's plan: a restarted site must not take a quiet start-up for a dead watcher.
    await updateDay(now.day, now.date, (d) => {
      if (seen > (d.signals.beat ?? 0)) d.signals.beat = seen;
    });
    signals = { ...signals, beat: seen };
  }
  if (signals.mstop || signals.skip !== false || signals.flip?.do) return signals; // stopped, no trade, or the flip covers it
  if (now.minute < T.WATCH_FROM || now.minute >= T.WATCH_TO) return signals;
  const day = await getDay(now.day, now.date);
  if (!day.accounts?.length || !day.legs.short || day.done.stop) return signals;
  if (st && !st.has_watcher) {
    // A research build without the heartbeat: silence would mean nothing, so no fail-safe — but say so.
    await noteOnce(now, "no-watcher", "error", "The research engine does not report its market-stop watcher (an older build): the fail-safe is off until it is updated.");
    return signals;
  }
  // Silence is counted from the last heartbeat, or else from the first close the watcher should have
  // checked — and never from before this process started (a restart gets the full grace).
  const decidedS = day.fixedAt ? day.fixedAt / 1000 : now.ms / 1000;
  const firstCheckS = Math.max(epochOfIst(now.day, hm(9, 25, 3)), nextCloseAfter(decidedS));
  const lastS = Math.max(signals.beat ?? 0, firstCheckS, E.startedAt / 1000);
  if (now.ms - lastS * 1000 <= WATCH_SILENCE_MS) return signals;
  const since = clock(istMinuteOfEpoch(lastS));
  const mstop = { at: now.ms / 1000, move: null, failsafe: true };
  await updateDay(now.day, now.date, (d) => {
    if (!d.signals.mstop) d.signals.mstop = mstop;
  });
  await noteOnce(now, "watchdog", "error", `The research engine's market-stop watcher has been silent since ${since}: the short is covered as a fail-safe, rather than held with no stop.`);
  return { ...signals, mstop };
}

/** Epoch seconds of an IST minute-of-day on an IST day number. */
const epochOfIst = (day: number, minute: number) => day * 86_400 + minute * 60 - 19_800;

/** Epoch seconds of the first 5-minute close (+3 s) after `epochS` (closes fall at 09:20, 09:25, …). */
function nextCloseAfter(epochS: number): number {
  const day = Math.floor((epochS + 19_800) / 86_400);
  const minute = istMinuteOfEpoch(epochS);
  const close = 9 * 60 + 20 + 5 * Math.max(1, Math.floor((minute - (9 * 60 + 20)) / 5) + 1);
  return epochOfIst(day, close) + 3;
}

/**
 * The day's decisions so far: what the research engine says now, merged with
 * what it said before (kept in the day's plan the first time it is seen), so a
 * research outage after the 10:15 flip or a market stop cannot hold them up.
 */
async function remember(now: IstNow, st: LiveToday | null): Promise<DaySignals> {
  const day = await getDay(now.day, now.date);
  const seen: DaySignals = { ...day.signals };
  const add: DaySignals = {};
  if (st && st.status && st.skip !== null && seen.skip === undefined) add.skip = st.skip;
  if (st?.mstop && !seen.mstop) add.mstop = { at: st.mstop.at, move: st.mstop.move };
  if (st?.flip && !seen.flip) add.flip = { ...st.flip };
  if (Object.keys(add).length) {
    await updateDay(now.day, now.date, (d) => {
      d.signals = { ...add, ...d.signals };
    });
  }
  return { ...add, ...seen };
}

async function prewarm(now: IstNow, settings: LiveSettings): Promise<void> {
  if (E.prewarm && E.prewarm.day === now.day && Date.now() - E.prewarm.at < PREWARM_EVERY_MS) return;
  E.prewarm = { day: now.day, at: Date.now() };
  const checks = await checkAccounts(settings);
  const n = (grp: string) => checks.filter((c) => c.group === grp).length;
  await noteOnce(now, "prewarm", "info", `Accounts checked before the open: ${n("eligible")} eligible, ${n("low")} low balance, ${n("blocked")} blocked, ${n("excluded")} kept out.`);
}

async function research(now: IstNow): Promise<LiveToday | null> {
  const t = await liveToday();
  E.research = { at: Date.now(), ok: t !== null };
  if (!t) await noteOnce(now, `research-${Math.floor(now.minute / 10)}`, "warn", "The research engine could not be read; waiting for it.");
  if (t && t.day !== now.day) {
    await noteOnce(now, "research-day", "error", `The research engine reports day ${t.date}, not ${now.date}: nothing is traded on it.`);
    return null;
  }
  return t;
}

/** The day's accounts and leg plan, fixed once (the first strategy order of the day). */
async function fixDay(now: IstNow, settings: LiveSettings, mode: "live" | "shadow", legs: { short?: LegPlan; long?: LegPlan }): Promise<DayState> {
  const day = await getDay(now.day, now.date);
  let eligible: string[] | null = null;
  if (day.accounts === null) {
    const checks = await checkAccounts(settings, { maxAgeMs: READING_MAX_AGE_MS });
    eligible = checks.filter((c) => c.group === "eligible").map((c) => c.id);
  }
  return updateDay(now.day, now.date, (d) => {
    if (d.accounts === null && eligible !== null) {
      d.accounts = eligible;
      d.fixedAt = Date.now();
      d.mode = mode;
      d.base = settings.base;
    }
    if (legs.short && !d.legs.short) d.legs.short = legs.short;
    if (legs.long && !d.legs.long) d.legs.long = legs.long;
    return structuredClone(d);
  });
}

/**
 * Asked just before each automatic order that OPENS a position, inside the
 * account's lock: is the strategy still on in `dayMode` (switching it off stops
 * a batch half-way, not at the next tick), and is this account still in — not
 * kept out since, its address still sendable, its agreement still signed?
 * Closes are never asked: getting out only takes risk away (and the broker
 * layer still refuses any order an account's address cannot carry).
 */
function allowFor(now: IstNow, dayMode: "live" | "shadow"): (accountId: string) => Promise<boolean> {
  const gates = allowForAccount(now, dayMode);
  return async (accountId) => {
    const [settings, day] = await Promise.all([getSettings(), getDay(now.day, now.date)]);
    if (effectiveMode(settings, day) !== dayMode) {
      await noteOnce(now, `stopped-${dayMode}`, "warn", "The strategy was switched while its orders were going out: the rest were not sent.");
      return false;
    }
    return gates(accountId, settings);
  };
}

/** The per-account gates of an opening order: not kept out, and (live) its order address and agreement still good. */
function allowForAccount(now: IstNow, dayMode: "live" | "shadow"): (accountId: string, settings: LiveSettings) => Promise<boolean> {
  return async (accountId, settings) => {
    if (settings.excluded.includes(accountId)) {
      await noteOnce(now, `skip-out|${accountId}`, "info", `${acctToken(accountId)} was kept out while orders were going out: not sent there.`);
      return false;
    }
    if (dayMode === "live") {
      const [perm, signed] = await Promise.all([
        tradePermission(accountId).then((p) => p.allowed).catch(() => false),
        accountId === OWNER_ID ? Promise.resolve(true) : currentConsent(accountId).then((c) => c !== null).catch(() => false),
      ]);
      if (!perm || !signed) {
        await noteOnce(now, `skip-gate|${accountId}`, "warn", `${acctToken(accountId)} can no longer take orders (${!perm ? "its order address" : "its agreement"}): not sent there.`);
        return false;
      }
    }
    return true;
  };
}

/** base ÷ (price × cushion), rounded down. */
const sizeFor = (base: number, px: number) => Math.floor(base / (px * (1 + QTY_CUSHION)));

async function priceOf(symbol: string, fallback: number | null): Promise<number | null> {
  const q = await houseLtp([symbol]);
  const px = q[symbol] ?? fallback;
  return px && px > 0 && Number.isFinite(px) ? px : null;
}

/** How a step's orders stand right now, e.g. "3 placed, 1 rejected". */
async function outcomes(day: number, action: OrderAction): Promise<string> {
  const counts = new Map<string, number>();
  for (const o of await ordersOfDay(day)) {
    if (o.action !== action) continue;
    const k = o.state === "shadow" ? "recorded (shadow)" : o.state;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts.size ? [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(", ") : "none sent";
}

async function entryStep(now: IstNow, st: LiveToday | null, signals: DaySignals, settings: LiveSettings, mode: "live" | "shadow"): Promise<void> {
  const day = await getDay(now.day, now.date);
  if (day.done.entry) return;
  if (signals.mstop && !signals.mstop.failsafe) {
    // Book A's short is already closed: entering now would only buy it straight back.
    return finish(now, "entry", "info", `The market stop fired at ${clock(istMinuteOfEpoch(signals.mstop.at))}, before the entry was sent: book A's short is already closed, so no entry.`);
  }
  if (!st || !st.status) {
    if (now.minute >= T.ENTRY_CUTOFF) await finish(now, "entry", "warn", "No 09:20 decision from the research engine by 09:37: no trade today.");
    return;
  }
  if (st.status === "no_session") return finish(now, "entry", "info", "The research engine found no session today (a holiday?): no trade.");
  if (st.skip) return finish(now, "entry", "info", "Regime skip day: the strategy takes no trade today.");
  if (!st.pick) return finish(now, "entry", "warn", "Decided without a pick: no trade.");
  const decidedAt = st.decided_at !== null ? istMinuteOfEpoch(st.decided_at) : null;
  if (st.late || decidedAt === null || decidedAt > T.LATEST_DECISION) {
    return finish(now, "entry", "warn", `${st.pick} was picked at ${decidedAt !== null ? clock(decidedAt) : "an unknown time"}, after 09:35: no entry today.`);
  }
  if (now.minute >= T.ENTRY_CUTOFF) {
    // Never a late entry — not even the rest of one a restart interrupted.
    return finish(now, "entry", "warn", `The 09:20 entry was not completed by 09:37 (the site was busy or down): ${day.accounts === null ? "no entry today" : `entry orders so far: ${await outcomes(now.day, "entry")}; no more are sent`}.`);
  }

  let plan = day.legs.short;
  if (!plan) {
    const px = await priceOf(st.pick, st.pick_px);
    if (px === null) return finish(now, "entry", "error", `No price for ${st.pick}: no entry.`);
    const qty = sizeFor(settings.base, px);
    if (qty < 1) return finish(now, "entry", "warn", `${st.pick} at ${inr(px)} is above the base value of ${inr(settings.base)}: no entry.`);
    plan = { symbol: st.pick, qty, px };
  }
  const fixed = await fixDay(now, settings, mode, { short: plan });
  plan = fixed.legs.short!;
  const accounts = (fixed.accounts ?? []).filter((a) => !settings.excluded.includes(a));
  if (!accounts.length) return finish(now, "entry", "warn", "No eligible account at 09:20: nothing sent.");
  const dayMode = fixed.mode ?? mode;
  await pool(accounts, 4, (accountId) =>
    openLegIn({ day: now.day, action: "entry", leg: "short", accountId, mode: dayMode, symbol: plan!.symbol, qty: plan!.qty, shadowPx: plan!.px, allow: allowFor(now, dayMode) }).catch((err) => {
      console.error(`[live] entry for ${accountId} failed:`, err instanceof Error ? err.message : err);
      return null;
    }),
  );
  await finish(
    now,
    "entry",
    "info",
    `09:20 entry${dayMode === "shadow" ? " (shadow)" : ""}: SELL ${plan.qty.toLocaleString("en-IN")} ${plan.symbol} (≈ ${inr(plan.qty * plan.px)}) in ${accounts.length} account${accounts.length === 1 ? "" : "s"}: ${await outcomes(now.day, "entry")}.`,
  );
}

interface CloseTally {
  /** No account has anything left to do (closed, gave up, or unclear). */
  converged: boolean;
  /** Accounts whose close could not be done (gave up after retries, or Groww's figures unclear). */
  failed: number;
  accounts: number;
}

/** "the short is covered" — or how many accounts it was not covered in. */
function tallyText(t: CloseTally, ok: string): { tone: "info" | "error"; text: string } {
  return t.failed === 0
    ? { tone: "info", text: ok }
    : { tone: "error", text: `${ok.replace(/\.$/, "")} in ${t.accounts - t.failed} of ${t.accounts} accounts — NOT in ${t.failed} (see the notes above; close them from Exit below or in Groww).` };
}

/** Close one leg in every account of the day; converged when no account has anything left to do. */
async function closeAll(now: IstNow, day: DayState, action: OrderAction, leg: Leg, own?: { accounts: string[]; mode: "live" | "shadow"; plan: LegPlan }): Promise<CloseTally> {
  const accounts = own ? own.accounts : (day.accounts ?? []);
  const mode = own ? own.mode : day.mode;
  const plan = own ? own.plan : leg === "short" ? day.legs.short : day.legs.long;
  if (!accounts.length || !mode || !plan) return { converged: true, failed: 0, accounts: 0 };
  const shadowPx = mode === "shadow" ? await priceOf(plan.symbol, plan.px) : null;
  const label = acctToken; // named when shown: no email is written into the notes
  // Closes are never held back by the switch: getting out only takes risk away.
  const results: CloseResult[] = await pool(accounts, 4, (accountId) =>
    closeLegIn({
      day: now.day,
      action,
      leg,
      accountId,
      mode,
      shadowPx,
      onOutside: (n, symbol) =>
        void noteOnce(now, `outside|${action}|${accountId}`, "warn", `${label(accountId)}: ${n.toLocaleString("en-IN")} ${symbol} were already closed outside MNHA; only the rest is closed.`),
    }).catch((err): CloseResult => {
      console.error(`[live] ${action} for ${accountId} failed:`, err instanceof Error ? err.message : err);
      return "wait";
    }),
  );
  if (E.held.day !== now.day) E.held = { day: now.day, since: new Map() };
  for (let i = 0; i < accounts.length; i++) {
    const k = `${action}|${accounts[i]}`;
    if (results[i] === "wait" || results[i] === "unclear") {
      const since = E.held.since.get(k) ?? now.ms;
      E.held.since.set(k, since);
      // "unclear" may be a moment's odd reading: it counts only once it has lasted a minute.
      if (results[i] === "unclear" && now.ms - since <= 60_000) results[i] = "wait";
      if (results[i] === "wait" && now.ms - since > 90_000) {
        await noteOnce(now, `held|${k}`, "warn", `${label(accounts[i])}: the ${ACTION_LABEL[action].toLowerCase()} of ${plan.symbol} has been held for over 90 seconds — an MNHA order on it is still working at Groww, a cancellation is pending, or Groww's positions cannot be read. Check Today's orders, or use Exit.`);
      }
    } else {
      E.held.since.delete(k);
    }
    if (results[i] === "offline") {
      await noteOnce(now, `offline|${action}|${accounts[i]}`, "error", `${label(accounts[i])}: Groww is disconnected (or its key no longer works), so MNHA cannot close its ${plan.symbol} now — it keeps trying and closes it as soon as Groww is reconnected; otherwise Groww squares intraday positions off itself near 15:20.`);
      if (mode === "live") await tellHolder(now, accounts[i], `offline|${action}`, plan.symbol, "your Groww is disconnected from MNHA (or its key no longer works)");
    }
    if (results[i] === "gave-up") {
      await noteOnce(now, `gave-up|${action}|${accounts[i]}`, "error", `${label(accounts[i])}: ${plan.symbol} could not be closed after several tries — close it from Exit below or in Groww.`);
      if (mode === "live") await tellHolder(now, accounts[i], `gave-up|${action}`, plan.symbol, "Groww refused the closing order several times");
    }
    if (results[i] === "unclear") await noteOnce(now, `unclear|${action}|${accounts[i]}`, "error", `${label(accounts[i])}: Groww's figures for ${plan.symbol} disagree about the direction, so nothing was sent — check it in Groww.`);
  }
  return {
    // "offline" never counts as finished: the step stays open and closes the position the moment
    // the account's Groww is reachable again (checking costs a local read, no broker call). The
    // 15:15 close gives up at 15:24 and reports what is still open.
    converged: results.every((r) => r === "done" || r === "gave-up" || r === "unclear"),
    failed: results.filter((r) => r === "gave-up" || r === "unclear" || r === "offline").length,
    accounts: accounts.length,
  };
}

/* ------------------------------------------------------------ the active (auto) book in the accounts */

/** Fix today's active-book day once: its mode (a live day never opens in shadow) and the ceiling per account. */
async function fixActive(now: IstNow, settings: LiveSettings, mode: "live" | "shadow"): Promise<ActiveDay> {
  const day = await getDay(now.day, now.date);
  if (day.active) return day.active;
  const d = await updateDay(now.day, now.date, (x) => {
    x.active ??= { mode, accounts: [], base: settings.base, fixedAt: Date.now(), opened: {}, closed: {}, skipped: {} };
    return structuredClone(x);
  });
  return d.active!;
}

/** Below this an account's free money buys too little to be worth the charges: it sits the trade out. */
const ACTIVE_MIN_VALUE = 10_000;
/** How fresh an account's funds reading must be to size an active-book trade from it. */
const ACTIVE_FUNDS_MAX_AGE_MS = 60_000;

/**
 * Each account's quantity for an active-book trade, from its OWN free money (cash minus margin in use), never more
 * than the base value per account: an account with less trades smaller instead of sitting out; one with less than
 * ACTIVE_MIN_VALUE free, or not connected / not sendable / unsigned / kept out, takes no part.
 */
async function activeSizes(settings: LiveSettings, px: number): Promise<Record<string, number>> {
  const checks = await checkAccounts(settings, { maxAgeMs: ACTIVE_FUNDS_MAX_AGE_MS });
  const out: Record<string, number> = {};
  for (const c of checks) {
    if (c.group !== "eligible" && c.group !== "low") continue;
    if (settings.excluded.includes(c.id)) continue;
    const value = Math.min(c.funds?.free ?? 0, settings.base);
    if (value < ACTIVE_MIN_VALUE) continue;
    const q = sizeFor(value, px);
    if (q >= 1) out[c.id] = q;
  }
  return out;
}

/** Like allowFor, for the active book's opening orders: its own switch, then the same account gates. */
function allowForActive(now: IstNow, dayMode: "live" | "shadow"): (accountId: string) => Promise<boolean> {
  const gates = allowForAccount(now, dayMode);
  return async (accountId) => {
    const settings = await getSettings();
    const m = settings.activeMode ?? "off";
    if (m === "off" || (dayMode === "live" && m !== "live")) {
      await noteOnce(now, `active-stopped-${dayMode}`, "warn", "The active book was switched while its orders were going out: the rest were not sent.");
      return false;
    }
    return gates(accountId, settings);
  };
}

/**
 * The active (auto) book in the accounts: a trade it opens (its scan runs every 2 minutes) is opened in every account
 * with money, each sized from its own free money; a trade it closes is closed; whatever is still open is closed at
 * 15:15. Opens follow the active-book switch; closes never wait on it — getting out only takes risk away.
 */
async function activeStep(now: IstNow, st: LiveToday | null, settings: LiveSettings): Promise<void> {
  const setting = settings.activeMode ?? "off";
  const trades = (st?.active ?? []).slice(0, ACTIVE_MAX);
  let day = await getDay(now.day, now.date);
  if (setting !== "off" && st && now.minute < T.ACTIVE_ENTRY_CUTOFF) {
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const n = (i + 1) as ActiveN;
      if (t.status !== "open" || day.active?.opened[n] || day.active?.skipped[n]) continue;
      const act = await fixActive(now, settings, setting);
      if (act.mode === "live" && setting !== "live") continue; // a live day never opens in shadow
      const skip = async (why: string) => {
        day = await updateDay(now.day, now.date, (x) => {
          if (x.active && !x.active.opened[n]) x.active.skipped[n] = why;
          return structuredClone(x);
        });
        await noteOnce(now, `active-skip|${n}`, "info", `Active trade ${n} (${t.side === "long" ? "BUY" : "SELL"} ${t.symbol}) not sent: ${why}.`);
      };
      if (now.ms / 1000 - t.entered_at > ACTIVE_FOLLOW_S) {
        await skip(`it opened at ${clock(istMinuteOfEpoch(t.entered_at))}, too long ago to follow at its price`);
        continue;
      }
      const px = await priceOf(t.symbol, t.entry);
      if (px === null) {
        await skip(`no price for ${t.symbol}`);
        continue;
      }
      const sizes = await activeSizes(settings, px);
      const ids = Object.keys(sizes);
      if (!ids.length) {
        await skip(`no account has at least ${inr(ACTIVE_MIN_VALUE)} free that can take orders`);
        continue;
      }
      const leg = `a${n}-${t.side}` as ActiveLeg;
      const key = `${t.symbol}|${t.entered_at}`;
      const total = ids.reduce((a, id) => a + sizes[id], 0);
      day = await updateDay(now.day, now.date, (x) => {
        if (x.active && !x.active.opened[n]) {
          x.active.opened[n] = { symbol: t.symbol, qty: total, px, leg, key, sizes };
          x.active.accounts = [...new Set([...x.active.accounts, ...ids])];
        }
        return structuredClone(x);
      });
      const plan = day.active!.opened[n]!;
      const action = `active-open-${n}` as const;
      await pool(Object.keys(plan.sizes), 4, (accountId) =>
        openLegIn({ day: now.day, action, leg: plan.leg, accountId, mode: act.mode, symbol: plan.symbol, qty: plan.sizes[accountId], shadowPx: plan.px, allow: allowForActive(now, act.mode) }).catch((err) => {
          console.error(`[live] active open ${n} for ${accountId} failed:`, err instanceof Error ? err.message : err);
          return null;
        }),
      );
      const each = Object.entries(plan.sizes).map(([id, q]) => `${acctToken(id)} ${q.toLocaleString("en-IN")}`).join(", ");
      await noteOnce(
        now,
        `active-open|${n}`,
        "info",
        `Active trade ${n}${act.mode === "shadow" ? " (shadow)" : ""}: ${t.side === "long" ? "BUY" : "SELL"} ${plan.symbol} at about ${inr(plan.px)}, sized from each account's free money (${each}): ${await outcomes(now.day, action)}.`,
      );
    }
  }
  const act = day.active;
  if (!act) return;
  for (let i = 0; i < ACTIVE_MAX; i++) {
    const n = (i + 1) as ActiveN;
    const plan = act.opened[n];
    if (!plan || act.closed[n]) continue;
    const t = trades[i];
    const book = t && `${t.symbol}|${t.entered_at}` === plan.key ? t : null;
    const due = now.minute >= T.CLOSE_AT || (book !== null && book.status === "closed");
    if (!due) continue;
    const action = `active-close-${n}` as const;
    const tally = await closeAll(now, day, action, plan.leg, { accounts: Object.keys(plan.sizes ?? {}), mode: act.mode, plan });
    if (tally.converged) {
      day = await updateDay(now.day, now.date, (x) => {
        if (x.active) x.active.closed[n] = Date.now();
        return structuredClone(x);
      });
      const why = book && book.status === "closed" ? `the active book closed it${book.why ? ` (${book.why})` : ""}` : "15:15 close";
      const r = tallyText(tally, `Active trade ${n}: ${plan.symbol} closed — ${why}.`);
      await noteOnce(now, `active-close|${n}`, r.tone, r.text);
    }
  }
}

/** Tell the account holder, once per day and reason, that MNHA could not close its strategy position. */
async function tellHolder(now: IstNow, accountId: string, why: string, symbol: string, reason: string): Promise<void> {
  try {
    await notify(accountId, {
      kind: "order",
      tone: "warn",
      // The position, not the order log, is what the holder has to act on.
      route: "portfolio",
      title: "MNHA could not close a strategy position",
      body: `${symbol}: ${reason}. Please close it in Groww — Groww squares intraday positions off itself near 15:20.`,
      key: `lt-hold-${now.day}-${why}`,
    });
    // The admin has to know too: an account left holding past the close is
    // the one failure here nobody else is watching for.
    await notifyAdmin({
      tone: "warn",
      route: "admin:live",
      title: "A strategy position could not be closed",
      body: `${symbol} is still open in a client account — ${reason}.`,
      key: `lt-hold-admin-${now.day}-${why}`,
    });
  } catch (err) {
    console.error("[live] holder notice failed:", err instanceof Error ? err.message : err);
  }
}

async function stopStep(now: IstNow, signals: DaySignals): Promise<void> {
  const mstop = signals.mstop;
  if (!mstop || now.minute >= T.CLOSE_AT) return;
  const day = await getDay(now.day, now.date);
  if (day.done.stop) return;
  const at = clock(istMinuteOfEpoch(mstop.at));
  const why = mstop.failsafe
    ? `Fail-safe at ${at} (the market-stop watcher went silent)`
    : `Market stop at ${at} (average stock up ${mstop.move !== null ? `${(mstop.move * 100).toFixed(2)}%` : "0.5%"} since 09:20)`;
  if (!day.accounts?.length || !day.legs.short) return finish(now, "stop", "info", `${why}: no short open here.`);
  const r = await closeAll(now, day, "stop-cover", "short");
  if (r.converged) {
    const t = tallyText(r, `${why}: the short is covered.`);
    await finish(now, "stop", t.tone === "error" ? "error" : mstop.failsafe ? "warn" : "info", t.text);
  }
}

/**
 * The 10:15 flip's cover: on a flip day book A's short ends at 10:15, so the
 * short is covered whatever happens to the flip's buy (a late decision, no
 * symbol, no price) — and covering is retried every tick until done, up to the
 * 15:15 close, which takes over after that.
 */
async function flipCoverStep(now: IstNow, signals: DaySignals): Promise<void> {
  if (!signals.flip?.do || signals.skip !== false || now.minute >= T.CLOSE_AT) return;
  const day = await getDay(now.day, now.date);
  if (day.done.flipCover) return;
  if (!day.accounts?.length || !day.legs.short) return finish(now, "flipCover", "info", "10:15 flip: no short open here to cover.");
  const r = await closeAll(now, day, "flip-cover", "short");
  if (r.converged) {
    const t = tallyText(r, "10:15 flip: the short is covered.");
    await finish(now, "flipCover", t.tone, t.text);
  }
}

async function flipStep(now: IstNow, signals: DaySignals, settings: LiveSettings, mode: "live" | "shadow"): Promise<void> {
  const day = await getDay(now.day, now.date);
  if (day.done.flip) return;
  const f = signals.flip ?? null;
  if (!f) {
    if (now.minute >= T.FLIP_CUTOFF) await finish(now, "flip", "info", "No 10:15 flip decision by 10:50: any short is held to 15:15.");
    return;
  }
  if (signals.skip !== false) {
    // A flip on a regime-skip day is never traded — nor one whose day was never seen decided.
    return finish(now, "flip", "info", signals.skip ? "Regime skip day: no flip trade." : "The 09:20 decision was never seen here: the flip is not traded.");
  }
  if (!f.do) return finish(now, "flip", "info", "10:15: no flip — the short is held to 15:15, with the market stop still on.");
  if (!f.symbol) return finish(now, "flip", "warn", "The 10:15 flip came without a symbol: nothing bought (the short is still covered).");
  const decided = istMinuteOfEpoch(f.at);
  if (decided > T.FLIP_CUTOFF || now.minute >= T.FLIP_CUTOFF) {
    const already = (await ordersOfDay(now.day)).some((o) => o.action === "flip-long");
    return finish(
      now,
      "flip",
      "warn",
      already
        ? `The flip's buy was cut short at 10:50 (a restart in the middle?): ${await outcomes(now.day, "flip-long")}; no more are sent. Those held are sold at 15:15.`
        : `The flip was decided at ${clock(decided)}, too late to follow: nothing bought (the short is still covered).`,
    );
  }

  // 1. The cover (flipCoverStep, run just before this) gets a moment to finish before the buy; it
  //    keeps being retried after the buy, every tick, until it is done.
  if (day.accounts?.length && day.legs.short && !day.done.flipCover) {
    if (!E.flipWait || E.flipWait.day !== now.day) E.flipWait = { day: now.day, since: Date.now() };
    if (Date.now() - E.flipWait.since < FLIP_COVER_WAIT_MS) return;
    await noteOnce(now, "flip-cover-slow", "warn", "Not every short was confirmed covered within 20 seconds; buying the flip anyway — the cover keeps being retried.");
  }

  // 2. Buy the top gainer, the same quantity in every account of the day.
  let plan = day.legs.long;
  if (!plan) {
    const px = await priceOf(f.symbol, f.px);
    if (px === null) return finish(now, "flip", "error", `No price for ${f.symbol}: the flip's buy was not sent.`);
    const base = day.base ?? settings.base;
    const qty = sizeFor(base, px);
    if (qty < 1) return finish(now, "flip", "warn", `${f.symbol} at ${inr(px)} is above the base value of ${inr(base)}: nothing bought.`);
    plan = { symbol: f.symbol, qty, px };
  }
  const fixed = await fixDay(now, settings, mode, { long: plan });
  plan = fixed.legs.long!;
  const accounts = (fixed.accounts ?? []).filter((a) => !settings.excluded.includes(a));
  if (!accounts.length) return finish(now, "flip", "warn", "10:15 flip: no account to buy in.");
  const dayMode = fixed.mode ?? mode;
  await pool(accounts, 4, (accountId) =>
    openLegIn({ day: now.day, action: "flip-long", leg: "long", accountId, mode: dayMode, symbol: plan!.symbol, qty: plan!.qty, shadowPx: plan!.px, allow: allowFor(now, dayMode) }).catch((err) => {
      console.error(`[live] flip buy for ${accountId} failed:`, err instanceof Error ? err.message : err);
      return null;
    }),
  );
  await finish(
    now,
    "flip",
    "info",
    `10:15 flip${dayMode === "shadow" ? " (shadow)" : ""}: BUY ${plan.qty.toLocaleString("en-IN")} ${plan.symbol} (≈ ${inr(plan.qty * plan.px)}) in ${accounts.length} account${accounts.length === 1 ? "" : "s"}, held to 15:15: ${await outcomes(now.day, "flip-long")}.`,
  );
}

async function closeStep(now: IstNow): Promise<void> {
  if (now.minute < T.CLOSE_AT) return;
  const day = await getDay(now.day, now.date);
  if (day.done.close) return;
  if (!day.accounts?.length) return finish(now, "close", "info", "15:15: no strategy position today.");
  const a = await closeAll(now, day, "close-short", "short");
  const b = await closeAll(now, day, "close-long", "long");
  if (a.converged && b.converged) {
    const failed = a.failed + b.failed;
    return failed === 0
      ? finish(now, "close", "info", "15:15 close: every strategy position is closed.")
      : finish(now, "close", "error", `15:15 close: ${failed} position${failed === 1 ? "" : "s"} could NOT be closed (see the notes above) — close them from Exit below or in Groww before about 15:20.`);
  }
  if (now.minute >= T.CLOSE_GIVE_UP) {
    await finish(now, "close", "error", "15:24 and not every strategy position is confirmed closed — check the orders and positions below; Groww squares intraday positions off itself.");
  }
}
