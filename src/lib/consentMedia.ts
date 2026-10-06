import "server-only";
import { mkdir, writeFile, readdir, readFile, rm, stat } from "node:fs/promises";
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
