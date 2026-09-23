import type { Metadata } from "next";
import MarketMood from "@/components/MarketMood";
import { PageHead, Card } from "@/components/ui";

export const metadata: Metadata = { title: "F&O Alerts · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

export default async function FnoAlertsPage() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_352px]">
      <div className="min-w-0">
        <PageHead
          title="F&O Alerts"
          sub="NSE index option setups, sized in whole lots — NSE options cannot be traded in odd lots."
        />

        <Card pad={false}>
          <div className="px-6 py-14 text-center">
            <p className="text-[15px] font-semibold text-ink">Not built yet</p>
            <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-ink3">
              Groww&apos;s API returns option quotes per instrument, not a whole chain, and nothing here
              assembles one yet. Option setups arrive when chain building does — this page will not
              pretend otherwise in the meantime.
            </p>
          </div>
        </Card>
      </div>

      <aside className="min-w-0">
        <MarketMood />
      </aside>
    </div>
  );
}
