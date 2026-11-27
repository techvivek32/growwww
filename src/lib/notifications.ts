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

/**
 * Where tapping the notification should land in the app.
 *
 * A short stable string rather than a URL: the phone's five-tab shell and the
 * website's sixteen sections do not share paths, so a literal "/orders" would
 * mean nothing to the app. The Flutter side maps these to screens, and an
 * unknown value falls back to the notification feed — so adding a route here
 * before the app understands it degrades to "opens the list", never a crash.
 */
export type NotifRoute =
  | "notifications"
  | "home"
  | "orders"
  | "portfolio"
  | "account"
  | "analysis"
  | "admin"
  | "admin:kyc"
  | "admin:accounts"
  | "admin:orders"
  | "admin:fees"
  | "admin:members"
  | "admin:live"
  | "admin:report"
  | "admin:alerts";

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
  /** Tap target. Optional on old rows written before routing existed, which
   *  is why every reader treats a missing value as "notifications". */
  route?: NotifRoute;
}

/** Where a kind lands when a call site does not name somewhere better. */
const DEFAULT_ROUTE: Record<NotifKind, NotifRoute> = {
  order: "orders",
  broker: "account",
  account: "account",
  system: "notifications",
};

/** The admin console's operational sections. A failure filed under one of
 *  these is happening in a client's real account right now, so it earns the
 *  same interruption the client's own phone gets. The console's other
 *  notices — a signup, a verification waiting, a period due to settle — can
 *  wait for a glance, and the once-a-day "still waiting" nudge especially
 *  must not buzz. */
const URGENT_ADMIN_ROUTES: ReadonlySet<string> = new Set(["admin:orders", "admin:live"]);

/** The ones worth interrupting someone for. An order that was rejected or a
 *  position MNHA could not close needs acting on while the market is open;
 *  a settlement notice does not. Everything else arrives quietly.
 *
 *  The route matters for the admin. notifyAdmin() files every console notice
 *  as kind "system", so kind and tone alone could never mark one urgent —
 *  which meant a rejected client order reached the admin at normal priority
 *  and could sit in Doze until the phone woke, while the client's phone had
 *  already buzzed about the same order. */
function isUrgent(kind: NotifKind, tone: NotifTone, route?: NotifRoute): boolean {
  // A stock alert (src/lib/tradeAlerts.ts) is an instruction with a time on it: "SELL X now" a minute late is worse than none.
  if (route === "admin:alerts") return true;
  if (kind === "order") return tone === "down" || tone === "warn";
  if (kind === "broker") return tone === "down";
  if (kind === "system" && route && URGENT_ADMIN_ROUTES.has(route)) {
    return tone === "down" || tone === "warn";
  }
  return false;
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

/** For erasure: a read that fails loudly (only a missing file is "empty"), so
 *  a corrupt store can never be reported as successfully erased. */
async function readStrict(): Promise<Store> {
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { items: [] };
    throw e;
  }
  const parsed = JSON.parse(raw) as Store;
  if (!Array.isArray(parsed.items)) throw new Error("notifications: malformed store");
  return parsed;
}

/** `scrubBackup`: on erasure, overwrite the .bak too, so deleted data does not linger in the backup. */
async function write(store: Store, scrubBackup = false): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  try {
    await copyFile(FILE, `${FILE}.bak`);
  } catch {
    /* first write */
  }
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
  if (scrubBackup) await copyFile(FILE, `${FILE}.bak`);
}

/** Emit a notification. Idempotent per (userId, key) so a retry or an engine
 *  restart never double-posts. `key` defaults to a random id (always unique). */
export async function notify(
  userId: string,
  n: {
    kind: NotifKind;
    tone?: NotifTone;
    title: string;
    body: string;
    key?: string;
    route?: NotifRoute;
  },
): Promise<void> {
  if (!userId) return;
  const key = n.key ?? `n-${randomBytes(6).toString("hex")}`;
  // Set inside the queued job, read after it. A push is only worth sending
  // for a row that was actually written: the (userId, key) check below drops
  // repeats, and a retrying engine must not re-buzz a phone each time.
  let fresh: Notif | null = null;
  await enqueue(async () => {
    const store = await read();
    if (store.items.some((i) => i.userId === userId && i.key === key)) return; // already sent
    const tone = n.tone ?? "neutral";
    const item: Notif = {
      id: `nt-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      userId,
      kind: n.kind,
      tone,
      title: n.title,
      body: n.body,
      createdAt: Date.now(),
      read: false,
      key,
      route: n.route ?? DEFAULT_ROUTE[n.kind],
    };
    fresh = item;
    store.items.push(item);
    // Trim to the most recent N per user so the file cannot grow unbounded.
    const mine = store.items.filter((i) => i.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
    if (mine.length > MAX_PER_USER) {
      const drop = new Set(mine.slice(0, mine.length - MAX_PER_USER).map((i) => i.id));
      store.items = store.items.filter((i) => !drop.has(i.id));
    }
    await write(store);
  });

  // Push is an extra channel on top of the row above, never the record. It is
  // deliberately awaited-but-swallowed: a Firebase outage, a missing key or a
  // dead token must never turn a settled period or a placed order into a
  // thrown error at the call site, several of which are mid-transaction.
  if (fresh) await pushNotif(fresh);
}

/**
 * Hand a freshly written notification to FCM.
 *
 * Imported lazily so that `notifications.ts` — which half the server imports —
 * does not drag the push stack into every module graph that only ever reads
 * the feed.
 */
async function pushNotif(item: Notif): Promise<void> {
  try {
    const [{ tokensFor }, { send }] = await Promise.all([
      import("./push/devices"),
      import("./push/fcm"),
    ]);
    const tokens = await tokensFor(item.userId);
    if (tokens.length === 0) return; // website-only user, or nobody signed in on a phone
    await send(tokens, {
      title: item.title,
      body: item.body,
      route: item.route ?? "notifications",
      id: item.id,
      kind: item.kind,
      urgent: isUrgent(item.kind, item.tone, item.route),
    });
  } catch (err) {
    console.error("[push] notification not delivered:", err instanceof Error ? err.message : err);
  }
}

/**
 * Tell the admin console something needs a human.
 *
 * The admin signs in as a reserved id with no user record, so it has no
 * notification history on the website — but it is the account that has to act
 * on a new verification or a rejected order, and until now nothing told it so.
 * Same store, same idempotency, same push path; only the recipient differs.
 */
export async function notifyAdmin(n: {
  tone?: NotifTone;
  title: string;
  body: string;
  key?: string;
  route?: NotifRoute;
}): Promise<void> {
  const { ADMIN_ID } = await import("./auth");
  await notify(ADMIN_ID, { kind: "system", route: "admin", ...n });
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

/** Erase every notification for one account — only on full account deletion. */
export async function deleteNotifications(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await readStrict();
    const before = store.items.length;
    store.items = store.items.filter((n) => n.userId !== userId);
    if (store.items.length !== before) await write(store, true);
  });
}
