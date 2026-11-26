import "server-only";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OrderType, Product, Side } from "@/lib/types";

/**
 * Live trading's own record: the admin's settings (mode, base value, kept-out
 * accounts) with a log of every change, each trading day's plan (which
 * accounts take the strategy's orders, which steps are done), and every order
 * live trading sends or simulates.
 *
 * An order is written BEFORE it is sent, under an id that is fixed for that
 * day, step, account and attempt. A restart therefore finds it and follows it
 * up by its Groww reference instead of sending it again.
 *
 * Like the other stores: one JSON file, written whole through a temp file and
 * a rename, all writes queued through one process-wide queue. A file that
 * cannot be read stops every write (it is never treated as empty), so a
 * corrupt store can never lose the record of what was sent.
 */

/**
 * The admin panel has one switch: "off" or "live". "shadow" (work every step out and record it,
 * send nothing) stays in the engine only for its tests; a "shadow" left in an older file reads as "off".
 */
export type LiveMode = "off" | "shadow" | "live";

/** Rupees per trade, the same in every account — and the least free money an account needs to take part. */
export const DEFAULT_BASE = 500_000;
export const MIN_BASE = 10_000;
export const MAX_BASE = 5_000_000;

export interface LiveSettings {
  mode: LiveMode;
  /** The active (auto) book's trades sent to the accounts: off unless the admin turns it on (absent = off). */
  activeMode?: LiveMode;
  base: number;
  /** Accounts the admin keeps out of the automatic strategy. */
  excluded: string[];
  updatedAt: number | null;
}

export interface SettingsChange {
  at: number;
  ip: string;
  /** Accounts appear only as {{acct:<id>}} tokens, named when shown — never an email on file. */
  what: string;
}

/** How an account is written into notes and the change log: a token the page turns into its name. */
export const acctToken = (id: string) => `{{acct:${id}}}`;

/** The active (auto) book's trades of a day, in order: at most four. */
export type ActiveN = 1 | 2 | 3 | 4;
export const ACTIVE_MAX = 4;
/** An active-book trade's leg: its number and direction ("a2-long" is the day's second active trade, a buy). */
export type ActiveLeg = `a${ActiveN}-short` | `a${ActiveN}-long`;

/** The strategy's two legs (the 09:20 short, and the 10:15 flip's long), and the active book's trades. */
export type Leg = "short" | "long" | ActiveLeg;

/** True for a leg opened by selling (the 09:20 short, or an active-book short). */
export const isShortLeg = (leg: Leg): boolean => leg === "short" || leg.endsWith("-short");

/** Every leg a day can hold, for matching a position to the leg that opened it. */
export const ALL_LEGS: Leg[] = ["short", "long", ...([1, 2, 3, 4] as ActiveN[]).flatMap((n) => [`a${n}-short`, `a${n}-long`] as ActiveLeg[])];

export type OrderAction =
  | "entry" // 09:20: sell the pick short
  | "stop-cover" // market stop: buy the short back
  | "flip-cover" // 10:15 flip: buy the short back
  | "flip-long" // 10:15 flip: buy the top gainer
  | "close-short" // 15:15: buy back what is left of the short
  | "close-long" // 15:15: sell what is left of the long
  | "manual" // the admin's order to many accounts
  | "exit" // the admin's exit of a position
  | `active-open-${ActiveN}` // the active (auto) book's trade n: its opening order
  | `active-close-${ActiveN}` // the active book's trade n: closed because the book closed it (or its fail-safe)
  | `active-eod-${ActiveN}`; // the active book's trade n: whatever is left of it at 15:15

export const ACTION_LABEL: Record<OrderAction, string> = {
  entry: "09:20 entry (short)",
  "stop-cover": "Market stop: cover",
  "flip-cover": "10:15 flip: cover",
  "flip-long": "10:15 flip: buy",
  "close-short": "15:15 close: cover",
  "close-long": "15:15 close: sell",
  manual: "Admin order",
  exit: "Admin exit",
  "active-open-1": "Active trade 1: open",
  "active-open-2": "Active trade 2: open",
  "active-open-3": "Active trade 3: open",
  "active-open-4": "Active trade 4: open",
  "active-close-1": "Active trade 1: close",
  "active-close-2": "Active trade 2: close",
  "active-close-3": "Active trade 3: close",
  "active-close-4": "Active trade 4: close",
  "active-eod-1": "Active trade 1: 15:15 close",
  "active-eod-2": "Active trade 2: 15:15 close",
  "active-eod-3": "Active trade 3: 15:15 close",
  "active-eod-4": "Active trade 4: 15:15 close",
};

