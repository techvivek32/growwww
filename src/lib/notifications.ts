import "server-only";
import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Per-user in-app notifications — the one alert channel with no external
 * provider and no regulatory gate: transactional, in-app, isolated per user.
 *
 * ONLY transactional events a user's own action produced go here (order
 * placed / rejected, broker connected / errored, account). Advisory "signal"
 * delivery is deliberately NOT wired in — pushing trading calls to users is
 * Research-Analyst territory and stays gated. Nothing here is cross-user: a
 * viewer only ever sees notifications addressed to their own id.
 */

export type NotifTone = "up" | "down" | "neutral" | "warn";
export type NotifKind = "order" | "broker" | "account" | "system";

export interface Notif {
  id: string;
  userId: string;
  kind: NotifKind;
  tone: NotifTone;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  /** idempotency key — a repeated emit with the same (userId,key) is dropped. */
  key: string;
}

interface Store {
  items: Notif[];
}

const FILE = process.env.NOTIF_FILE ?? path.join(process.cwd(), "data", "notifications.json");
const MAX_PER_USER = 200;

const g = globalThis as { __mnhaNotif?: { queue: Promise<unknown> } };
g.__mnhaNotif ??= { queue: Promise.resolve() };

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaNotif!.queue.then(job, job);
  g.__mnhaNotif!.queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<Store> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (!Array.isArray(parsed.items)) return { items: [] };
    return parsed;
  } catch {
    return { items: [] };
  }
}

async function write(store: Store): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  try {
    await copyFile(FILE, `${FILE}.bak`);
  } catch {
    /* first write */
  }
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
}

/** Emit a notification. Idempotent per (userId, key) so a retry or an engine
 *  restart never double-posts. `key` defaults to a random id (always unique). */
export async function notify(
  userId: string,
  n: { kind: NotifKind; tone?: NotifTone; title: string; body: string; key?: string },
): Promise<void> {
  if (!userId) return;
  const key = n.key ?? `n-${randomBytes(6).toString("hex")}`;
  return enqueue(async () => {
    const store = await read();
    if (store.items.some((i) => i.userId === userId && i.key === key)) return; // already sent
    store.items.push({
      id: `nt-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      userId,
      kind: n.kind,
      tone: n.tone ?? "neutral",
      title: n.title,
      body: n.body,
      createdAt: Date.now(),
      read: false,
      key,
    });
    // Trim to the most recent N per user so the file cannot grow unbounded.
    const mine = store.items.filter((i) => i.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
    if (mine.length > MAX_PER_USER) {
      const drop = new Set(mine.slice(0, mine.length - MAX_PER_USER).map((i) => i.id));
      store.items = store.items.filter((i) => !drop.has(i.id));
    }
    await write(store);
  });
}

export async function listForUser(userId: string, limit = 60): Promise<Notif[]> {
  if (!userId) return [];
  return (await read()).items
    .filter((i) => i.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function unreadCount(userId: string): Promise<number> {
  if (!userId) return 0;
  return (await read()).items.filter((i) => i.userId === userId && !i.read).length;
}

export async function markAllRead(userId: string): Promise<void> {
  if (!userId) return;
  return enqueue(async () => {
    const store = await read();
    let changed = false;
    for (const i of store.items) {
      if (i.userId === userId && !i.read) {
        i.read = true;
        changed = true;
      }
    }
    if (changed) await write(store);
  });
}
