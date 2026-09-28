import "server-only";
import { mkdir, readFile, rename, writeFile, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { encrypt, decrypt } from "./crypto";

/**
 * MNHA's OWN identity check — a manual review, not regulatory e-KYC.
 *
 * A user submits a form + selfie + an ID document; the owner reviews it (and
 * does a live video call out of band) and marks it approved or rejected. This
 * is an internal trust gate, NOT SEBI/UIDAI verification — the copy says so.
 *
 * DPDP care is built in: PAN and DOB are encrypted at rest (same AES helper as
 * broker keys); uploaded files live OUTSIDE the web root and are served only
 * through an owner/self-gated route; consent is recorded; and everything is
 * deletable (on account deletion or by the owner).
 */

export type KycStatus = "none" | "submitted" | "approved" | "rejected";

export interface KycReview {
  decision: "approved" | "rejected";
  notes: string;
  reviewedAt: number;
}

export interface KycRecord {
  userId: string;
  status: KycStatus;
  fullName: string;
  panEnc: string;
  dobEnc: string;
  address: string;
  selfieFile: string | null;
  docFile: string | null;
  consentAt: number;
  submittedAt: number;
  callAt: number | null;
  callLink: string | null;
  review: KycReview | null;
}

interface Store {
  records: KycRecord[];
}

const FILE = process.env.KYC_FILE ?? path.join(process.cwd(), "data", "kyc.json");
const DIR = process.env.KYC_DIR ?? path.join(process.cwd(), "data", "kyc-files");

const g = globalThis as { __mnhaKyc?: { queue: Promise<unknown> } };
g.__mnhaKyc ??= { queue: Promise.resolve() };
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaKyc!.queue.then(job, job);
  g.__mnhaKyc!.queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Store;
    return Array.isArray(parsed.records) ? parsed : { records: [] };
  } catch {
    return { records: [] };
  }
}
async function write(store: Store): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  try { await copyFile(FILE, `${FILE}.bak`); } catch { /* first write */ }
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
}

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Age in whole years from a YYYY-MM-DD string, or null if unparseable. */
export function ageYears(dob: string, now: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const born = Date.UTC(y, mo - 1, d);
  if (Number.isNaN(born)) return null;
  return Math.floor((now - born) / (365.25 * 24 * 3600 * 1000));
}

function maskPan(pan: string): string {
  return pan.length === 10 ? `${pan.slice(0, 2)}••••${pan.slice(-2)}` : "••••••";
}

const ALLOWED = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);
function extOf(name: string, fallback = "bin"): string {
  const e = name.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED.has(e) ? e : fallback;
}

export interface KycSubmission {
  fullName: string;
  pan: string;
  dob: string;
  address: string;
  selfie: { buffer: Buffer; name: string } | null;
  doc: { buffer: Buffer; name: string } | null;
}

/** File on disk for a user's selfie/doc — used by the gated serving route. */
export async function kycFilePath(userId: string, kind: "selfie" | "doc"): Promise<string | null> {
  const rec = await getKyc(userId);
  const f = kind === "selfie" ? rec?.selfieFile : rec?.docFile;
  if (!f) return null;
  return path.join(DIR, userId, f);
}

export async function getKyc(userId: string): Promise<KycRecord | null> {
  return (await read()).records.find((r) => r.userId === userId) ?? null;
}

export interface KycView {
  status: KycStatus;
  fullName: string;
  panMasked: string;
  address: string;
  submittedAt: number;
  callAt: number | null;
  callLink: string | null;
  review: KycReview | null;
  hasSelfie: boolean;
  hasDoc: boolean;
}

/** Safe view for the user themselves — PAN masked, no ciphertext. Always the
 *  same shape (empty when there's no record) so callers need no narrowing. */
export async function getKycView(userId: string): Promise<KycView> {
  const r = await getKyc(userId);
  if (!r) {
    return { status: "none", fullName: "", panMasked: "", address: "", submittedAt: 0, callAt: null, callLink: null, review: null, hasSelfie: false, hasDoc: false };
  }
  return {
    status: r.status,
    fullName: r.fullName,
    panMasked: (() => { try { return maskPan(decrypt(r.panEnc)); } catch { return "••••••"; } })(),
    address: r.address,
    submittedAt: r.submittedAt,
    callAt: r.callAt,
    callLink: r.callLink,
    review: r.review,
    hasSelfie: Boolean(r.selfieFile),
    hasDoc: Boolean(r.docFile),
  };
}

