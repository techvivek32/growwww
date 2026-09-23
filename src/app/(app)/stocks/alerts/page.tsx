import type { Metadata } from "next";
import { getUniverse } from "@/lib/api/yahoo";
import { buildAlerts } from "@/lib/alerts";
import { BestTrade, AlertCard } from "@/components/AlertCard";
import MarketMood from "@/components/MarketMood";
import { PageHead, Pill, Card, Empty, SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Stock Alerts · MNHA Financials" };

export default async function StockAlertsPage() {
  const universe = await getUniverse();
  const alerts = buildAlerts(universe);
  const [best, ...rest] = alerts;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_352px]">
      <div className="min-w-0">
        <PageHead
          title="Stock Alerts"
          sub="Rule-based NSE buy setups from daily bars and the live tick. Entry is the last traded price; the stop comes from the stock's own range; the target is its 20-day closing high where one sits above."
          right={<Pill tone="neutral">{universe.length} scanned</Pill>}
        />

        {best ? (
          <>
            <BestTrade a={best} />

            <SectionHead
              title="Buy alerts"
              right={<span className="text-[13.5px] text-ink3">{rest.length} more</span>}
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
