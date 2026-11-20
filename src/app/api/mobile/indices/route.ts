import { getIndices, snapshotTakenAt } from "@/lib/api/yahoo";
import { marketState } from "@/lib/market";
import { json, guarded } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/indices — NIFTY, BANKNIFTY, MIDCPNIFTY, FINNIFTY.
 *
 * `stale` rides along per-quote rather than being summarised into one flag
 * for the whole response: Yahoo can serve three indices live and fall back to
 * the committed snapshot for the fourth, and flattening that would put an
 * "as of" date on numbers that are actually current.
 */
export async function GET() {
  return guarded(async () => {
    const quotes = await getIndices();
    return json({
      quotes,
      // Only meaningful for the quotes that actually came from the snapshot;
      // the client reads it per-quote via `stale`.
      snapshotAsOf: snapshotTakenAt(),
      market: marketState(),
    });
  });
}