export type SendState =
  | "sending" // written before the call; how it ended is not known yet
  | "placed" // Groww took it (see status and filled)
  | "rejected" // Groww or the exchange said no
  | "unknown" // the call did not complete: being looked up by its reference
  | "refused" // stopped here, before anything was sent
  | "not-sent" // looked up: Groww never received it
  | "shadow"; // shadow mode: recorded as if filled, never sent

export interface LiveOrder {
  id: string;
  /** Our reference, sent to Groww as order_reference_id. */
  ref: string;
  /** IST day number. */
  day: number;
  at: number;
  updatedAt: number;
  source: "auto" | "admin";
  mode: "live" | "shadow";
  action: OrderAction;
  /** The strategy leg the order opens or closes (an admin exit of a strategy position counts too). */
  leg: Leg | null;
  /** The admin action it belongs to. */
  batch: string | null;
  accountId: string;
  symbol: string;
  side: Side;
  qty: number;
  product: Product;
  type: OrderType;
  price: number | null;
  segment: "CASH" | "FNO";
  exchange: "NSE" | "BSE";
  state: SendState;
  orderId: string | null;
  /** Groww's own status word. */
  status: string | null;
  filled: number | null;
  avg: number | null;
  message: string | null;
  /** Nothing more will happen to it (or it stopped being followed). */
  final: boolean;
  /** Written to the account's order ledger and told to the account holder (at most once). */
  booked: boolean;
  /** When the send call returned (absent while sending, and on records a crash left "sending"). */
  sentAt?: number | null;
  /** Complete order-book reads that did not list it while its outcome was unknown, and when the last was. */
  misses?: number;
  missAt?: number | null;
  /** When MNHA last asked Groww to cancel it, and how many times it has asked. */
  cancelAt?: number | null;
  cancelTries?: number;
}

export interface DayNote {
  at: number;
  tone: "info" | "warn" | "error";
  text: string;
}

export interface LegPlan {
  symbol: string;
  qty: number;
  /** The price the quantity was worked out from. */
  px: number;
}

export interface ActiveDay {
  mode: "live" | "shadow";
  /** Every account that took an active-book order today. */
  accounts: string[];
  /** The ceiling per account (the base value) when the day was fixed. */
  base: number;
  fixedAt: number;
  /** Trade number → what was sent to open it: qty is the total, sizes each account's own quantity (from its free money). */
  opened: Partial<Record<ActiveN, LegPlan & { leg: ActiveLeg; key: string; sizes: Record<string, number> }>>;
  /** Trade number → when its close converged in every account. */
  closed: Partial<Record<ActiveN, number>>;
  /** Trade number → why it was not followed (seen too late, no account with money, ...). */
  skipped: Partial<Record<ActiveN, string>>;
  /** Trade number → when its exit could not be done in every account (retried at 15:15 under its own action). */
  exitFailed?: Partial<Record<ActiveN, number>>;
}

/** The research engine's decisions, kept once seen, so an outage after them cannot hold up a cover. */
export interface DaySignals {
  skip?: boolean;
  /** failsafe: not the research engine's stop — its watcher went silent, so the short was covered to be safe. */
  mstop?: { at: number; move: number | null; failsafe?: boolean };
  flip?: { at: number; do: boolean; symbol: string | null; px: number | null };
  /** The market-stop watcher's latest heartbeat seen (epoch seconds), kept across restarts. */
  beat?: number;
}

export interface DayState {
  day: number;
  date: string;
  /** The mode the day's strategy orders run in — fixed with the account list. */
  mode: "live" | "shadow" | null;
  /** The base value the day's quantities were worked out from. */
  base: number | null;
  /** The accounts that take the day's strategy orders, fixed at the first one. */
  accounts: string[] | null;
  fixedAt: number | null;
  legs: { short?: LegPlan; long?: LegPlan };
  /** When each step finished; a finished step never runs again that day. flipCover:
   *  the 10:15 flip's cover of the short, kept apart from the flip's buy so a late
   *  or failed buy can never leave the short open. */
  done: { entry?: number; stop?: number; flipCover?: number; flip?: number; close?: number };
  /** The active (auto) book in the accounts today. Absent: nothing of it was sent today. */
  active?: ActiveDay;
  signals: DaySignals;
  notes: DayNote[];
}

interface Store {
  v: 1;
  settings: LiveSettings;
  changes: SettingsChange[];
  days: DayState[];
  orders: LiveOrder[];
}

