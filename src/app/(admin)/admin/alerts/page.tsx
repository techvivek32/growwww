import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/access";
import { PageHead, Card, Pill } from "@/components/ui";
import { listAlerts, tradeAlertsStatus, WATCH_LEVELS, type TradeAlert } from "@/lib/tradeAlerts";
import { getSettings } from "@/lib/liveTrading/store";

export const metadata: Metadata = { title: "Stock alerts · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

const time = (ms: number) =>
  new Date(ms + 19_800_000).toISOString().slice(11, 19);

const dayTitle = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function Page() {
  await requireAdminPage();
  const [alerts, settings] = await Promise.all([listAlerts(400), getSettings()]);
  const status = tradeAlertsStatus();
  const byDay = new Map<string, TradeAlert[]>();
  for (const a of alerts) byDay.set(a.date, [...(byDay.get(a.date) ?? []), a]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHead
        title="Stock alerts"
        sub={`Book A's signals (09:20 sell, market stop, 10:15 flip, 15:15 square-off) and watchlist moves of ${WATCH_LEVELS.join(", ")}% from yesterday's close, during the live market. Each one also reaches your notifications and phone. Alerts only: nothing on this page trades.`}
        right={
          <Pill tone={settings.mode === "live" ? "warn" : "neutral"}>
            Automatic trading {settings.mode === "live" ? "LIVE" : "OFF"}
          </Pill>
        }
      />
      {settings.mode === "live" && (
        <p className="mb-4 text-[12.5px] text-ink2">
          Automatic trading is still on, so Book A also trades by itself. For alerts only, turn it off on{" "}
          <Link href="/admin/live" className="font-semibold text-ink underline underline-offset-2">Live trading</Link>.
        </p>
      )}
      {status.lastError && <p className="mb-4 text-[12.5px] text-down">The alert loop&apos;s last check failed: {status.lastError}</p>}
      {alerts.length === 0 ? (
        <Card>
          <p className="text-[13px] text-ink2">No alerts yet. They start at 09:20 on the next trading day.</p>
        </Card>
      ) : (
        [...byDay.entries()].map(([day, xs]) => (
          <Card key={day} className="mb-4" pad={false}>
            <div className="border-b border-line px-5 py-3 text-[13px] font-semibold text-ink">{dayTitle(day)}</div>
            <ul>
              {xs.map((a) => (
                <li key={a.id} className="flex gap-4 border-b border-line px-5 py-3 last:border-0">
                  <span className="tnum w-[64px] shrink-0 pt-0.5 text-[12px] text-ink3">{time(a.at)}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={a.tone}>{a.kind === "bookA" ? "Book A" : "Watchlist"}</Pill>
                      <span className="text-[13.5px] font-semibold text-ink">{a.title}</span>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">{a.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