export async function submitKyc(userId: string, s: KycSubmission): Promise<{ ok: boolean; error?: string }> {
  const pan = s.pan.trim().toUpperCase();
  if (!s.fullName.trim()) return { ok: false, error: "Enter your full name." };
  if (!PAN_RE.test(pan)) return { ok: false, error: "PAN must look like ABCDE1234F." };
  const age = ageYears(s.dob, nowMs());
  if (age === null) return { ok: false, error: "Enter a valid date of birth." };
  if (age < 18) return { ok: false, error: "You must be at least 18." };
  if (!s.address.trim()) return { ok: false, error: "Enter your address." };
  if (!s.selfie) return { ok: false, error: "A selfie is required." };

  // Write files outside the web root, under the user's own folder.
  await mkdir(path.join(DIR, userId), { recursive: true });
  let selfieFile: string | null = null;
  let docFile: string | null = null;
  if (s.selfie) {
    selfieFile = `selfie.${extOf(s.selfie.name, "jpg")}`;
    await writeFile(path.join(DIR, userId, selfieFile), s.selfie.buffer);
  }
  if (s.doc) {
    docFile = `doc.${extOf(s.doc.name, "jpg")}`;
    await writeFile(path.join(DIR, userId, docFile), s.doc.buffer);
  }

  return enqueue(async () => {
    const store = await read();
    const now = nowMs();
    const rec: KycRecord = {
      userId,
      status: "submitted",
      fullName: s.fullName.trim().slice(0, 120),
      panEnc: encrypt(pan),
      dobEnc: encrypt(s.dob),
      address: s.address.trim().slice(0, 400),
      selfieFile,
      docFile,
      consentAt: now,
      submittedAt: now,
      callAt: null,
      callLink: null,
      review: null,
    };
    const i = store.records.findIndex((r) => r.userId === userId);
    if (i >= 0) store.records[i] = rec; else store.records.push(rec);
    await write(store);
    return { ok: true };
  });
}

export async function setKycDecision(userId: string, decision: "approved" | "rejected", notes: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const r = store.records.find((x) => x.userId === userId);
    if (!r) return;
    r.status = decision;
    r.review = { decision, notes: notes.slice(0, 500), reviewedAt: nowMs() };
    await write(store);
  });
}

export async function scheduleKycCall(userId: string, callAt: number | null, callLink: string | null): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const r = store.records.find((x) => x.userId === userId);
    if (!r) return;
    r.callAt = callAt;
    r.callLink = callLink ? callLink.slice(0, 500) : null;
    await write(store);
  });
}

/** Admin listing — masked PAN, decrypted DOB for review, never ciphertext. */
export async function listKyc() {
  const store = await read();
  return store.records
    .map((r) => ({
      userId: r.userId,
      status: r.status,
      fullName: r.fullName,
      panMasked: (() => { try { return maskPan(decrypt(r.panEnc)); } catch { return "••••••"; } })(),
      dob: (() => { try { return decrypt(r.dobEnc); } catch { return "—"; } })(),
      address: r.address,
      submittedAt: r.submittedAt,
      callAt: r.callAt,
      callLink: r.callLink,
      review: r.review,
      hasSelfie: Boolean(r.selfieFile),
      hasDoc: Boolean(r.docFile),
    }))
    .sort((a, b) => b.submittedAt - a.submittedAt);
}

/** Full PAN for the owner during a review (verifying against the document). */
export async function revealPan(userId: string): Promise<string | null> {
  const r = await getKyc(userId);
  if (!r) return null;
  try { return decrypt(r.panEnc); } catch { return null; }
}

/** Delete a user's KYC record AND their uploaded files. Called on account
 *  deletion and by the owner — the DPDP erasure path. */
export async function deleteKyc(userId: string): Promise<void> {
  await enqueue(async () => {
    const store = await read();
    const before = store.records.length;
    store.records = store.records.filter((r) => r.userId !== userId);
    if (store.records.length !== before) await write(store);
  });
  try { await rm(path.join(DIR, userId), { recursive: true, force: true }); } catch { /* nothing to remove */ }
}

// nowMs is injected-free: Date.now is allowed in normal server modules (only
// workflow scripts forbid it).
function nowMs(): number {
  return Date.now();
}
