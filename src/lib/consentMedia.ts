import "server-only";
import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
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

export async function saveMedia(userId: string, kind: MediaKind, buffer: Buffer, fileName: string, mime: string): Promise<void> {
  const dir = path.join(DIR, userId);
  await mkdir(dir, { recursive: true });
  // Remove any prior file of this kind (different extension) so there's one.
  try {
    for (const f of await readdir(dir)) if (f.startsWith(`${kind}.`)) await rm(path.join(dir, f), { force: true });
  } catch { /* dir just created */ }
  await writeFile(path.join(dir, `${kind}.${extFor(kind, fileName, mime)}`), buffer);
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
  try { await rm(path.join(DIR, userId), { recursive: true, force: true }); } catch { /* nothing */ }
}
