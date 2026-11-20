import { getHoldings, getPositions, getNav, isConnected } from "@/lib/api/broker";
import { json, guarded } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/portfolio — holdings, open positions and the NAV reading.
 *
 * `connected` is returned alongside, and the app needs it to tell two very
 * different situations apart: an account with nothing in it, and no account
 * attached at all. Both produce an empty array here. Only one of them should
 * be rendered as "no holdings" — the other has to say the broker is not
 * connected, because a zero balance and an absent balance are not the same
 * fact and the UI must not quietly pick one.
 */
export async function GET() {
  return guarded(async () => {
    const [holdings, positions, nav] = await Promise.all([
      getHoldings(),
      getPositions(),
      getNav(),
    ]);
    return json({ connected: isConnected(), holdings, positions, nav });
  });
}
