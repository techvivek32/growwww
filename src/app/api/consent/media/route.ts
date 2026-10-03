import { currentUserId } from "@/lib/session";
import { ADMIN_ID, isReservedId } from "@/lib/auth";
import { saveMedia, mediaPath, type MediaKind } from "@/lib/consentMedia";
import { readFile } from "node:fs/promises";
import { hasConsented } from "@/lib/consent";

export const dynamic = "force-dynamic";

const KINDS = new Set<MediaKind>(["selfie", "id", "video"]);
const MAX = 10 * 1024 * 1024; // 10 MB — under nginx's 11 MB body cap, so the user gets our message, not a bare 413
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", webm: "video/webm", mp4: "video/mp4", ogg: "video/ogg" };

/** Upload one piece of consent media for the signed-in user (self only). */
export async function POST(req: Request) {
  const uid = await currentUserId();
  if (!uid || isReservedId(uid)) return new Response("Unauthorized", { status: 401 });
  // Once this version is signed, its evidence is fixed — no replacing it.
  if (await hasConsented(uid)) return new Response("Already signed", { status: 409 });

  const form = await req.formData();
  const kind = String(form.get("kind") ?? "") as MediaKind;
  const file = form.get("file");
  if (!KINDS.has(kind)) return new Response("Bad kind", { status: 400 });
  if (!(file instanceof File) || file.size === 0) return new Response("No file", { status: 400 });
  if (file.size > MAX) return new Response("Too large", { status: 413 });

  const okType = kind === "video" ? file.type.startsWith("video/") : file.type.startsWith("image/");
  if (!okType) return new Response("Bad type", { status: 415 });

  await saveMedia(uid, kind, Buffer.from(await file.arrayBuffer()), file.name, file.type);
  return Response.json({ ok: true });
}

/** Serve a piece of consent media — only to the owner (review) or the user. */
export async function GET(req: Request) {
  const viewer = await currentUserId();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const user = url.searchParams.get("user") ?? "";
  const kind = String(url.searchParams.get("kind") ?? "") as MediaKind;
  if (!KINDS.has(kind)) return new Response("Bad kind", { status: 400 });
  if (viewer !== ADMIN_ID && viewer !== user) return new Response("Forbidden", { status: 403 });

  const p = await mediaPath(user, kind);
  if (!p) return new Response("Not found", { status: 404 });
  try {
    const buf = await readFile(p);
    const ext = p.split(".").pop()?.toLowerCase() ?? "bin";
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, no-store", "Content-Disposition": "inline" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
