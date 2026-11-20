import { getOrders, getTrades, isConnected } from "@/lib/api/broker";
import { json, guarded } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/orders — today's order book, plus the closed-trade archive
 * when called with `?history=1`.
 *
 * The archive is a separate, heavier read (it pairs fills into round trips),
 * so the orders screen does not pay for it and the history screen asks
 * explicitly.
 */
export async function GET(req: Request) {
  return guarded(async () => {
    const wantHistory = new URL(req.url).searchParams.get("history") === "1";
    const [orders, trades] = await Promise.all([
      getOrders(),
      wantHistory ? getTrades() : Promise.resolve(undefined),
    ]);
    return json({ connected: isConnected(), orders, trades });
  });
}
