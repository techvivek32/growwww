import "server-only";
import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { encrypt, decrypt } from "./crypto";

/**
 * Multi-user accounts, persisted to a JSON file next to the app.
 *
 * Two secrets never touch the browser or the git history:
 *  - the password, stored only as a salted scrypt hash;
 *  - the user's Groww API key + TOTP secret, stored only AES-256-GCM encrypted
 *    with a key derived from AUTH_SECRET (the deployment secret, not in repo).
 *
 * A file is fine for a single-box deployment; a real multi-tenant product wants
 * a database with per-row encryption and an audit trail. This is honest about
 * what it is.
 */

export interface BrokerCreds {
  apiKey: string;
  totpSecret: string;
}

export interface User {
  id: string;
  email: string;
  /** `scrypt$<saltHex>$<hashHex>` */
  passwordHash: string;
  createdAt: number;
  /** When the email address was proven with a one-time code (signups from v3.1 on). */
  emailVerifiedAt?: number;
  /** Present once the user has connected their own Groww API. Encrypted. */
  broker?: {
    apiKeyEnc: string;
    totpEnc: string;
    connectedAt: number;
    /** The static IP the user confirmed registering on their Groww key. */
    staticIp?: string;
    ipConfirmedAt?: number;
    /** Groww's client code (UCC), read live at connect time. */
    ucc?: string | null;
  };
}

/** Non-secret facts recorded alongside a broker connection. */
export interface BrokerMeta {
  staticIp?: string;
  ipConfirmed?: boolean;
  ucc?: string | null;
}

interface Store {
  users: User[];
}

const FILE = process.env.USERS_FILE ?? path.join(process.cwd(), "data", "users.json");

const g = globalThis as { __mnhaUsers?: { queue: Promise<unknown> } };
g.__mnhaUsers ??= { queue: Promise.resolve() };

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaUsers!.queue.then(job, job);
  g.__mnhaUsers!.queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<Store> {
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch (e) {
    // Only a missing file means "no users yet". Any other failure must NOT be
    // read as empty — the next write would wipe every account (and its .bak).
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { users: [] };
    throw e;
  }
  const parsed = JSON.parse(raw) as Store;
  if (!Array.isArray(parsed.users)) throw new Error("users: malformed store");
  return parsed;
}

/** `scrubBackup`: on erasure, overwrite the .bak too, so deleted data does not linger in the backup. */
async function write(store: Store, scrubBackup = false): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  // Keep the last good copy before overwriting — this file holds accounts and
  // encrypted broker keys, so a bad write must never be the only version left.
  try {
    await copyFile(FILE, `${FILE}.bak`);
  } catch {
    /* first write, nothing to back up yet */
  }
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
  if (scrubBackup) await copyFile(FILE, `${FILE}.bak`);
}

/* ------------------------------------------------------------ crypto */

function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

function checkPassword(pw: string, stored: string): boolean {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const dk = scryptSync(pw, Buffer.from(saltHex, "hex"), 32);
  const want = Buffer.from(hashHex, "hex");
  return dk.length === want.length && timingSafeEqual(dk, want);
}

/* ------------------------------------------------------------ public API */

const normEmail = (e: string) => e.trim().toLowerCase();

export interface CreateResult {
  ok: boolean;
  user?: User;
  error?: string;
}

