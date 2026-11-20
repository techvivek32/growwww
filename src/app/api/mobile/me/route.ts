import { getAccount, getConnectionStatus, getNav, canTrade } from "@/lib/api/broker";
import { marketState } from "@/lib/market";
import { json, guarded } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/me — who is signed in, what their account looks like, and
 * whether the market is open. The first call the app makes after login, and
 * the one it re-checks on resume.
 *
 * `connected` and `canTrade` are separate on purpose and the app must treat
 * them that way: a connected broker that is read-only still shows balances,
 * and rendering an enabled Buy button against it would be a lie the user
 * only discovers at the moment it matters.
 */
export async function GET() {
  return guarded(async (c) => {
    // The admin login is a console, not a trading account: it has no broker,
    // no holdings and no desk. Calling the broker for it would at best return
    // empty and at worst resolve to the house account, so this answers with
    // identity and the market clock and stops there.
    if (c.role === "admin") {
      return json({
        userId: c.userId,
        role: c.role,
        account: { name: "Admin", email: "", broker: "", balance: null, usedMargin: null, ucc: null, segments: [] },
        connection: { credentials: false, live: false, ipPinned: false, orderIp: null },
        nav: null,
        canTrade: false,
        market: marketState(),
      });
    }

    const [account, connection, nav] = await Promise.all([
      getAccount(),
      getConnectionStatus(),
      getNav(),
    ]);
    const market = marketState();
    return json({
      userId: c.userId,
      role: c.role,
      account,
      connection,
      nav,
      canTrade: canTrade(),
      market,
    });
  });
}
