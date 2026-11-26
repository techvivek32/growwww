import "server-only";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isReservedId } from "./auth";
import { listUsers } from "./users";
import { balanceAs } from "./api/broker";
import type { BalanceReading } from "./api/groww";
import { istDate, istMinute, windowOf, type BalanceRow, type ReadingWhy } from "./balanceDays";

export { dayLines, dayShare, istDate, type BalanceRow, type DayLine, type ReadingWhy } from "./balanceDays";

/**
 * The daily balance record behind each user's P&L on /admin/vivek/[id]: Groww's own figures, read on a
 * timer and kept here, because Groww's API gives no balance history (only the balance now and the
 * current day's positions).
 *
 * How a day's P&L is worked out (the owner's rule, 26 Nov 2026): the settled balance after the day,
 * less the balance the day started with.
 *  - Clear cash does not move while the day's trades run; Groww settles them into it afterwards. Seen
 *    26 Nov 2026: unchanged at 16:38 after a day of intraday trades.
 *  - So a day's start is the clear cash in effect at its 15:30 close.
 *  - Its end is the clear cash in effect at the next trading day's 15:30 close, by when Groww has
 *    settled it. Before then, it is any changed figure already seen, or "not settled yet".
 *  - A deposit or a withdrawal moves the balance too, and shows up as P&L: Groww's API does not report
 *    them. Each day also keeps Groww's realised P&L before charges, to compare.
 */

interface Store {
  rows: BalanceRow[];
}

const FILE = process.env.BALANCES_FILE ?? path.join(process.cwd(), "data", "balances.json");
/** Per user, enough for years at a few rows a day. */
const MAX_PER_USER = 4000;
const MINUTE = 60_000;

const g = globalThis as {
  __mnhaBalances?: { queue: Promise<unknown>; timer: NodeJS.Timeout | null; lastQuarter: string; running: boolean };
};
g.__mnhaBalances ??= { queue: Promise.resolve(), timer: null, lastQuarter: "", running: false };
const S = g.__mnhaBalances;

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = S.queue.then(job, job);
  S.queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<Store> {
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { rows: [] };
    throw e;
  }
  // A corrupt file must stop a write rather than be taken as empty: that would throw the history away.
  const parsed = JSON.parse(raw) as Store;
  if (!Array.isArray(parsed.rows)) throw new Error("balances: malformed store");
  return parsed;
}

async function write(store: Store): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  try {
    await copyFile(FILE, `${FILE}.bak`);
  } catch {
    /* first write */
  }
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
  await rename(tmp, FILE);
}

/* --------------------------------------------------------------- the record */

/**
 * Keep one reading.
 *  - "linked" and "seed" rows are always kept.
 *  - A "watch" reading is kept when the cash moved.
 *  - Outside the session, it is also kept when the margin in use or the realised P&L moved.
 *  - And it is always kept once per part of the day, so every day has a row before the open and one
 *    after the close.
 */
export async function recordBalance(userId: string, reading: BalanceReading, why: ReadingWhy, note?: string, at = Date.now()): Promise<boolean> {
  return enqueue(async () => {
    const store = await read();
    let last: BalanceRow | undefined;
    for (let i = store.rows.length - 1; i >= 0; i--) {
      if (store.rows[i].userId === userId) {
        last = store.rows[i];
        break;
      }
    }
    if (why === "watch" && last) {
      const win = windowOf(at);
      const quiet = win.endsWith(":mkt");
      const moved = last.cash !== reading.cash || (!quiet && (last.used !== reading.used || last.realised !== reading.realised));
      if (!moved && windowOf(last.at) === win) return false;
    }
    store.rows.push({ userId, at, why, cash: reading.cash, used: reading.used, realised: reading.realised, ...(note ? { note } : {}) });
    const mine = store.rows.filter((r) => r.userId === userId);
    if (mine.length > MAX_PER_USER) {
      const drop = new Set(mine.slice(0, mine.length - MAX_PER_USER));
      store.rows = store.rows.filter((r) => !drop.has(r));
    }
    await write(store);
    return true;
  });
}

/** One user's readings, oldest first. Throws when the record cannot be read: never a silent empty. */
export async function balanceRows(userId: string): Promise<BalanceRow[]> {
  return (await read()).rows.filter((r) => r.userId === userId).sort((a, b) => a.at - b.at);
}

/** Erase one account's readings: on full account deletion. */
export async function deleteBalances(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const before = store.rows.length;
    store.rows = store.rows.filter((r) => r.userId !== userId);
    if (store.rows.length !== before) await write(store);
  });
}

/** The balance at the moment Groww is linked. Best effort: a failure here never fails the connection. */
export async function recordLinkedBalance(userId: string): Promise<void> {
  try {
    const reading = await balanceAs(userId);
    if (reading) await recordBalance(userId, reading, "linked");
  } catch (err) {
    console.error(`[balances] linked balance not recorded for ${userId}:`, err instanceof Error ? err.message : err);
  }
}

/* ----------------------------------------------------------------- the timer */

/** One pass: every member with Groww connected, one after another. */
async function pass(): Promise<void> {
  if (S.running) return;
  S.running = true;
  try {
    const users = (await listUsers()).filter((u) => u.hasBroker && !isReservedId(u.id));
    for (const u of users) {
      const reading = await balanceAs(u.id);
      if (reading) await recordBalance(u.id, reading, "watch");
    }
  } catch (err) {
    console.error("[balances] pass failed:", err instanceof Error ? err.message : err);
  } finally {
    S.running = false;
  }
}

/**
 * Read every connected account every quarter hour, day and night: when Groww settles a day is its
 * business, so a settlement is seen within 15 minutes whenever it lands. A first pass runs a minute
 * after boot. Started once, from instrumentation; a restart keeps the history (it is on disk).
 */
export function startBalanceWatch(): void {
  if (S.timer) return;
  setTimeout(() => void pass(), MINUTE);
  S.timer = setInterval(() => {
    const now = Date.now();
    const m = istMinute(now);
    if (m % 15 !== 0) return;
    // Keep off Groww around the strategy's 09:20 entry and 15:15 close: those calls matter more.
    if ((m >= 9 * 60 + 10 && m < 9 * 60 + 25) || (m >= 15 * 60 + 10 && m < 15 * 60 + 20)) return;
    const key = `${istDate(now)}:${m}`;
    if (S.lastQuarter === key) return;
    S.lastQuarter = key;
    void pass();
  }, 20_000);
  S.timer.unref?.();
}
