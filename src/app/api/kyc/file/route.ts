import { readFile } from "node:fs/promises";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { kycFilePath } from "@/lib/kyc";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
};

/**
 * Streams a KYC selfie/document — ONLY to the owner (reviewing) or the file's
 * own user. These files live outside the web root; this gated route is the
 * only way to read them, and it never lists or guesses paths.
 */
export async function GET(req: Request) {
  const viewer = await currentUserId();
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const user = url.searchParams.get("user") ?? "";
  const kind = url.searchParams.get("kind") === "doc" ? "doc" : "selfie";

  // Only the owner (admin review) or the user themselves may view.
  if (viewer !== OWNER_ID && viewer !== user) return new Response("Forbidden", { status: 403 });

  const p = await kycFilePath(user, kind);
  if (!p) return new Response("Not found", { status: 404 });

  try {
    const buf = await readFile(p);
    const ext = p.split(".").pop()?.toLowerCase() ?? "bin";
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
