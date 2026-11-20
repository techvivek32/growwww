import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A log of every time the admin opens or leaves a client's account, and of the
 * acts the admin performs inside it: connecting Groww, placing or cancelling
 * an order — and of the orders and exits the admin sends to many accounts at
 * once from Live trading. It is a security log: it keeps the client's internal id (not their
 * email or any other personal detail), when, and the admin's IP — and only the
 * latest entries, so it rotates out by itself.
 *
 * An order or cancel line also says what was sent and how it ended. That is
 * the client's trading data, so it is wiped when the account is erased; the
 * fact that the admin acted, when and from where, stays.
 */

export interface AdminAccess {
  at: number;
  /** bulk-order / bulk-exit: an order or exit the admin sent to this client's
   *  account from Live trading (one line per account). */
  kind: "open" | "close" | "connect-broker" | "order" | "cancel" | "bulk-order" | "bulk-exit";
  userId: string;
  ip: string;
  /** Order, cancel and bulk lines only: what was sent and how it ended. */
  detail?: string;
}

interface Store {
  items: AdminAccess[];
}

const FILE = process.env.ADMIN_ACCESS_FILE ?? path.join(process.cwd(), "data", "admin-access.json");
const MAX_ITEMS = 1000;
/** Live trading's per-account lines are kept apart, so a big batch never pushes out the account openings. */
const MAX_BULK = 3000;
const isBulk = (e: AdminAccess) => e.kind === "bulk-order" || e.kind === "bulk-exit";

const g = globalThis as { __mnhaAdminAccess?: { queue: Promise<unknown> } };
g.__mnhaAdminAccess ??= { queue: Promise.resolve() };

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaAdminAccess!.queue.then(job, job);
  g.__mnhaAdminAccess!.queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Store;
    return Array.isArray(parsed.items) ? parsed : { items: [] };
  } catch {
    return { items: [] };
  }
}

/** For erasure: a read that fails loudly (only a missing file is empty), so a
 *  store that cannot be read is never reported as scrubbed. */
async function readStrict(): Promise<Store> {
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { items: [] };
    throw e;
  }
  const parsed = JSON.parse(raw) as Store;
  if (!Array.isArray(parsed.items)) throw new Error("admin-access: malformed store");
  return parsed;
}

async function write(store: Store): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store));
  await rename(tmp, FILE);
}

export async function logAdminAccess(entry: Omit<AdminAccess, "at">): Promise<void> {
  await enqueue(async () => {
    const store = await readStrict(); // never overwrite a log that could not be read
    store.items.push({ at: Date.now(), ...entry });
    const bulk = store.items.filter(isBulk);
    const rest = store.items.filter((e) => !isBulk(e));
    if (bulk.length > MAX_BULK || rest.length > MAX_ITEMS) {
      const keep = new Set([...bulk.slice(-MAX_BULK), ...rest.slice(-MAX_ITEMS)]);
      store.items = store.items.filter((e) => keep.has(e));
    }
    await write(store);
  });
}

/** On account erasure: drop the order details kept for this client. The lines
 *  themselves (when, what kind of act, the admin's IP) stay. */
export async function scrubAdminAccessDetails(userId: string): Promise<void> {
  await enqueue(async () => {
    const store = await readStrict();
    let changed = false;
    for (const e of store.items) {
      if (e.userId === userId && e.detail !== undefined) {
        delete e.detail;
        changed = true;
      }
    }
    if (changed) await write(store);
  });
}

/** Newest first. `bulk`: only Live trading's per-account lines (true), or only the others (false). */
export async function recentAdminAccess(limit = 25, opts: { bulk?: boolean } = {}): Promise<AdminAccess[]> {
  const items = (await read()).items.filter((e) => opts.bulk === undefined || isBulk(e) === opts.bulk);
  return items.slice(-limit).reverse();
}
