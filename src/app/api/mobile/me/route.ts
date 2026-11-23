import { getAccount, getConnectionStatus, getNav, canTrade, houseConfigured } from "@/lib/api/broker";
import { marketState, isTradingDate } from "@/lib/market";
import { tradePermission } from "@/lib/trading";
import { getDay, getSettings, ordersOfDay } from "@/lib/liveTrading/store";
import { strategyStatus } from "@/lib/liveTrading/memberStatus";
import { istNow } from "@/lib/liveTrading/util";
import { OWNER_ID } from "@/lib/auth";
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
        // The console is not a trading account, so there is no strategy to
        // report — null, not a cheerful "off" that would imply there is one.
        strategy: null,
        market: marketState(),
      });
    }

    const t = istNow();
    const trading = isTradingDate(t.date);
    const [account, connection, nav, live, perm, today, todays] = await Promise.all([
      getAccount(),
      getConnectionStatus(),
      getNav(),
      getSettings().catch(() => null),
      tradePermission(c.userId).catch(() => null),
      trading ? getDay(t.day, t.date).catch(() => null) : Promise.resolve(null),
      trading ? ordersOfDay(t.day).catch(() => []) : Promise.resolve([]),
    ]);
    const market = marketState();

    // The same sentence the website's Home shows this account, from the same
    // function — not a second reading of the same facts. It is the only place
    // a member is told whether their own money is in today's automatic
    // trades, so the phone and the website must not be able to differ.
    const baseRs = live?.base ?? 500_000;
    const free =
      account.balance !== null ? Math.max(0, account.balance - (account.usedMargin ?? 0)) : null;
    const strategy = strategyStatus({
      uid: c.userId,
      today,
      todays,
      live,
      minute: t.minute,
      keptOut: live ? live.excluded.includes(c.userId) : false,
      isOwner: c.userId === OWNER_ID,
      houseReady: houseConfigured(),
      addressAllowed: Boolean(perm?.allowed),
      hasCredentials: connection.credentials,
      free,
      baseRs,
      baseLabel: `₹${baseRs.toLocaleString("en-IN")}`,
    });

    return json({
      userId: c.userId,
      role: c.role,
      account,
      connection,
      nav,
      canTrade: canTrade(),
      strategy,
      market,
    });
  });
}
