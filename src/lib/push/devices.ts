import "server-only";
import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";

/**
 * The registry of devices that may receive a push.
 *
 * One row per FCM token. The token — not the user — is the identity here, and
 * that matters: a phone that signs out and is handed to somebody else keeps
 * the same token, so registering a token always REASSIGNS it to the caller
 * rather than adding a second row. Without that rule the previous holder's
 * order and settlement notices would keep arriving on a device they no longer
 * control, which is a data leak dressed up as a convenience feature.
 *
 * Tokens also rot on their own: FCM retires one when the app is reinstalled,
 * data is cleared, or it simply goes stale. `dropTokens` exists so the sender
 * can delete the ones Google reports dead, instead of retrying them daily
 * forever.
 */

export type Platform = "android" | "ios";

export interface Device {
  token: string;
  userId: string;
  platform: Platform;
  /** App version that registered it — for working out whether a delivery bug
   *  is confined to one build before anyone goes looking in the server. */
  appVersion?: string;
  createdAt: number;
  lastSeenAt: number;
}

interface Store {
  devices: Device[];
}

const FILE =
  process.env.PUSH_DEVICES_FILE ?? path.join(process.cwd(), "data", "push-devices.json");

/** A single account on many devices is normal (phone + tablet + a reinstall
 *  that left a stale token behind). A hundred is not, and would mean something
 *  is registering in a loop, so the oldest are dropped rather than fanned out. */
const MAX_PER_USER = 20;

const g = globalThis as { __mnhaDevices?: { queue: Promise<unknown> } };
g.__mnhaDevices ??= { queue: Promise.resolve() };

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaDevices!.queue.then(job, job);
  g.__mnhaDevices!.queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Store;
    if (!Array.isArray(parsed.devices)) return { devices: [] };
    return parsed;
  } catch {
    return { devices: [] };
  }
}

/** For erasure: only a missing file counts as empty, so a corrupt store can
 *  never be reported as successfully erased. Mirrors notifications.ts. */
async function readStrict(): Promise<Store> {
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { devices: [] };
    throw e;
  }
  const parsed = JSON.parse(raw) as Store;
  if (!Array.isArray(parsed.devices)) throw new Error("push devices: malformed store");
  return parsed;
}

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

/**
 * Register (or re-register) a device for a user.
 *
 * Called on every sign-in and whenever FCM rotates the token. Re-registering
 * an existing token overwrites its owner — see the note at the top of the
 * file about why that is the whole point.
 */
export async function registerDevice(
  userId: string,
  token: string,
  platform: Platform = "android",
  appVersion?: string,
): Promise<void> {
  if (!userId || !token) return;
  return enqueue(async () => {
    const store = await read();
    const now = Date.now();
    const existing = store.devices.find((d) => d.token === token);
    if (existing) {
      existing.userId = userId;
      existing.platform = platform;
      existing.appVersion = appVersion;
      existing.lastSeenAt = now;
    } else {
      store.devices.push({
        token,
        userId,
        platform,
        appVersion,
        createdAt: now,
        lastSeenAt: now,
      });
    }
    const mine = store.devices
      .filter((d) => d.userId === userId)
      .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    if (mine.length > MAX_PER_USER) {
      const drop = new Set(mine.slice(0, mine.length - MAX_PER_USER).map((d) => d.token));
      store.devices = store.devices.filter((d) => !drop.has(d.token));
    }
    await write(store);
  });
}

/**
 * Forget one device — called on sign-out.
 *
 * Signing out has to remove the row, not merely mark it inactive. The whole
 * reason someone signs out on a shared or returned phone is so that it stops
 * showing them things.
 */
export async function removeDevice(token: string): Promise<void> {
  if (!token) return;
  return enqueue(async () => {
    const store = await read();
    const before = store.devices.length;
    store.devices = store.devices.filter((d) => d.token !== token);
    if (store.devices.length !== before) await write(store);
  });
}

/** Every live token for a user. Empty is the normal case for somebody who has
 *  only ever used the website, and is not an error. */
export async function tokensFor(userId: string): Promise<string[]> {
  if (!userId) return [];
  return (await read()).devices.filter((d) => d.userId === userId).map((d) => d.token);
}

/** Delete tokens FCM reported as permanently dead. */
export async function dropTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const gone = new Set(tokens);
  return enqueue(async () => {
    const store = await read();
    const before = store.devices.length;
    store.devices = store.devices.filter((d) => !gone.has(d.token));
    if (store.devices.length !== before) await write(store);
  });
}

/** Erase every device for one account — only on full account deletion. A
 *  deleted account must stop receiving push on devices it never signed out of. */
export async function deleteDevices(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await readStrict();
    const before = store.devices.length;
    store.devices = store.devices.filter((d) => d.userId !== userId);
    if (store.devices.length !== before) await write(store, true);
  });
}

/** For the admin console: how many devices are registered, without exposing
 *  the tokens themselves — a token is a send-anything credential for that
 *  device, so it never leaves the server. */
export async function deviceCount(userId: string): Promise<number> {
  return (await tokensFor(userId)).length;
}
