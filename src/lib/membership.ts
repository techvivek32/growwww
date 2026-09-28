import "server-only";
import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";

/**
 * Performance-fee membership — the LAWFUL version of the profit-share idea:
 *
 *  - The platform earns a fee ONLY on profit, and only on NEW profit above the
 *    member's previous peak (a high-water mark) — the standard, fair structure.
 *  - There is NO guarantee against loss and NO loss coverage. A loss is entirely
 *    the member's own. (Guaranteed/assured returns are prohibited in India even
 *    for a registered portfolio manager — so they are intentionally absent.)
 *  - The money never leaves the member's own broker account; the platform takes
 *    no custody. The fee is an accrual/estimate shown here; actual collection is
 *    out of band (a payment rail is not built).
 *
 * Operating a performance-fee service requires the operator's own SEBI
 * registration (PMS/IA). That is the operator's responsibility; this module is
 * neutral fee-accounting software.
 */

export const DEFAULT_FEE_PCT = 25;
export const DEFAULT_PERIOD_DAYS = 22;
export const SUGGESTED_MIN_CAPITAL = 500_000;
const DAY = 24 * 3600 * 1000;

export type MemberStatus = "none" | "active" | "ended";

export interface Membership {
  userId: string;
  status: MemberStatus;
  feePct: number;
  periodDays: number;
  startNav: number;
  highWaterMark: number;
  enrolledAt: number;
  periodEndsAt: number;
  lastNav: number | null;
  lastNavAt: number | null;
  endedAt: number | null;
}

interface Store { members: Membership[] }

const FILE = process.env.MEMBERSHIP_FILE ?? path.join(process.cwd(), "data", "memberships.json");

const g = globalThis as { __mnhaMembers?: { queue: Promise<unknown> } };
g.__mnhaMembers ??= { queue: Promise.resolve() };
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaMembers!.queue.then(job, job);
  g.__mnhaMembers!.queue = run.catch(() => undefined);
  return run;
}
async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Store;
    return Array.isArray(parsed.members) ? parsed : { members: [] };
  } catch { return { members: [] }; }
}
async function write(store: Store): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  try { await copyFile(FILE, `${FILE}.bak`); } catch { /* first write */ }
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
}

export async function getMembership(userId: string): Promise<Membership | null> {
  return (await read()).members.find((m) => m.userId === userId) ?? null;
}

/** Enrol (or re-enrol) with the account's current value as the starting NAV
 *  and the high-water mark. */
export async function enroll(userId: string, startNav: number, feePct = DEFAULT_FEE_PCT, periodDays = DEFAULT_PERIOD_DAYS): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const now = Date.now();
    const m: Membership = {
      userId, status: "active", feePct, periodDays,
      startNav, highWaterMark: startNav,
      enrolledAt: now, periodEndsAt: now + periodDays * DAY,
      lastNav: startNav, lastNavAt: now, endedAt: null,
    };
    const i = store.members.findIndex((x) => x.userId === userId);
    if (i >= 0) store.members[i] = m; else store.members.push(m);
    await write(store);
  });
}

/** Record the latest observed NAV (from the member's own account context). */
export async function updateNav(userId: string, nav: number): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const m = store.members.find((x) => x.userId === userId);
    if (!m || m.status !== "active") return;
    m.lastNav = nav;
    m.lastNavAt = Date.now();
    await write(store);
  });
}

export async function leave(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const m = store.members.find((x) => x.userId === userId);
    if (m) { m.status = "ended"; m.endedAt = Date.now(); await write(store); }
  });
}

export async function deleteMembership(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const before = store.members.length;
    store.members = store.members.filter((m) => m.userId !== userId);
    if (store.members.length !== before) await write(store);
  });
}

export async function listMembers(): Promise<Membership[]> {
  return (await read()).members.slice().sort((a, b) => b.enrolledAt - a.enrolledAt);
}

export interface Accrual {
  profit: number;        // nav − high-water mark
  feeEstimate: number;   // fee on positive profit only
  userKeeps: number;     // profit − fee (or the loss, all the member's)
  aboveHWM: boolean;
  daysLeft: number;
}

/** Fee accrual for a NAV — fee only on new profit above the high-water mark. */
export function accrual(m: Membership, nav: number): Accrual {
  const profit = +(nav - m.highWaterMark).toFixed(2);
  const feeEstimate = profit > 0 ? +((profit * m.feePct) / 100).toFixed(2) : 0;
  const userKeeps = +(profit - feeEstimate).toFixed(2);
  return {
    profit,
    feeEstimate,
    userKeeps,
    aboveHWM: profit > 0,
    daysLeft: Math.max(0, Math.ceil((m.periodEndsAt - Date.now()) / DAY)),
  };
}
