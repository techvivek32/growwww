import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { saveMedia, mediaPath, type MediaKind } from "@/lib/consentMedia";
import { readFile } from "node:fs/promises";

export const dynamic = "force-dynamic";

const KINDS = new Set<MediaKind>(["selfie", "id", "video"]);
const MAX = 25 * 1024 * 1024; // 25 MB (a short video)
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", webm: "video/webm", mp4: "video/mp4", ogg: "video/ogg" };

/** Upload one piece of consent media for the signed-in user (self only). */
export async function POST(req: Request) {
  const uid = await currentUserId();
  if (!uid || uid === OWNER_ID) return new Response("Unauthorized", { status: 401 });

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
  if (viewer !== OWNER_ID && viewer !== user) return new Response("Forbidden", { status: 403 });

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
