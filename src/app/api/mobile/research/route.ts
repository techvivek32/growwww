import { getUniverse } from "@/lib/api/yahoo";
import { buildScanRows } from "@/lib/alerts";
import { getOptionChain, isConnected } from "@/lib/api/broker";
import { getLinkedAccounts } from "@/lib/linked-accounts";
import { marketState } from "@/lib/market";
import { json, guarded, fail } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/research?view=… — the owner's research sections, which are
 * all small reads over the same two sources and do not deserve a route each.
 *
 *   scanner   the full NSE scan table      (web /stocks/scanner)
 *   backtest  per-strategy backtest edge   (web /stocks/alerts/backtest)
 *   chain     NIFTY option chain           (web /fno/chain)
 *   linked    linked broker accounts       (web /linked-accounts)
 *
 * Owner-only, matching OWNER_ONLY in lib/routes.ts. The proxy enforces that
 * for web paths but not for /api/mobile/, so the check lives here — otherwise
 * the phone would be a way around a boundary the browser respects.
 */
export async function GET(req: Request) {
  return guarded(async (c) => {
    const url = new URL(req.url);
    const view = url.searchParams.get("view") ?? "scanner";

    // The option chain is the one view a member may also open — it is market
    // data, not an account or a signal.
    if (view !== "chain" && c.role !== "owner") {
      return fail("That section is on the owner's account.", 403);
    }

    switch (view) {
      case "scanner": {
        const universe = await getUniverse();
        return json({ rows: buildScanRows(universe), market: marketState() });
      }

      case "chain": {
        const underlying = url.searchParams.get("underlying") ?? "NIFTY";
        const expiry = url.searchParams.get("expiry") ?? undefined;
        const chain = await getOptionChain(underlying, expiry);
        // Null is the honest answer, not an empty chain: Yahoo carries no
        // Indian option chain, so until Groww provides one there is nothing
        // to show. Modelling strikes locally would print numbers no exchange
        // ever did.
        return json({ chain, connected: isConnected() });
      }

      case "linked":
        return json({ accounts: getLinkedAccounts() });

      default:
        return fail(`Unknown view "${view}".`, 400);
    }
  });
}
