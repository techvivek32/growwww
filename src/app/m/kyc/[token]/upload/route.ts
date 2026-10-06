import { spendHandoff } from "@/lib/kycHandoff";
import { hasConsented } from "@/lib/consent";
import { parseLiveness, saveMedia, type MediaKind } from "@/lib/consentMedia";

export const dynamic = "force-dynamic";

const KINDS = new Set<MediaKind>(["selfie", "id"]);
const MAX = 10 * 1024 * 1024; // phones send a compressed JPEG; 10 MB is generous

/**
 * Upload from the phone, authorised ONLY by the short-lived hand-off token in
 * the URL (the phone is not signed in). It can store a selfie or an ID photo
 * for that one user, before they sign — nothing else.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const uid = spendHandoff(token);
  if (!uid) return new Response("This link has expired", { status: 410 });
  if (await hasConsented(uid)) return new Response("Already signed", { status: 409 });

  const form = await req.formData();
  const kind = String(form.get("kind") ?? "") as MediaKind;
  const file = form.get("file");
  if (!KINDS.has(kind)) return new Response("Bad kind", { status: 400 });
  if (!(file instanceof File) || file.size === 0) return new Response("No file", { status: 400 });
  if (file.size > MAX) return new Response("Too large", { status: 413 });
  if (!file.type.startsWith("image/")) return new Response("Images only", { status: 415 });

  const meta = kind === "selfie" ? { liveness: parseLiveness(form.get("liveness")), at: Date.now() } : null;
  await saveMedia(uid, kind, Buffer.from(await file.arrayBuffer()), file.name || `${kind}.jpg`, file.type, meta);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
