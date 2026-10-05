/**
 * Session auth for the terminal.
 *
 * The password is never sent to the browser: the form posts to a Server
 * Action, the check runs on the server, and what comes back is an httpOnly
 * cookie holding an HMAC-signed token. Middleware verifies that signature on
 * every request, so a forged or edited cookie is rejected.
 *
 * Web Crypto rather than node:crypto throughout, because middleware runs on
 * the Edge runtime where node:crypto is not available.
 *
 * ⚠️ The fallbacks below are visible to anyone who can read this repository.
 * Set AUTH_EMAIL, AUTH_PASSWORD and AUTH_SECRET in the deployment environment
 * and the fallbacks stop being used.
 */

export const SESSION_COOKIE = "mnha_session";

/** While the admin is inside a client's account, the admin's own session waits
 *  here, so "Back to admin" returns to it without signing in again. */
export const ADMIN_BACK_COOKIE = "mnha_admin_back";

/** The reserved user id for the env "house" account (the owner). */
export const OWNER_ID = "owner";

/** The reserved user id for the admin console. A separate login from the
 *  owner's: it opens the admin pages and nothing else — no broker, no desk. */
export const ADMIN_ID = "admin";

/** Ids that belong to the env logins, never to a registered user. */
export function isReservedId(userId: string | null | undefined): boolean {
  return userId === OWNER_ID || userId === ADMIN_ID;
}

/** Eight hours — a trading day plus the pre-open, and no longer. */
const TTL_MS = 8 * 60 * 60 * 1000;

/** An admin's look inside a client's account lasts one hour at most. */
export const ADMIN_VIEW_TTL_MS = 60 * 60 * 1000;

const enc = new TextEncoder();

/**
 * AUTH_SECRET has no fallback: this repository is public, and a committed
 * signing key that silently works is an open door.
 */
function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set — configure it in the server environment`);
  return v;
}

function secret(): string {
  return required("AUTH_SECRET");
}

/** The owner logs in with these env credentials, if configured. Optional now
 *  that anyone can register — a deploy may run with no env owner at all. */
export function ownerEmail(): string | null {
  return process.env.AUTH_EMAIL?.trim().toLowerCase() || null;
}
function ownerPassword(): string | null {
  return process.env.AUTH_PASSWORD?.trim() || null;
}

/** The admin console logs in with these env credentials. Unset = no admin. */
export function adminEmail(): string | null {
  return process.env.ADMIN_EMAIL?.trim().toLowerCase() || null;
}
function adminPassword(): string | null {
  return process.env.ADMIN_PASSWORD?.trim() || null;
}

/** An env login's email, which a registered user may not take. */
export function isReservedEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return e !== "" && (e === ownerEmail() || e === adminEmail());
}

/* ------------------------------------------------------------------ crypto */

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Length-independent compare, so a bad token cannot be probed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ tokens */

/**
 * `<base64url(payload)>.<base64url(hmac)>` where payload is `userId|expiry`,
 * or `userId|expiry|admin` for an admin viewing a client's account. The marker
 * is inside the signed payload, so only the server can mint it.
 */
export async function issueToken(userId: string, opts: { ttlMs?: number; adminView?: boolean } = {}): Promise<string> {
  if (opts.adminView && isReservedId(userId)) throw new Error("admin view is only for client accounts");
  const payload = `${userId}|${Date.now() + (opts.ttlMs ?? TTL_MS)}${opts.adminView ? "|admin" : ""}`;
  const body = b64url(enc.encode(payload));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export interface SessionInfo {
  userId: string;
  /** True when the admin opened this client's account from the console. */
  adminView: boolean;
}

/** The signed, unexpired user id in a token, or null. The heart of every
 *  per-user data boundary, so it verifies the HMAC before trusting a byte. */
export async function sessionUserId(token: string | undefined): Promise<string | null> {
  return (await sessionInfo(token))?.userId ?? null;
}

/** Like sessionUserId, plus whether this is the admin inside a client's account. */
export async function sessionInfo(token: string | undefined): Promise<SessionInfo | null> {
  if (!token) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = b64url(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body)));
  if (!timingSafeEqual(sig, expected)) return null;

  let payload: string;
  try {
    payload = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }

  const [userId, expiry, mark] = payload.split("|");
  const at = Number(expiry);
  if (!userId || !Number.isFinite(at) || Date.now() >= at) return null;
  const adminView = mark === "admin";
  // An admin view of a reserved account is never valid, even if signed.
  if (adminView && isReservedId(userId)) return null;
  return { userId, adminView };
}

/** Boolean gate for the Edge proxy — a valid, unexpired signature. */
export async function verifyToken(token: string | undefined): Promise<boolean> {
  return (await sessionUserId(token)) !== null;
}

/* --------------------------------------------------------------- owner login */

/** True when the credentials match an env login pair (if configured). */
function matchesEnvLogin(email: string, password: string, oe: string | null, op: string | null): boolean {
  if (!oe || !op) return false;
  const e = email.trim().toLowerCase();
  // Compare against padded copies so length never leaks which field was wrong.
  return timingSafeEqual(e.padEnd(64, "\0").slice(0, 64), oe.padEnd(64, "\0").slice(0, 64)) &&
    timingSafeEqual(password.padEnd(64, "\0").slice(0, 64), op.padEnd(64, "\0").slice(0, 64)) &&
    e === oe && password === op;
}

/** True when the credentials match the env "house" owner (if configured). */
export function isOwnerLogin(email: string, password: string): boolean {
  return matchesEnvLogin(email, password, ownerEmail(), ownerPassword());
}

/** True when the credentials match the env admin (if configured). */
export function isAdminLogin(email: string, password: string): boolean {
  return matchesEnvLogin(email, password, adminEmail(), adminPassword());
}

export const SESSION_MAX_AGE = TTL_MS / 1000;
