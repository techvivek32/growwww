import { getHoldings, getPositions, getTrades, getNav, isConnected } from "@/lib/api/broker";
import { json, guarded } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/analysis — portfolio analytics (the web's
 * /portfolio/analysis): allocation, concentration and realised performance.
 *
 * Every aggregate here is computed over the rows that actually have a live
 * price, and `pricedCount` / `holdingsCount` are returned so the app can say
 * when they differ. Quietly summing a missing price as zero would understate
 * allocation and overstate nothing, which is the kind of error that looks
 * like a small rounding difference and is not.
 */
export async function GET() {
  return guarded(async () => {
    const [holdings, positions, trades, nav] = await Promise.all([
      getHoldings(),
      getPositions(),
      getTrades(),
      getNav(),
    ]);

    const priced = holdings.filter((h) => h.ltp != null);
    const invested = priced.reduce((a, h) => a + h.avg * h.qty, 0);
    const current = priced.reduce((a, h) => a + h.ltp! * h.qty, 0);

    const allocation = priced
      .map((h) => ({
        symbol: h.symbol,
        company: h.company,
        value: h.ltp! * h.qty,
        // Share of the priced book, not of NAV — cash is not an allocation.
        pct: current === 0 ? 0 : ((h.ltp! * h.qty) / current) * 100,
        pnl: (h.ltp! - h.avg) * h.qty,
      }))
      .sort((a, b) => b.value - a.value);

    const wins = trades.filter((t) => {
      const dir = t.side === "SELL" ? -1 : 1;
      return (t.exit - t.entry) * t.qty * dir > 0;
    }).length;

    const realised = trades.reduce((a, t) => {
      const dir = t.side === "SELL" ? -1 : 1;
      return a + (t.exit - t.entry) * t.qty * dir;
    }, 0);

    return json({
      connected: isConnected(),
      nav,
      invested,
      current,
      unrealised: current - invested,
      unrealisedPct: invested === 0 ? null : ((current - invested) / invested) * 100,
      // Gross: Groww's payload carries no per-trade charges, and an
      // account-level figure split across trades is a guess, not a fact.
      realisedGross: realised,
      tradeCount: trades.length,
      wins,
      winRate: trades.length === 0 ? null : (wins / trades.length) * 100,
      allocation,
      // Concentration: the single largest holding's share of the book.
      topWeightPct: allocation.length ? allocation[0].pct : null,
      openPositions: positions.length,
      holdingsCount: holdings.length,
      pricedCount: priced.length,
    });
  });
}
