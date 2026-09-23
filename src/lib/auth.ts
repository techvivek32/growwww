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

/** Eight hours — a trading day plus the pre-open, and no longer. */
const TTL_MS = 8 * 60 * 60 * 1000;

const enc = new TextEncoder();

/**
 * No fallbacks: this repository is public, and a committed credential that
 * silently works is an open door. A deploy without these three env vars must
 * fail loudly at first use, not sign people in with a password from git.
 */
function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set — configure it in the server environment`);
  return v;
}

function secret(): string {
  return required("AUTH_SECRET");
}

export function expectedEmail(): string {
  return required("AUTH_EMAIL").toLowerCase();
}

function expectedPassword(): string {
  return required("AUTH_PASSWORD");
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

/** `<base64url(payload)>.<base64url(hmac)>` where payload is `email|expiry`. */
export async function issueToken(email: string): Promise<string> {
  const payload = `${email}|${Date.now() + TTL_MS}`;
  const body = b64url(enc.encode(payload));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = b64url(
    await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body)),
  );
  if (!timingSafeEqual(sig, expected)) return false;

  // Signature is good, so the payload is ours and safe to read.
  let payload: string;
  try {
    payload = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return false;
  }

  const [email, expiry] = payload.split("|");
  if (email !== expectedEmail()) return false;

  const at = Number(expiry);
  return Number.isFinite(at) && Date.now() < at;
}

/* --------------------------------------------------------------- checking */

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export function checkCredentials(email: string, password: string): LoginResult {
  const e = email.trim().toLowerCase();

  // Deliberately one message for both cases — telling someone the email was
  // right narrows the search for them.
  if (!timingSafeEqual(e, expectedEmail()) || !timingSafeEqual(password, expectedPassword())) {
    return { ok: false, error: "That email and password do not match." };
  }
  return { ok: true };
}

export const SESSION_MAX_AGE = TTL_MS / 1000;
