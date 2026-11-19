import "server-only";
import { mkdir, writeFile, readdir, readFile, rm, stat, copyFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

/**
 * The identity + acknowledgement media captured during consent — a selfie, a
 * PAN/Aadhaar photo, and a short spoken video. Stored OUTSIDE the web root,
 * per user, and served only through an owner/self-gated route.
 */

export type MediaKind = "selfie" | "id" | "video";
const DIR = process.env.CONSENT_MEDIA_DIR ?? path.join(process.cwd(), "data", "consent-media");

const IMG_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const VID_EXT = new Set(["webm", "mp4", "ogg"]);

function extFor(kind: MediaKind, fileName: string, mime: string): string {
  const fromName = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "video") {
    if (VID_EXT.has(fromName)) return fromName;
    if (mime.includes("mp4")) return "mp4";
    return "webm";
  }
  if (IMG_EXT.has(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

/** How the selfie was taken: the on-phone blink check, if it ran. */
export interface LivenessMeta {
  method: "blink";
  blinks: number;
  passed: boolean;
  ms: number;
}
export interface MediaMeta {
  liveness: LivenessMeta | null;
  at: number;
}

/** The phone reports its blink check; accept only a well-formed, bounded report. */
export function parseLiveness(raw: FormDataEntryValue | null): LivenessMeta | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  try {
    const j = JSON.parse(raw) as Partial<LivenessMeta>;
    if (j.method !== "blink" || !Number.isInteger(j.blinks) || typeof j.passed !== "boolean" || typeof j.ms !== "number") return null;
    const blinks = Math.max(0, Math.min(10, j.blinks as number));
    return { method: "blink", blinks, passed: j.passed && blinks >= 2, ms: Math.round(Math.max(0, Math.min(j.ms, 600_000))) };
  } catch {
    return null;
  }
}

// Meta files are named meta-<kind>.json so they never match the `${kind}.` media prefix.
const metaFile = (userId: string, kind: MediaKind) => path.join(DIR, userId, `meta-${kind}.json`);

/** Store one piece of media (replacing any earlier one) and, for a selfie, how it was taken. */
export async function saveMedia(userId: string, kind: MediaKind, buffer: Buffer, fileName: string, mime: string, meta?: MediaMeta | null): Promise<void> {
  const dir = path.join(DIR, userId);
  await mkdir(dir, { recursive: true });
  // Remove any prior file of this kind (different extension) so there's one.
  try {
    for (const f of await readdir(dir)) if (f.startsWith(`${kind}.`)) await rm(path.join(dir, f), { force: true });
  } catch { /* dir just created */ }
  await writeFile(path.join(dir, `${kind}.${extFor(kind, fileName, mime)}`), buffer);
  // A new photo never inherits the old photo's check result.
  if (meta) await writeFile(metaFile(userId, kind), JSON.stringify(meta));
  else await rm(metaFile(userId, kind), { force: true });
}

export async function readMediaMeta(userId: string, kind: MediaKind): Promise<MediaMeta | null> {
  try {
    return JSON.parse(await readFile(metaFile(userId, kind), "utf8")) as MediaMeta;
  } catch {
    return null;
  }
}

export async function mediaPath(userId: string, kind: MediaKind): Promise<string | null> {
  try {
    const dir = path.join(DIR, userId);
    const f = (await readdir(dir)).find((x) => x.startsWith(`${kind}.`));
    return f ? path.join(dir, f) : null;
  } catch {
    return null;
  }
}

export async function hasAllMedia(userId: string): Promise<{ selfie: boolean; id: boolean; video: boolean }> {
  const [selfie, id, video] = await Promise.all([mediaPath(userId, "selfie"), mediaPath(userId, "id"), mediaPath(userId, "video")]);
  return { selfie: Boolean(selfie), id: Boolean(id), video: Boolean(video) };
}

export async function deleteConsentMedia(userId: string): Promise<void> {
  // `force` already ignores a missing folder; any other failure must surface.
  await rm(path.join(DIR, userId), { recursive: true, force: true });
}

/** The working capture: the selfie, ID photo and video, and their meta files. */
const WORKING = /^(selfie|id|video)\.|^meta-/;
/** Keyed by the full version label (number and date), so a re-dated label never shares a folder. */
const keptDir = (userId: string, version: string) => path.join(DIR, userId, `signed-${version.replace(/[^0-9A-Za-z.-]+/g, "_")}`);

/** True only when the path exists; any error other than "missing" is raised. */
async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

/**
 * Keep the evidence of an earlier signing that still counts. Media is stored
 * once per user, so before a member on an earlier, still-accepted version
 * retakes photos to sign the current one, that signing's files are copied to
 * `signed-<version>/`: once, atomically, and never touched again (only erasing
 * the account removes them).
 */
export async function keepSignedMedia(userId: string, version: string): Promise<void> {
  const keep = keptDir(userId, version);
  if (await exists(keep)) return;
  const dir = path.join(DIR, userId);
  const files = (
    await readdir(dir).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return [] as string[]; // nothing captured yet
      throw e;
    })
  ).filter((f) => WORKING.test(f));
  if (!files.length) return;
  const tmp = `${keep}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  await mkdir(tmp, { recursive: true });
  try {
    for (const f of files) await copyFile(path.join(dir, f), path.join(tmp, f));
    await rename(tmp, keep);
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    // Only "another upload kept it first" lets the replacement go ahead.
    if (!(await exists(keep))) throw e;
  }
}

/** Clear the working capture for a retake, never a kept signing's evidence. */
export async function clearWorkingMedia(userId: string): Promise<void> {
  const dir = path.join(DIR, userId);
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    if (WORKING.test(f)) await rm(path.join(dir, f), { force: true });
  }
}

/** A kept signing's file of this kind, when that signing's evidence was kept. */
export async function keptMediaPath(userId: string, version: string, kind: MediaKind): Promise<string | null> {
  try {
    const dir = keptDir(userId, version);
    const f = (await readdir(dir)).find((x) => x.startsWith(`${kind}.`));
    return f ? path.join(dir, f) : null;
  } catch {
    return null;
  }
}

/** Which identity photos exist AND were uploaded within `maxAgeMs` — media for
 *  a signing must be taken for that signing, not left over from an old one. */
export async function mediaStatus(userId: string, maxAgeMs: number): Promise<{ selfie: boolean; id: boolean }> {
  const cutoff = Date.now() - maxAgeMs;
  const fresh = async (kind: MediaKind) => {
    const p = await mediaPath(userId, kind);
    if (!p) return false;
    return (await stat(p).then((x) => x.mtimeMs).catch(() => 0)) >= cutoff;
  };
  const [selfie, id] = await Promise.all([fresh("selfie"), fresh("id")]);
  return { selfie, id };
}