const FILE = process.env.LIVE_TRADING_FILE ?? path.join(process.cwd(), "data", "live-trading.json");
const MAX_CHANGES = 300;
const MAX_DAYS = 60;
const MAX_NOTES_PER_DAY = 300;
const MAX_ORDERS = 4_000;

const fresh = (): Store => ({
  v: 1,
  // Off by default: nothing is sent until the admin turns automatic trading on.
  settings: { mode: "off", base: DEFAULT_BASE, excluded: [], updatedAt: null },
  changes: [],
  days: [],
  orders: [],
});

const g = globalThis as { __mnhaLive?: { queue: Promise<unknown>; cache: Store | null } };
g.__mnhaLive ??= { queue: Promise.resolve(), cache: null };
const S = g.__mnhaLive;

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = S.queue.then(job, job);
  S.queue = run.catch(() => undefined);
  return run;
}

async function load(): Promise<Store> {
  if (S.cache) return S.cache;
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return (S.cache = fresh());
    throw e;
  }
  const parsed = JSON.parse(raw) as Store;
  if (parsed?.v !== 1 || !parsed.settings || !Array.isArray(parsed.orders) || !Array.isArray(parsed.days) || !Array.isArray(parsed.changes)) {
    throw new Error("live-trading: malformed store");
  }
  if (parsed.settings.mode === "shadow") parsed.settings.mode = "off"; // the panel no longer offers it
  return (S.cache = parsed);
}

async function save(store: Store): Promise<void> {
  // Bounded: the ledger keeps every account's permanent record; this file keeps the recent working set.
  if (store.changes.length > MAX_CHANGES) store.changes = store.changes.slice(-MAX_CHANGES);
  if (store.days.length > MAX_DAYS) store.days = [...store.days].sort((a, b) => a.day - b.day).slice(-MAX_DAYS);
  if (store.orders.length > MAX_ORDERS) {
    // Drop the oldest finished orders; one still being followed always stays.
    const excess = store.orders.length - MAX_ORDERS;
    const drop = new Set(
      [...store.orders].filter((o) => o.final).sort((a, b) => a.at - b.at).slice(0, excess).map((o) => o.id),
    );
    store.orders = store.orders.filter((o) => !drop.has(o.id));
  }
  await mkdir(path.dirname(FILE), { recursive: true });
  try {
    await copyFile(FILE, `${FILE}.bak`);
  } catch {
    /* first write */
  }
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store), "utf8");
  await rename(tmp, FILE);
  S.cache = store;
}

/** Change the store under the queue. The change is applied to a copy, so a
 *  write that fails leaves the cached store exactly as the file is. */
function mutate<T>(fn: (s: Store) => T): Promise<T> {
  return enqueue(async () => {
    const copy = structuredClone(await load());
    const out = fn(copy);
    await save(copy);
    return out;
  });
}

/** A read of part of the latest store — a copy, so a caller can never change the store by accident. */
function readPart<T>(pick: (s: Store) => T): Promise<T> {
  return enqueue(async () => structuredClone(pick(await load())));
}

/* ---------------------------------------------------------------- settings */

export async function getSettings(): Promise<LiveSettings> {
  return readPart((s) => s.settings);
}

export async function recentChanges(limit = 40): Promise<SettingsChange[]> {
  return (await readPart((s) => s.changes.slice(-limit))).reverse();
}

export async function setMode(mode: LiveMode, ip: string): Promise<void> {
  await mutate((s) => {
    if (s.settings.mode === mode) return;
    s.changes.push({ at: Date.now(), ip, what: `Mode ${s.settings.mode} → ${mode}` });
    s.settings.mode = mode;
    s.settings.updatedAt = Date.now();
  });
}

export async function setActiveMode(mode: LiveMode, ip: string): Promise<void> {
  await mutate((s) => {
    const was = s.settings.activeMode ?? "off";
    if (was === mode) return;
    s.changes.push({ at: Date.now(), ip, what: `Active (auto) book ${was} → ${mode}` });
    s.settings.activeMode = mode;
    s.settings.updatedAt = Date.now();
  });
}

export async function setBase(base: number, ip: string): Promise<void> {
  if (!Number.isInteger(base) || base < MIN_BASE || base > MAX_BASE) throw new Error("base out of range");
  await mutate((s) => {
    if (s.settings.base === base) return;
    s.changes.push({ at: Date.now(), ip, what: `Base value ₹${s.settings.base.toLocaleString("en-IN")} → ₹${base.toLocaleString("en-IN")}` });
    s.settings.base = base;
    s.settings.updatedAt = Date.now();
  });
}

