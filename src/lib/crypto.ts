import "server-only";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Field encryption for data at rest (broker keys, KYC PII). AES-256-GCM with a
 * key derived from AUTH_SECRET — which lives in the server environment, never
 * in git and never sent to the browser. The key derivation and blob format are
 * fixed: changing them would make every previously-stored value undecryptable.
 */

function requireSecret(): string {
  const s = process.env.AUTH_SECRET?.trim();
  if (!s) throw new Error("AUTH_SECRET is not set — required to encrypt data at rest");
  return s;
}

function encKey(): Buffer {
  return scryptSync(requireSecret(), "mnha-cred-enc-v1", 32);
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, ct, tag].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string): string {
  const [ivB, ctB, tagB] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", encKey(), ivB);
  d.setAuthTag(tagB);
  return Buffer.concat([d.update(ctB), d.final()]).toString("utf8");
}
