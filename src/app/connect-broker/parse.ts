/**
 * Recognise what a user pasted from Groww — shared by the wizard (instant
 * feedback) and the server action (the check that counts). Pure functions,
 * no secrets logged, nothing sent anywhere.
 *
 *  - Groww's TOTP API key is a JWT: three base64url parts, starting "eyJ".
 *  - The TOTP secret is base32 (A–Z, 2–7), shown as text beside the QR code;
 *    some authenticator exports give it as an otpauth:// link instead.
 *  - A 6-digit number is a one-time code — useless here, it expires in 30s.
 */

export type Kind = "apiKey" | "totpSecret" | "otpauth" | "otpCode" | "empty" | "unknown";

export interface Classified {
  kind: Kind;
  /** The normalised value to store (key, or base32 secret). */
  value: string;
  /** For a key: its expiry (ms) if the token carries one. */
  exp?: number | null;
  /** For an otpauth link: who issued it. */
  issuer?: string | null;
}

const JWT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

export function normaliseBase32(s: string): string | null {
  const v = s.replace(/[\s-]/g, "").toUpperCase().replace(/=+$/, "");
  return /^[A-Z2-7]{16,128}$/.test(v) ? v : null;
}

function b64urlDecode(part: string): string {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return atob(b64);
}

/** A JWT's `exp` claim in ms, or null. Decoded only — never trusted for auth. */
export function jwtExp(token: string): number | null {
  try {
    const claims = JSON.parse(b64urlDecode(token.split(".")[1] ?? "")) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function parseOtpauth(s: string): { secret: string; issuer: string | null } | null {
  try {
    const u = new URL(s.trim());
    if (u.protocol !== "otpauth:") return null;
    const secret = normaliseBase32(u.searchParams.get("secret") ?? "");
    return secret ? { secret, issuer: u.searchParams.get("issuer") } : null;
  } catch {
    return null;
  }
}

/** Classify one pasted value. */
export function classify(raw: string): Classified {
  const t = raw.trim();
  if (!t) return { kind: "empty", value: "" };
  if (/^otpauth:\/\//i.test(t)) {
    const o = parseOtpauth(t);
    return o ? { kind: "otpauth", value: o.secret, issuer: o.issuer } : { kind: "unknown", value: "" };
  }
  const compact = t.replace(/\s+/g, "");
  if (JWT.test(compact)) return { kind: "apiKey", value: compact, exp: jwtExp(compact) };
  if (/^\d{6}$/.test(compact)) return { kind: "otpCode", value: "" };
  const b32 = normaliseBase32(t);
  if (b32) return { kind: "totpSecret", value: b32 };
  return { kind: "unknown", value: "" };
}

/**
 * Pull both values out of a block of text — e.g. the user copied the whole
 * Groww dialog. Base32 is only accepted from tokens written in capitals, so
 * an ordinary long word is never mistaken for a secret.
 */
export function extractAll(text: string): { apiKey: Classified | null; totp: Classified | null } {
  let apiKey: Classified | null = null;
  let totp: Classified | null = null;
  for (const tok of text.split(/[\s,;"'<>()[\]{}]+/)) {
    if (!tok) continue;
    const c = classify(tok);
    if (c.kind === "apiKey" && !apiKey) apiKey = c;
    else if (c.kind === "otpauth" && !totp) totp = c;
    else if (c.kind === "totpSecret" && !totp && tok === tok.toUpperCase()) totp = c;
  }
  return { apiKey, totp };
}
