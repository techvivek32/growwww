import type { Metadata } from "next";
import Link from "next/link";
import { getIndices } from "@/lib/api/yahoo";
import { buildFnoAlerts } from "@/lib/options";
import { fmtMoney, fmtNum } from "@/lib/format";
import { PageHead, Card, CardHead, Pill, Tag, Button } from "@/components/ui";
import { TradeRail } from "@/components/AlertCard";
import MarketMood from "@/components/MarketMood";

export const metadata: Metadata = { title: "AI F&O Alerts · MNHA Financials" };
export const revalidate = 300;

export default async function FnoAlertsPage() {
  const indices = await getIndices();
  const alerts = buildFnoAlerts(indices);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <PageHead
          title="AI F&O Alerts"
          sub="NSE index option setups off the live spot. Every quantity is a whole number of lots — NSE options cannot be traded in odd lots."
          right={<Pill tone="violet">{alerts.length} live</Pill>}
        />

        <div className="grid gap-4 xl:grid-cols-2">
          {alerts.map((f) => {
            const qty = f.lotSize * f.lots;
            const cost = f.entry * qty;
            const risk = (f.entry - f.stop) * qty;
            const reward = (f.target - f.entry) * qty;
            const name = `${f.underlying} ${fmtNum(f.strike)} ${f.right}`;

            return (
              <Card key={name} className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[16px] font-bold tracking-tight text-ink">{name}</h3>
                      <Pill tone={f.right === "CE" ? "up" : "down"}>{f.right}</Pill>
                    </div>
                    <p className="mt-1 text-[12px] text-ink3">
                      Expiry {f.expiry} · {f.daysLeft}d left · Lot {f.lotSize} · {f.lots} lot
                      {f.lots > 1 ? "s" : ""} = {fmtNum(qty)} qty
                    </p>
                  </div>
                  <Pill tone={f.score >= 85 ? "up" : "brand"}>Score {f.score}</Pill>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    { l: "Entry", v: fmtMoney(f.entry), c: "text-ink" },
                    { l: "Target", v: fmtMoney(f.target), c: "text-up" },
                    { l: "Stop", v: fmtMoney(f.stop), c: "text-down" },
                  ].map((x) => (
                    <div key={x.l} className="rounded-lg border border-line bg-surface2 px-3 py-2.5 text-center">
                      <p className="text-[10px] font-semibold tracking-wider text-ink3 uppercase">{x.l}</p>
                      <p className={`tnum mt-1 text-[15px] font-semibold ${x.c}`}>{x.v}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-3">
                  <TradeRail stop={f.stop} entry={f.entry} target={f.target} last={f.premium} />
                </div>

                {/* The lot maths spelled out — this is what actually leaves the account */}
                <dl className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-line bg-surface2 px-3 py-3">
                  <div>
                    <dt className="text-[10px] tracking-wider text-ink3 uppercase">Premium outlay</dt>
                    <dd className="tnum mt-0.5 text-[13px] font-semibold text-ink">{fmtMoney(cost, 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] tracking-wider text-ink3 uppercase">Max risk</dt>
                    <dd className="tnum mt-0.5 text-[13px] font-semibold text-down">{fmtMoney(risk, 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] tracking-wider text-ink3 uppercase">Target gain</dt>
                    <dd className="tnum mt-0.5 text-[13px] font-semibold text-up">{fmtMoney(reward, 0)}</dd>
                  </div>
                </dl>

                <p className="mt-3 flex-1 text-[12px] leading-relaxed text-ink2">{f.rationale}</p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Tag>IV {f.iv.toFixed(1)}%</Tag>
                  <Tag>LTP {fmtMoney(f.premium)}</Tag>
                  <Tag>Weekly expiry</Tag>
                </div>

                <div className="mt-4 flex gap-2">
                  <Button className="flex-1">
                    Buy {f.lots} lot{f.lots > 1 ? "s" : ""}
                  </Button>
                  <Link
                    href="/fno/chain"
                    className="inline-flex h-11 items-center justify-center rounded-lg border border-line2 px-5 text-[14px] font-semibold text-ink transition-colors hover:bg-surfaceh"
                  >
                    Chain
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>

        <Card className="mt-4">
          <CardHead
            title="Why there is no bracket order here"
            sub="Groww's API exposes MARKET, LIMIT, SL and SL_M only — no bracket or cover orders."
          />
          <p className="text-[13px] leading-relaxed text-ink2">
            MNHA emulates the stop and target with a <strong className="font-semibold text-ink">GTT + OCO</strong>{" "}
            pair: two resting orders where the fill of one cancels the other. Both legs appear in the Orders tab,
            and cancelling either cancels the pair.
          </p>
        </Card>

        <p className="mt-4 text-[11px] leading-relaxed text-ink3">
          Premiums are Black-Scholes values against the live index level, real strike spacing, real lot sizes and
          the real days to expiry — internally consistent, but a model rather than the exchange&apos;s quotes. Phase 2
          replaces them with Groww&apos;s own chain.
        </p>
      </div>

      <aside className="min-w-0">
        <MarketMood />
      </aside>
    </div>
  );
}
