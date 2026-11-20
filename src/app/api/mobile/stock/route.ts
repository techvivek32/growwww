import { getQuotes, getChartSeries, type ChartRange } from "@/lib/api/yahoo";
import { getHoldings, getPositions } from "@/lib/api/broker";
import { json, guarded, fail } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

const RANGES: ChartRange[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"];

/**
 * GET /api/mobile/stock?symbol=RELIANCE&range=3M — one instrument: quote,
 * chart series, and whether the signed-in account actually holds it.
 *
 * The holding is included because a price page is read differently by someone
 * who owns the stock. Looking up a position in a separate screen to answer
 * "do I own this, and at what cost" is friction on the one screen where it
 * matters most.
 */
export async function GET(req: Request) {
  return guarded(async () => {
    const url = new URL(req.url);
    const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
    if (!symbol) return fail("symbol is required.", 400);

    const rangeParam = (url.searchParams.get("range") ?? "3M") as ChartRange;
    // Reject an unknown range rather than silently substituting one: a chart
    // labelled 3M showing 1M of data is worse than an error.
    if (!RANGES.includes(rangeParam)) {
      return fail(`range must be one of ${RANGES.join(", ")}.`, 400);
    }

    const [quotes, series, holdings, positions] = await Promise.all([
      getQuotes([symbol]),
      getChartSeries(symbol, rangeParam),
      getHoldings(),
      getPositions(),
    ]);

    const quote = quotes[0] ?? null;
    if (!quote) return fail(`No quote for ${symbol}.`, 404);

    return json({
      quote,
      series,
      range: rangeParam,
      ranges: RANGES,
      holding: holdings.find((h) => h.symbol === symbol) ?? null,
      position: positions.find((p) => p.symbol === symbol) ?? null,
    });
  });
}
