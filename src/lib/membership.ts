import "server-only";
import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

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

/**
 * A settled performance period — the platform's fee "bill" for one member.
 * Fee only on profit above the high-water mark; nothing is ever charged on a
 * loss. Settlement is recorded here; collection happens out of band.
 */
export type InvoiceStatus = "due" | "paid" | "waived";
export interface Invoice {
  id: string;
  userId: string;
  periodStart: number;
  periodEnd: number;
  hwmBefore: number;
  endNav: number;
  profitAboveHwm: number;
  feePct: number;
  feeDue: number;
  status: InvoiceStatus;
  createdAt: number;
  settledAt: number | null;
  note: string;
}

interface Store { members: Membership[]; invoices: Invoice[] }

const FILE = process.env.MEMBERSHIP_FILE ?? path.join(process.cwd(), "data", "memberships.json");

const g = globalThis as { __mnhaMembers?: { queue: Promise<unknown> } };
g.__mnhaMembers ??= { queue: Promise.resolve() };
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaMembers!.queue.then(job, job);
  g.__mnhaMembers!.queue = run.catch(() => undefined);
  return run;
}
async function read(): Promise<Store> {
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch (e) {
    // Billing records: a read failure must never look like "no invoices".
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { members: [], invoices: [] };
    throw e;
  }
  const parsed = JSON.parse(raw) as Partial<Store>;
  if (!Array.isArray(parsed.members)) throw new Error("memberships: malformed store");
  return { members: parsed.members, invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [] };
}
/** `scrubBackup`: on erasure, overwrite the .bak too, so deleted data does not linger in the backup. */
async function write(store: Store, scrubBackup = false): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  try { await copyFile(FILE, `${FILE}.bak`); } catch { /* first write */ }
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
  if (scrubBackup) await copyFile(FILE, `${FILE}.bak`);
}

export async function getMembership(userId: string): Promise<Membership | null> {
  return (await read()).members.find((m) => m.userId === userId) ?? null;
}

/** Enrol (or re-enrol) with the account's current value as the starting NAV.
 *  A returning member keeps their previous high-water mark (if higher), so
 *  leaving and re-joining can never re-bill gains already billed. */
