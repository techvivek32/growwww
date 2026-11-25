import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/access";

/**
 * The admin's Exit button on the manual paper trades (and, for the research
 * side, opening one). Forwards to the research box on localhost; paper only —
 * nothing here can place an order with a broker.
 */
export async function POST(req: Request) {
  if (!(await isAdminSession())) return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });
  const url = process.env.RESEARCH_API_URL;
  const token = process.env.RESEARCH_API_TOKEN;
  if (!url || !token) return NextResponse.json({ ok: false, error: "research box not configured" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; symbol?: string; entry_time?: string; side?: string; note?: string; mode?: string };
  const action = body.action === "open" ? "open" : body.action === "book-a" ? "book-a" : "exit";
  if (!body.symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}${action === "book-a" ? "/live/book-a/admin" : `/live/manual/${action}`}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, why: action === "exit" ? "admin exit (button)" : undefined }),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; detail?: string; trade?: unknown };
    if (!r.ok) return NextResponse.json({ ok: false, error: j.detail ?? `research box answered ${r.status}` }, { status: r.status });
    return NextResponse.json(j);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
