import type { Metadata } from "next";
import { STOCK_ALERTS, ACCOUNT } from "@/lib/mock";
import { BestTrade, AlertCard } from "@/components/AlertCard";
import MarketMood from "@/components/MarketMood";
import { PageHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "AI Stock Alerts · MNHA Financials" };

export default function StockAlertsPage() {
  const [best, ...rest] = STOCK_ALERTS;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <PageHead
          title="AI Stock Alerts"
          sub="Live NSE buy setups — entry, target and stop on every one. Re-scanned every ~10 minutes during market hours."
          right={
            <div className="flex items-center gap-2">
              <Pill tone="neutral">
                {ACCOUNT.lastScanMins}m ago · {ACCOUNT.scannedSymbols} scanned
              </Pill>
            </div>
          }
        />

        <BestTrade a={best} />

        <div className="mt-6 mb-3 flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">Buy alerts</h2>
          <span className="text-[13px] text-ink3">{rest.length} working</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rest.map((a) => (
            <AlertCard key={a.symbol} a={a} />
          ))}
        </div>
      </div>

      <aside className="min-w-0">
        <MarketMood />
      </aside>
    </div>
  );
}
