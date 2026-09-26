import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

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
  /** Present once the user has connected their own Groww API. Encrypted. */
  broker?: { apiKeyEnc: string; totpEnc: string; connectedAt: number };
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
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (!Array.isArray(parsed.users)) return { users: [] };
    return parsed;
  } catch {
    return { users: [] };
  }
}

async function write(store: Store): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
}

/* ------------------------------------------------------------ crypto */

function requireSecret(): string {
  const s = process.env.AUTH_SECRET?.trim();
  if (!s) throw new Error("AUTH_SECRET is not set — required to hash passwords and encrypt broker keys");
  return s;
}

/** 32-byte AES key derived from the deployment secret. */
function encKey(): Buffer {
  return scryptSync(requireSecret(), "mnha-cred-enc-v1", 32);
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, ct, tag].map((b) => b.toString("base64")).join(".");
}

function decrypt(blob: string): string {
  const [ivB, ctB, tagB] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", encKey(), ivB);
  d.setAuthTag(tagB);
  return Buffer.concat([d.update(ctB), d.final()]).toString("utf8");
}

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
export async function setBroker(userId: string, apiKey: string, totpSecret: string): Promise<boolean> {
  return enqueue(async () => {
    const store = await read();
    const user = store.users.find((u) => u.id === userId);
    if (!user) return false;
    user.broker = {
      apiKeyEnc: encrypt(apiKey.trim()),
      totpEnc: encrypt(totpSecret.trim()),
      connectedAt: Date.now(),
    };
    await write(store);
    return true;
  });
}

export async function clearBroker(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const user = store.users.find((u) => u.id === userId);
    if (user) {
      delete user.broker;
      await write(store);
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
