import type { Metadata } from "next";
import { getOptionChain } from "@/lib/api/broker";
import MarketMood from "@/components/MarketMood";
import NotConnected from "@/components/NotConnected";
import { PageHead, Card, CardHead } from "@/components/ui";

export const metadata: Metadata = { title: "AI F&O Alerts · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

export default async function FnoAlertsPage() {
  const chain = await getOptionChain();

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_352px]">
      <div className="min-w-0">
        <PageHead
          title="AI F&O Alerts"
          sub="NSE index option setups, sized in whole lots — NSE options cannot be traded in odd lots."
        />

        {!chain ? (
          <NotConnected
            what="No option setups yet"
            detail="Option setups are built from live strike prices, open interest and implied volatility. None of that is in the free price feed, so it comes from the broker."
          />
        ) : (
          <Card pad={false}>
            <div className="px-5 py-8 text-center text-[13.5px] text-ink3">
              Chain loaded for {chain.underlying}. Setup generation runs on the next scan.
            </div>
          </Card>
        )}

        <Card className="mt-5">
          <CardHead
            title="Why there is no bracket order here"
            sub="Groww's API exposes MARKET, LIMIT, SL and SL_M only — there are no bracket or cover orders."
          />
          <p className="text-[13.5px] leading-relaxed text-ink2">
            MNHA emulates the stop and target with a{" "}
            <strong className="font-semibold text-ink">GTT + OCO</strong> pair: two resting orders where the fill of
            one cancels the other. Both legs show in the Orders tab, and cancelling either cancels the pair.
          </p>
        </Card>
      </div>

      <aside className="min-w-0">
        <MarketMood />
      </aside>
    </div>
  );
}
