import { NextResponse, type NextRequest } from "next/server";
import { searchEquities } from "@/lib/instruments";
import { INDEX_TICKERS } from "@/lib/api/yahoo";

/**
 * Instrument search over the master list — every NSE equity plus the
 * indices. Session-gated by proxy.ts like everything else.
 */

export const dynamic = "force-dynamic";

export interface SearchHit {
  symbol: string;
  name: string;
  kind: "index" | "stock";
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ hits: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const upper = q.toUpperCase();
  const indexHits: SearchHit[] = INDEX_TICKERS.filter(
    (t) => t.symbol.includes(upper) || t.name.toUpperCase().includes(upper),
  ).map((t) => ({ symbol: t.symbol, name: t.name, kind: "index" }));

  let stockHits: SearchHit[] = [];
  try {
    stockHits = (await searchEquities(q, 7)).map((e) => ({
      symbol: e.tradingSymbol,
      name: e.name,
      kind: "stock" as const,
    }));
  } catch {
    // The master may still be downloading on a cold start; indices still answer.
  }

  return NextResponse.json(
    { hits: [...indexHits, ...stockHits].slice(0, 8) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