export async function createUser(email: string, password: string): Promise<CreateResult> {
  const e = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: "Enter a valid email address." };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  return enqueue(async () => {
    const store = await read();
    if (store.users.some((u) => u.email === e)) {
      return { ok: false, error: "An account with this email already exists." };
    }
    const user: User = {
      id: `u-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
      email: e,
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
    };
    store.users.push(user);
    await write(store);
    return { ok: true, user };
  });
}

/** Signup checks, shared with the emailed-code flow. */
export function validateSignup(email: string, password: string): string | null {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail(email))) return "Enter a valid email address.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

/** Hash a password for a pending signup, so plain text is never stored even briefly. */
export function hashForSignup(password: string): string {
  return hashPassword(password);
}

export function normalizeEmail(email: string): string {
  return normEmail(email);
}

/** Create the account once its email has been proven with a one-time code. */
export async function createVerifiedUser(email: string, passwordHash: string): Promise<CreateResult> {
  const e = normEmail(email);
  return enqueue(async () => {
    const store = await read();
    if (store.users.some((u) => u.email === e)) return { ok: false, error: "An account with this email already exists." };
    const now = Date.now();
    const user: User = {
      id: `u-${now.toString(36)}-${randomBytes(4).toString("hex")}`,
      email: e,
      passwordHash,
      createdAt: now,
      emailVerifiedAt: now,
    };
    store.users.push(user);
    await write(store);
    return { ok: true, user };
  });
}

export async function findByEmail(email: string): Promise<User | null> {
  const e = normEmail(email);
  return (await read()).users.find((u) => u.email === e) ?? null;
}

export async function findById(id: string): Promise<User | null> {
  return (await read()).users.find((u) => u.id === id) ?? null;
}

/** Verify a login. One message for both wrong-email and wrong-password. */
export async function verifyLogin(email: string, password: string): Promise<User | null> {
  const user = await findByEmail(email);
  if (!user) {
    // Spend a comparable amount of time so presence isn't timing-detectable.
    scryptSync(password, "decoy-salt-000000", 32);
    return null;
  }
  return checkPassword(password, user.passwordHash) ? user : null;
}

/** Store (encrypted) the user's own Groww API credentials. */
export async function setBroker(userId: string, apiKey: string, totpSecret: string, meta: BrokerMeta = {}): Promise<boolean> {
  return enqueue(async () => {
    const store = await read();
    const user = store.users.find((u) => u.id === userId);
    if (!user) return false;
    const replacing = Boolean(user.broker);
    user.broker = {
      apiKeyEnc: encrypt(apiKey.trim()),
      totpEnc: encrypt(totpSecret.trim()),
      connectedAt: Date.now(),
      staticIp: meta.staticIp,
      ipConfirmedAt: meta.ipConfirmed ? Date.now() : undefined,
      ucc: meta.ucc ?? null,
    };
    await write(store, replacing); // replaced keys must not linger in the .bak
    return true;
  });
}

export async function clearBroker(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const user = store.users.find((u) => u.id === userId);
    if (user) {
      delete user.broker;
      await write(store, true); // the old encrypted keys must not linger in the .bak
    }
  });
}

/** Decrypt and return a user's Groww creds, or null if they have not connected. */
export async function getBroker(userId: string): Promise<BrokerCreds | null> {
  const user = await findById(userId);
  if (!user?.broker) return null;
  try {
    return {
      apiKey: decrypt(user.broker.apiKeyEnc),
      totpSecret: decrypt(user.broker.totpEnc),
    };
  } catch {
    return null; // secret rotated or blob corrupt — treat as not connected
  }
}

export async function hasBroker(userId: string): Promise<boolean> {
  return Boolean((await findById(userId))?.broker);
}

/** Non-secret broker facts for one user — what the trading gate needs to decide. */
export async function getUserBrokerMeta(
  userId: string,
): Promise<{ staticIp: string | null; ipConfirmed: boolean; ucc: string | null } | null> {
  const b = (await findById(userId))?.broker;
  if (!b) return null;
  return {
    staticIp: b.staticIp ?? null,
    ipConfirmed: Boolean(b.ipConfirmedAt),
    ucc: b.ucc ?? null,
  };
}

export interface UserSummary {
  id: string;
  email: string;
  createdAt: number;
  hasBroker: boolean;
  brokerConnectedAt: number | null;
  /** The static IP the user confirmed on their Groww key, if they did. */
  brokerStaticIp: string | null;
  brokerUcc: string | null;
}

/** Admin listing — safe fields only. Never the password hash or the keys. */
export async function listUsers(): Promise<UserSummary[]> {
  const store = await read();
  return store.users
    .map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
      hasBroker: Boolean(u.broker),
      brokerConnectedAt: u.broker?.connectedAt ?? null,
      brokerStaticIp: u.broker?.ipConfirmedAt ? (u.broker.staticIp ?? null) : null,
      brokerUcc: u.broker?.ucc ?? null,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Change a password after verifying the current one. */
export async function changePassword(
  userId: string,
  current: string,
  next: string,
): Promise<{ ok: boolean; error?: string }> {
  if (next.length < 8) return { ok: false, error: "New password must be at least 8 characters." };
  return enqueue(async () => {
    const store = await read();
    const user = store.users.find((u) => u.id === userId);
    if (!user) return { ok: false, error: "Account not found." };
    if (!checkPassword(current, user.passwordHash)) return { ok: false, error: "Your current password is wrong." };
    user.passwordHash = hashPassword(next);
    await write(store);
    return { ok: true };
  });
}

/** Permanently remove a user and everything stored on them. */
export async function deleteUser(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const before = store.users.length;
    store.users = store.users.filter((u) => u.id !== userId);
    if (store.users.length !== before) await write(store, true);
  });
}
