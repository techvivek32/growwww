import "server-only";
import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Append-only order ledger — every order a user sends through MNHA (placed,
 * rejected or cancelled), recorded server-side at the moment the order action
 * runs. It is the platform's own record ("hisab") of what each account did
 * through it; Groww remains the source of truth for fills and money.
 *
 * Entries are never edited or deleted except when the whole account is erased.
 */

/** "unknown": the request did not complete, so it may or may not have reached
 *  the exchange — recorded as such rather than guessed. */
export type LedgerStatus = "placed" | "rejected" | "cancelled" | "unknown";

export interface LedgerEntry {
  id: string;
  userId: string;
  at: number;
  status: LedgerStatus;
  symbol: string;
  side: string;
  qty: number;
  type: string;
  product: string;
  segment: string;
  exchange: string;
  price: number | null;
  orderId: string | null;
  message: string | null;
}

interface Store { entries: LedgerEntry[] }

const FILE = process.env.LEDGER_FILE ?? path.join(process.cwd(), "data", "ledger.json");
/** Per-account cap, so one account can never push others' records out. */
const MAX_PER_USER = 5_000;

const g = globalThis as { __mnhaLedger?: { queue: Promise<unknown> } };
g.__mnhaLedger ??= { queue: Promise.resolve() };
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaLedger!.queue.then(job, job);
  g.__mnhaLedger!.queue = run.catch(() => undefined);
  return run;
}
async function read(): Promise<Store> {
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { entries: [] };
    throw e;
  }
  // A corrupt file must abort the write, never be treated as empty — that
  // would overwrite the whole history (and its .bak) on the next order.
  const parsed = JSON.parse(raw) as Store;
  if (!Array.isArray(parsed.entries)) throw new Error("ledger: malformed store");
  return parsed;
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

export async function appendOrder(e: Omit<LedgerEntry, "id" | "at">): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    store.entries.push({ ...e, id: `lg-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, at: Date.now() });
    const mine = store.entries.filter((x) => x.userId === e.userId);
    if (mine.length > MAX_PER_USER) {
      const drop = new Set(mine.slice(0, mine.length - MAX_PER_USER).map((x) => x.id));
      store.entries = store.entries.filter((x) => !drop.has(x.id));
    }
    await write(store);
  });
}

/** Newest first; optionally for one user. */
export async function listOrders(userId?: string, limit = 200): Promise<LedgerEntry[]> {
  const all = (await read().catch(() => ({ entries: [] as LedgerEntry[] }))).entries;
  return all
    .filter((e) => !userId || e.userId === userId)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

export interface UserOrderStats {
  userId: string;
  placed: number;
  rejected: number;
  cancelled: number;
  unknown: number;
  lastAt: number | null;
}

/** Per-user counts across the whole ledger. */
export async function orderStatsByUser(): Promise<Map<string, UserOrderStats>> {
  const by = new Map<string, UserOrderStats>();
  for (const e of (await read().catch(() => ({ entries: [] as LedgerEntry[] }))).entries) {
    const s = by.get(e.userId) ?? { userId: e.userId, placed: 0, rejected: 0, cancelled: 0, unknown: 0, lastAt: null };
    s[e.status]++;
    s.lastAt = Math.max(s.lastAt ?? 0, e.at);
    by.set(e.userId, s);
  }
  return by;
}

/** Erase one account's entries — only on full account deletion (DPDP). */
export async function deleteOrders(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const before = store.entries.length;
    store.entries = store.entries.filter((e) => e.userId !== userId);
    if (store.entries.length !== before) await write(store, true);
  });
}
