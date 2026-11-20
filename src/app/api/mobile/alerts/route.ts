import { getUniverse } from "@/lib/api/yahoo";
import { buildAlerts, buildScanRows } from "@/lib/alerts";
import { marketState } from "@/lib/market";
import { json, guarded, fail } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/alerts — the rule-based setups, and the scanner rows they
 * are drawn from. `?scan=1` adds the full scan table.
 *
 * Owner-only, matching OWNER_ONLY in `lib/routes.ts`. The proxy enforces that
 * for web paths, but /api/mobile/ is not in its owner-only list, so the check
 * has to happen here — otherwise the phone would be a way around a boundary
 * the browser respects.
 *
 * Scores, stops and R/R all come from `lib/alerts.ts`, the same module the
 * web page uses. Nothing is recomputed for mobile.
 */
export async function GET(req: Request) {
  return guarded(async (c) => {
    if (c.role !== "owner") return fail("Alerts are on the owner's account.", 403);

    const universe = await getUniverse();
    const wantScan = new URL(req.url).searchParams.get("scan") === "1";

    return json({
      alerts: buildAlerts(universe),
      scan: wantScan ? buildScanRows(universe) : undefined,
      market: marketState(),
    });
  });
}
