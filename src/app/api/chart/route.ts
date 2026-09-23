import { NextResponse, type NextRequest } from "next/server";
import { getChartSeries, type ChartRange } from "@/lib/api/yahoo";

/**
 * Chart series for the detail page's range tabs. Session-gated by proxy.ts
 * like everything else.
 */

export const dynamic = "force-dynamic";

const RANGES = new Set<ChartRange>(["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"]);

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const range = (req.nextUrl.searchParams.get("range") ?? "1D") as ChartRange;

  if (!/^[A-Z0-9&-]{1,30}$/.test(symbol) || !RANGES.has(range)) {
    return NextResponse.json({ series: null }, { status: 400 });
  }

  const series = await getChartSeries(symbol, range);
  return NextResponse.json(
    { series },
    { headers: { "Cache-Control": "no-store" } },
  );
}
