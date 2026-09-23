import type { Metadata } from "next";
import { getUniverse } from "@/lib/api/yahoo";
import { buildAlerts } from "@/lib/alerts";
import { BestTrade, AlertCard } from "@/components/AlertCard";
import MarketMood from "@/components/MarketMood";
import { PageHead, Pill, Card, Empty, SectionHead, MoreLink } from "@/components/ui";

export const metadata: Metadata = { title: "AI Stock Alerts · MNHA Financials" };

export default async function StockAlertsPage() {
  const universe = await getUniverse();
  const alerts = buildAlerts(universe);
  const [best, ...rest] = alerts;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_352px]">
      <div className="min-w-0">
        <PageHead
          title="AI Stock Alerts"
          sub="Live NSE buy setups — entry, target and stop on every one, sized off the stock's own daily range."
          right={<Pill tone="neutral">{universe.length} scanned</Pill>}
        />

        {best ? (
          <>
            <BestTrade a={best} />

            <SectionHead
              title="Buy alerts"
              right={<MoreLink>See all {rest.length}</MoreLink>}
              className="mt-8"
            />

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rest.map((a) => (
                <AlertCard key={a.symbol} a={a} />
              ))}
            </div>
          </>
        ) : (
          <Card pad={false}>
            <Empty
              title="No setups passed the filter"
              hint="Every stock in the universe closed red or failed the volume and trend checks. The engine does not publish a long into a down day."
            />
          </Card>
        )}
      </div>

      <aside className="min-w-0">
        <MarketMood />
      </aside>
    </div>
  );
}