export async function enroll(userId: string, startNav: number, feePct = DEFAULT_FEE_PCT, periodDays = DEFAULT_PERIOD_DAYS): Promise<boolean> {
  return enqueue(async () => {
    const store = await read();
    const now = Date.now();
    const prev = store.members.find((x) => x.userId === userId);
    // Re-enrolling an ACTIVE membership would reset its open period without
    // billing it — refuse; leave() closes the period properly.
    if (prev?.status === "active") return false;
    const m: Membership = {
      userId, status: "active", feePct, periodDays,
      startNav, highWaterMark: Math.max(startNav, prev?.highWaterMark ?? 0),
      enrolledAt: now, periodEndsAt: now + periodDays * DAY,
      lastNav: startNav, lastNavAt: now, endedAt: null,
    };
    const i = store.members.findIndex((x) => x.userId === userId);
    if (i >= 0) store.members[i] = m; else store.members.push(m);
    await write(store);
    return true;
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

/**
 * End a membership. The open period is closed first at `endNav` (a strict
 * live reading taken by the caller), so leaving just before a period ends can
 * never skip a fee that was earned. Returns the closing invoice, if any.
 */
export async function leave(userId: string, endNav: number): Promise<Invoice | null> {
  if (!Number.isFinite(endNav) || endNav < 0) return null;
  return enqueue(async () => {
    const store = await read();
    const m = store.members.find((x) => x.userId === userId);
    if (!m || m.status !== "active") return null;
    const now = Date.now();
    const invoice = closePeriod(store, m, endNav, now);
    m.status = "ended";
    m.endedAt = now;
    await write(store);
    return invoice;
  });
}

/**
 * Erase a member's membership record. Invoices are KEPT: they are the
 * platform's billing records (an opaque user id and amounts — no personal
 * details), and deleting an account must not erase a fee that is owed.
 */
export async function deleteMembership(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const before = store.members.length;
    store.members = store.members.filter((m) => m.userId !== userId);
    if (store.members.length !== before) await write(store, true);
  });
}

/** True while the user has an unpaid ("due") invoice. */
export async function hasDueInvoice(userId: string): Promise<boolean> {
  return (await read()).invoices.some((iv) => iv.userId === userId && iv.status === "due");
}

/** Bill one period inside an already-read store (caller writes). */
function closePeriod(store: Store, m: Membership, endNav: number, now: number): Invoice {
  const profitAboveHwm = +Math.max(0, endNav - m.highWaterMark).toFixed(2);
  const feeDue = +((profitAboveHwm * m.feePct) / 100).toFixed(2);
  const invoice: Invoice = {
    id: `inv-${now.toString(36)}-${randomBytes(3).toString("hex")}`,
    userId: m.userId,
    periodStart: m.periodEndsAt - m.periodDays * DAY,
    periodEnd: now,
    hwmBefore: m.highWaterMark,
    endNav,
    profitAboveHwm,
    feePct: m.feePct,
    feeDue,
    status: feeDue > 0 ? "due" : "waived",
    createdAt: now,
    settledAt: feeDue > 0 ? null : now,
    note: feeDue > 0 ? "" : "No profit above the high-water mark — no fee.",
  };
  store.invoices.push(invoice);
  m.highWaterMark = Math.max(m.highWaterMark, endNav);
  m.lastNav = endNav;
  m.lastNavAt = now;
  m.periodEndsAt = now + m.periodDays * DAY;
  return invoice;
}

/**
 * Close the member's current performance period at `endNav`: bill the fee on
 * profit above the high-water mark (nothing on a loss), raise the mark to the
 * new peak, and open the next period. Returns the invoice raised, or null when
 * nothing was settled.
 *
 * Refuses before the period's end unless `force` is set. `periodEndsAt`, when
 * given, must match the member's current period exactly — so a repeated submit
 * (double click, retried request) can never bill the same period twice. Both
 * checks run inside the queue, so they are atomic with the write.
 */
export async function settlePeriod(
  userId: string,
  endNav: number,
  opts: { force?: boolean; periodEndsAt?: number } = {},
): Promise<Invoice | null> {
  if (!Number.isFinite(endNav) || endNav < 0) return null;
  return enqueue(async () => {
    const store = await read();
    const m = store.members.find((x) => x.userId === userId && x.status === "active");
    if (!m) return null;
    const now = Date.now();
    if (!opts.force && now < m.periodEndsAt) return null;
    if (opts.periodEndsAt !== undefined && opts.periodEndsAt !== m.periodEndsAt) return null;
    const invoice = closePeriod(store, m, endNav, now);
    await write(store);
    return invoice;
  });
}

/** The member-facing message for a settled period (one wording everywhere). */
export function settlementNotice(iv: Invoice, opts: { ended?: boolean } = {}): { title: string; body: string } {
  const rs = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
  const next = opts.ended ? "Your membership has now ended." : "A new period has started.";
  return iv.feeDue > 0
    ? {
        title: "Performance period settled",
        body: `Profit above your previous peak: ${rs(iv.profitAboveHwm)}. Fee due (${iv.feePct}%): ${rs(iv.feeDue)} — collected separately, never auto-debited. ${next}`,
      }
    : {
        title: "Period closed — no fee",
        body: `No profit above your previous peak, so there is no fee for this period. ${next}`,
      };
}

export async function markInvoice(id: string, status: "paid" | "waived"): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const iv = store.invoices.find((x) => x.id === id);
    if (!iv || iv.status !== "due") return;
    iv.status = status;
    iv.settledAt = Date.now();
    await write(store);
  });
}

export async function listInvoices(userId?: string): Promise<Invoice[]> {
  return (await read()).invoices
    .filter((iv) => !userId || iv.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
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
