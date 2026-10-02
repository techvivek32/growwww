import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Phone hand-off for the identity photos: the signed-in computer asks for a
 * short-lived link, shows it as a QR code, and the phone — which is not
 * signed in — uses it to upload the selfie and the PAN/Aadhaar photo.
 *
 * A link is a narrow capability: it belongs to one user, expires after 15
 * minutes, allows a handful of uploads, and can do nothing else. Tokens live
 * in memory; a restart simply means making a new QR code.
 */

export const HANDOFF_TTL_MS = 15 * 60 * 1000;
const MAX_UPLOADS = 12;

interface Handoff {
  userId: string;
  expiresAt: number;
  uploads: number;
}

const g = globalThis as { __mnhaHandoff?: Map<string, Handoff> };
g.__mnhaHandoff ??= new Map();
const store = g.__mnhaHandoff;

function sweep(): void {
  const now = Date.now();
  for (const [t, h] of store) if (h.expiresAt <= now) store.delete(t);
}

/** A fresh link for this user; any older link of theirs stops working. */
export function createHandoff(userId: string): { token: string; expiresAt: number } {
  sweep();
  for (const [t, h] of store) if (h.userId === userId) store.delete(t);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + HANDOFF_TTL_MS;
  store.set(token, { userId, expiresAt, uploads: 0 });
  return { token, expiresAt };
}

/** The user a live link belongs to, or null. */
export function handoffUser(token: string): string | null {
  const h = store.get(token);
  if (!h || h.expiresAt <= Date.now()) return null;
  return h.userId;
}

/** Count an upload against the link; false once it is used up. */
export function spendHandoff(token: string): string | null {
  const h = store.get(token);
  if (!h || h.expiresAt <= Date.now() || h.uploads >= MAX_UPLOADS) return null;
  h.uploads += 1;
  return h.userId;
}

export function revokeHandoffs(userId: string): void {
  for (const [t, h] of store) if (h.userId === userId) store.delete(t);
}
