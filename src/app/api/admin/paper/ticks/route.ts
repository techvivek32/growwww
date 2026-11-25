import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Open paper positions at the live price, polled every second by the paper page's live strip. Read-only. */
export async function GET() {
  if (!(await isAdminSession())) return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });
  const url = process.env.RESEARCH_API_URL;
  const token = process.env.RESEARCH_API_TOKEN;
  if (!url || !token) return NextResponse.json({ ok: false, error: "research box not configured" }, { status: 503 });
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/live/ticks`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json({ ok: r.ok, ...j }, { status: r.ok ? 200 : r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
