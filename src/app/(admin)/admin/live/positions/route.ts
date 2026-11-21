import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { ADMIN_ID } from "@/lib/auth";
import { watchPositions } from "@/lib/liveTrading/watch";

/**
 * Every connected account's open positions, for the live view on /admin/live
 * (polled every 2 s while the page is open). Admin only: the proxy lets only
 * the admin login reach /admin, and this checks again.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  if ((await currentUserId()) !== ADMIN_ID) return new Response("Forbidden", { status: 403 });
  try {
    const accounts = await watchPositions();
    return NextResponse.json({ at: Date.now(), accounts }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[live] positions view failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Positions could not be read." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
