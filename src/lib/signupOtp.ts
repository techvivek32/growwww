import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Pending sign-ups awaiting their emailed one-time code. Nothing becomes an
 * account until the code is entered. Holds only a salted hash of the code and
 * the scrypt hash of the chosen password — never either in plain text.
 */

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;

interface Pending {
  token: string;
  email: string;
  passwordHash: string;
  /** The address already has an account: no code can ever succeed. */
  existing: boolean;
  salt: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  sends: number;
  lastSentAt: number;
}

interface Store { pending: Pending[] }

const FILE = process.env.SIGNUP_OTP_FILE ?? path.join(process.cwd(), "data", "pending-signups.json");

const g = globalThis as { __mnhaOtp?: { queue: Promise<unknown> } };
g.__mnhaOtp ??= { queue: Promise.resolve() };
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaOtp!.queue.then(job, job);
  g.__mnhaOtp!.queue = run.catch(() => undefined);
  return run;
}
async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Store;
    return Array.isArray(parsed.pending) ? parsed : { pending: [] };
  } catch {
    return { pending: [] }; // pending sign-ups are disposable: a lost file only means "start again"
  }
}
async function write(store: Store): Promise<void> {
  const now = Date.now();
  store.pending = store.pending.filter((p) => p.expiresAt > now);
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
}

const hashCode = (salt: string, code: string) => createHash("sha256").update(`${salt}:${code}`).digest("hex");
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Start (or restart) a sign-up for an email. Returns the token and the code to send. */
export async function startPending(email: string, passwordHash: string, existing: boolean): Promise<{ token: string; code: string }> {
  return enqueue(async () => {
    const store = await read();
    store.pending = store.pending.filter((p) => p.email !== email);
    const code = newCode();
    const salt = randomBytes(16).toString("hex");
    const now = Date.now();
    const token = randomBytes(24).toString("base64url");
    store.pending.push({
      token, email, passwordHash, existing, salt,
      codeHash: hashCode(salt, code),
      expiresAt: now + CODE_TTL_MS,
      attempts: 0, sends: 1, lastSentAt: now,
    });
    await write(store);
    return { token, code };
  });
}

export async function pendingEmail(token: string): Promise<string | null> {
  const p = (await read()).pending.find((x) => x.token === token && x.expiresAt > Date.now());
  return p?.email ?? null;
}

/** A fresh code for the same sign-up, subject to a cooldown and a send cap. */
export async function resendCode(token: string): Promise<
  { ok: true; code: string; email: string; existing: boolean } | { ok: false; reason: "expired" | "cooldown" | "limit"; waitMs?: number }
> {
  return enqueue(async () => {
    const store = await read();
    const p = store.pending.find((x) => x.token === token && x.expiresAt > Date.now());
    if (!p) return { ok: false, reason: "expired" };
    const wait = p.lastSentAt + RESEND_COOLDOWN_MS - Date.now();
    if (wait > 0) return { ok: false, reason: "cooldown", waitMs: wait };
    if (p.sends >= MAX_SENDS) return { ok: false, reason: "limit" };
    const code = newCode();
    p.salt = randomBytes(16).toString("hex");
    p.codeHash = hashCode(p.salt, code);
    p.expiresAt = Date.now() + CODE_TTL_MS;
    p.attempts = 0;
    p.sends += 1;
    p.lastSentAt = Date.now();
    await write(store);
    return { ok: true, code, email: p.email, existing: p.existing };
  });
}

/** Check a code. On success the pending sign-up is consumed and returned. */
export async function verifyCode(token: string, code: string): Promise<
  { ok: true; email: string; passwordHash: string } | { ok: false; reason: "expired" | "wrong" | "locked" }
> {
  return enqueue(async () => {
    const store = await read();
    const p = store.pending.find((x) => x.token === token && x.expiresAt > Date.now());
    if (!p) return { ok: false, reason: "expired" };
    if (p.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };
    p.attempts += 1;
    const a = Buffer.from(hashCode(p.salt, code.trim()), "hex");
    const b = Buffer.from(p.codeHash, "hex");
    const match = a.length === b.length && timingSafeEqual(a, b);
    if (!match || p.existing) {
      await write(store);
      return { ok: false, reason: p.attempts >= MAX_ATTEMPTS ? "locked" : "wrong" };
    }
    store.pending = store.pending.filter((x) => x.token !== token);
    await write(store);
    return { ok: true, email: p.email, passwordHash: p.passwordHash };
  });
}

export async function dropPending(token: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const before = store.pending.length;
    store.pending = store.pending.filter((x) => x.token !== token);
    if (store.pending.length !== before) await write(store);
  });
}
