import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A log of every time the admin opens or leaves a client's account. It is a
 * security log: it keeps the client's internal id (not their email or any
 * other personal detail), when, and the admin's IP — and only the latest
 * entries, so it rotates out by itself.
 */

export interface AdminAccess {
  at: number;
  kind: "open" | "close";
  userId: string;
  ip: string;
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

export async function logAdminAccess(entry: Omit<AdminAccess, "at">): Promise<void> {
  await enqueue(async () => {
    const store = await read();
    store.items.push({ at: Date.now(), ...entry });
    if (store.items.length > MAX_ITEMS) store.items = store.items.slice(-MAX_ITEMS);
    await mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(store));
    await rename(tmp, FILE);
  });
}

/** Newest first. */
export async function recentAdminAccess(limit = 25): Promise<AdminAccess[]> {
  return (await read()).items.slice(-limit).reverse();
}
