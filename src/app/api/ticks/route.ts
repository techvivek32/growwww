import { NextResponse, type NextRequest } from "next/server";
import { getTicks, hasCredentials } from "@/lib/api/groww";

/**
 * Live ticks for the screen, polled by the client.
 *
 * The page renders server-side with whatever was current at request time;
 * this is what keeps it moving afterwards without a reload. It returns only
 * price and day change — no account data — and the session gate in proxy.ts
 * covers it like every other route.
 */

export const dynamic = "force-dynamic";

/** A ceiling on how much one poll can ask for. */
const MAX_SYMBOLS = 60;

export async function GET(req: NextRequest) {
  if (!hasCredentials()) {
    return NextResponse.json({ ticks: {} }, { headers: { "Cache-Control": "no-store" } });
  }

  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9&-]{1,30}$/.test(s)),
    ),
  ].slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) {
    return NextResponse.json({ ticks: {} }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const ticks = await getTicks(symbols);
    return NextResponse.json({ ticks }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/ticks]", err instanceof Error ? err.message : err);
    // An empty payload leaves the last server-rendered values on screen,
    // which is better than blanking a price because one poll failed.
    return NextResponse.json({ ticks: {} }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