export async function setExcluded(accountId: string, excluded: boolean, ip: string): Promise<void> {
  await mutate((s) => {
    const has = s.settings.excluded.includes(accountId);
    if (has === excluded) return;
    s.settings.excluded = excluded ? [...s.settings.excluded, accountId] : s.settings.excluded.filter((x) => x !== accountId);
    s.changes.push({ at: Date.now(), ip, what: `${excluded ? "Kept out" : "Taken back in"}: ${acctToken(accountId)}` });
    s.settings.updatedAt = Date.now();
  });
}

/* -------------------------------------------------------------------- days */

const emptyDay = (day: number, date: string): DayState => ({
  day,
  date,
  mode: null,
  base: null,
  accounts: null,
  fixedAt: null,
  legs: {},
  done: {},
  signals: {},
  notes: [],
});

export async function getDay(day: number, date: string): Promise<DayState> {
  const d = await readPart((s) => s.days.find((x) => x.day === day) ?? null);
  return d ? { ...d, signals: d.signals ?? {} } : emptyDay(day, date);
}

export async function recentDays(limit = 10): Promise<DayState[]> {
  return readPart((s) => [...s.days].sort((a, b) => b.day - a.day).slice(0, limit));
}

/** Change one day's plan (created on first use). */
export async function updateDay<T>(day: number, date: string, fn: (d: DayState) => T): Promise<T> {
  return mutate((s) => {
    let d = s.days.find((x) => x.day === day);
    if (!d) {
      d = emptyDay(day, date);
      s.days.push(d);
    }
    d.signals ??= {};
    const out = fn(d);
    if (d.notes.length > MAX_NOTES_PER_DAY) d.notes = d.notes.slice(-MAX_NOTES_PER_DAY);
    return out;
  });
}

export async function addNote(day: number, date: string, tone: DayNote["tone"], text: string): Promise<void> {
  await updateDay(day, date, (d) => {
    d.notes.push({ at: Date.now(), tone, text });
  });
}

/* ------------------------------------------------------------------ orders */

/**
 * Record an order before it is sent. Returns false (and writes nothing) when
 * an order with that id is already on record: the caller must not send it.
 */
export async function insertOrder(o: LiveOrder): Promise<boolean> {
  return mutate((s) => {
    if (s.orders.some((x) => x.id === o.id || x.ref === o.ref)) return false;
    s.orders.push(o);
    return true;
  });
}

export async function patchOrder(id: string, patch: Partial<Omit<LiveOrder, "id" | "ref">>): Promise<LiveOrder | null> {
  return mutate((s) => {
    const o = s.orders.find((x) => x.id === id);
    if (!o) return null;
    Object.assign(o, patch, { updatedAt: Date.now() });
    return { ...o };
  });
}

export async function getOrder(id: string): Promise<LiveOrder | null> {
  return readPart((s) => s.orders.find((o) => o.id === id) ?? null);
}

export async function ordersOfDay(day: number): Promise<LiveOrder[]> {
  return readPart((s) => s.orders.filter((o) => o.day === day).sort((a, b) => a.at - b.at));
}

export async function recentOrders(limit = 300): Promise<LiveOrder[]> {
  return readPart((s) => [...s.orders].sort((a, b) => b.at - a.at).slice(0, limit));
}

/** Orders still being followed (sent, and not yet in a final state), any day. */
export async function openOrders(): Promise<LiveOrder[]> {
  return readPart((s) => s.orders.filter((o) => !o.final && o.mode === "live"));
}

/* ----------------------------------------------------------------- erasure */

/** On account erasure: the account's orders go, it leaves every list, and every
 *  note and change that names it says "an erased account" instead. The file and
 *  its backup are always rewritten, so neither keeps anything of it. */
export async function forgetAccount(accountId: string): Promise<void> {
  const token = acctToken(accountId);
  const scrub = (t: string) => t.split(token).join("an erased account");
  await enqueue(async () => {
    const copy = structuredClone(await load());
    copy.orders = copy.orders.filter((o) => o.accountId !== accountId);
    copy.settings.excluded = copy.settings.excluded.filter((x) => x !== accountId);
    for (const c of copy.changes) c.what = scrub(c.what);
    for (const d of copy.days) {
      if (d.accounts) d.accounts = d.accounts.filter((x) => x !== accountId);
      for (const n of d.notes) n.text = scrub(n.text);
    }
    await save(copy);
    await copyFile(FILE, `${FILE}.bak`);
  });
}
