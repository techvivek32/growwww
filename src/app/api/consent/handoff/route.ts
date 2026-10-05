import { currentUserId, inAdminView } from "@/lib/session";
import { isReservedId } from "@/lib/auth";
import { hasConsented } from "@/lib/consent";
import { createHandoff } from "@/lib/kycHandoff";
import { mediaStatus } from "@/lib/consentMedia";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const LANGS = new Set(["en", "hi", "gu"]);
/** Photos count for a signing only if taken within the last day. */
const FRESH_MS = 24 * 3600 * 1000;

function origin(req: Request): string {
  // Behind the reverse proxy the request URL is the local port; the phone needs the public site.
  if (process.env.NODE_ENV === "production") return process.env.NEXT_PUBLIC_SITE_URL ?? "https://mnhafinancials.com";
  return new URL(req.url).origin;
}

/** Make a phone link (shown as a QR code) for the signed-in user. */
export async function POST(req: Request) {
  const uid = await currentUserId();
  if (!uid || isReservedId(uid)) return new Response("Unauthorized", { status: 401 });
  if (await inAdminView()) return new Response("Admin view: the client takes their own photos", { status: 403 });
  if (await hasConsented(uid)) return new Response("Already signed", { status: 409 });
  if (!rateLimit(`handoff:${uid}`, 20, 60 * 60_000).ok) return new Response("Too many", { status: 429 });

  const lang = new URL(req.url).searchParams.get("l") ?? "en";
  const { token, expiresAt } = createHandoff(uid);
  const url = `${origin(req)}/m/kyc/${token}${LANGS.has(lang) ? `?l=${lang}` : ""}`;
  return Response.json({ url, expiresAt }, { headers: { "Cache-Control": "no-store" } });
}

/** Which identity photos have arrived for this signing (polled by the computer). */
export async function GET() {
  const uid = await currentUserId();
  if (!uid || isReservedId(uid)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await mediaStatus(uid, FRESH_MS), { headers: { "Cache-Control": "no-store" } });
}
