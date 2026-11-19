import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A log of every time the admin opens or leaves a client's account, and of the
 * acts the admin performs inside it: connecting Groww, placing or cancelling
 * an order. It is a security log: it keeps the client's internal id (not their
 * email or any other personal detail), when, and the admin's IP — and only the
 * latest entries, so it rotates out by itself.
 *
 * An order or cancel line also says what was sent and how it ended. That is
 * the client's trading data, so it is wiped when the account is erased; the
 * fact that the admin acted, when and from where, stays.
 */

export interface AdminAccess {
  at: number;
  kind: "open" | "close" | "connect-broker" | "order" | "cancel";
  userId: string;
  ip: string;
  /** Order and cancel lines only: what was sent and how it ended. */
  detail?: string;
}

interface Store {
  items: AdminAccess[];
}

const FILE = process.env.ADMIN_ACCESS_FILE ?? path.join(process.cwd(), "data", "admin-access.json");
const MAX_ITEMS = 1000;

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
    if (store.items.length > MAX_ITEMS) store.items = store.items.slice(-MAX_ITEMS);
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

/** Newest first. */
export async function recentAdminAccess(limit = 25): Promise<AdminAccess[]> {
  return (await read()).items.slice(-limit).reverse();
}
