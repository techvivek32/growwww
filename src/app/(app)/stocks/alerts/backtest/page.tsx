import type { Metadata } from "next";
import Link from "next/link";
import { simulatePortfolio, DEFAULT_SIM } from "@/lib/signals/simulate";
import { hasCredentials } from "@/lib/api/groww";
import EquityCurve from "@/components/EquityCurve";
import { PageHead, Card, CardHead, Empty } from "@/components/ui";

export const metadata: Metadata = { title: "Backtest simulation · MNHA Financials" };
export const dynamic = "force-dynamic";

const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const toneOf = (v: number | null) => (v === null ? "text-ink" : v >= 0 ? "text-up" : "text-down");

function Stat({ label, value, tone = "text-ink", sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-[11px] tracking-wide text-ink3 uppercase">{label}</p>
      <p className={`tnum mt-0.5 text-[19px] font-semibold ${tone}`}>{value}</p>
      {sub && <p className="tnum text-[11px] text-ink3">{sub}</p>}
    </div>
  );
}

export default async function BacktestPage() {
  if (!hasCredentials()) {
    return (
      <>
        <PageHead title="Backtest simulation" sub="A portfolio run of the signals over real history." />
        <Card pad={false}>
          <Empty title="Not connected" hint="The simulation reads real Groww candles; it needs the account credentials configured on the server." />
        </Card>
      </>
    );
  }

  // The one setup with a measured edge, simulated on ₹1,00,000 with realistic costs.
  const sim = await simulatePortfolio(["mean-reversion"], DEFAULT_SIM);
  const netUp = sim.totalReturnPct !== null && sim.totalReturnPct >= 0;
  const costDragPct = +(((sim.endGross - sim.endNet) / sim.startCapital) * 100).toFixed(1);

  return (
    <>
      <PageHead
        title="Backtest simulation"
        sub={`Mean-reversion traded on ${inr(sim.startCapital)} across ${sim.years} years of real Groww candles — risk-sized, cost-charged. This is the forward test, run on the past.`}
        right={
          <Link href="/stocks/alerts" className="text-[13px] font-medium text-brandtext hover:opacity-75">
            ← Signals
          </Link>
        }
      />

      {/* the verdict, stated plainly */}
      <Card className={`mb-6 ${netUp ? "border-up/40 bg-upsoft/40" : "border-down/40 bg-downsoft/40"}`}>
        <div className="flex gap-3">
          <span className={`mt-0.5 ${netUp ? "text-up" : "text-down"}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
          </span>
          <div className="text-[13px] leading-relaxed text-ink2">
            <p className="font-semibold text-ink">
              The verdict: {inr(sim.startCapital)} became <span className={toneOf(sim.totalReturnPct)}>{inr(sim.endNet)}</span> after costs
              {" "}({pct(sim.totalReturnPct)} over {sim.years}y).
            </p>
            <p className="mt-1">
              Before costs the same trades made <strong>{inr(sim.endGross)}</strong> — a thin edge. But brokerage, STT and slippage
              took <strong>{inr(sim.costPaid)}</strong> across {sim.taken} trades, a {costDragPct}% drag that
              {netUp ? " still left a small gain." : " turned the edge into a loss."} This is why &ldquo;20% a month&rdquo; is not real:
              even a genuine, measured edge is this easily eaten by the cost of trading it. The honest use of these signals is
              a few high-conviction trades, sized small — not churning every one.
            </p>
          </div>
        </div>
      </Card>

      {/* the curve */}
      <Card className="mb-6">
        <CardHead title="Equity curve" sub="Gross (dashed) vs net of costs (solid). The gap is what trading it costs." />
        <EquityCurve net={sim.curveNet} gross={sim.curveGross} startCapital={sim.startCapital} />
      </Card>

      {/* the numbers */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Net return" value={pct(sim.totalReturnPct)} tone={toneOf(sim.totalReturnPct)} sub={`${inr(sim.endNet)} final`} />
        <Stat label="Annualised (CAGR)" value={pct(sim.cagrPct)} tone={toneOf(sim.cagrPct)} />
        <Stat label="Max drawdown" value={sim.maxDrawdownPct === null ? "—" : `−${sim.maxDrawdownPct}%`} tone="text-down" />
        <Stat label="Win rate" value={sim.winRate === null ? "—" : `${sim.winRate}%`} sub={`${sim.wins}W · ${sim.losses}L`} />
        <Stat label="Trades taken" value={String(sim.taken)} sub={`${sim.skipped} skipped (no slot)`} />
        <Stat label="Avg hold" value={sim.avgHoldDays === null ? "—" : `${sim.avgHoldDays}d`} />
        <Stat label="Costs paid" value={inr(sim.costPaid)} tone="text-down" />
        <Stat
          label="Out-of-sample"
          value={sim.oos ? pct(sim.oos.returnPct) : "—"}
          tone={toneOf(sim.oos?.returnPct ?? null)}
          sub="held-out last 40%"
        />
      </div>

      {/* monthly */}
      <Card>
        <CardHead title="Month by month" sub="Net return each month — the green/red mix a real account would have lived through." />
        <div className="flex flex-wrap gap-1.5">
          {sim.months.map((m) => (
            <div
              key={m.month}
              title={`${m.month}: ${pct(m.pct)}`}
              className={`flex min-w-[68px] flex-1 flex-col items-center rounded-md border px-2 py-1.5 ${
                m.pct >= 0 ? "border-up/30 bg-upsoft/40" : "border-down/30 bg-downsoft/40"
              }`}
            >
              <span className="text-[10px] text-ink3">{m.month}</span>
              <span className={`tnum text-[12px] font-semibold ${m.pct >= 0 ? "text-up" : "text-down"}`}>{pct(m.pct)}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-ink3">
          Costs assumed: {(DEFAULT_SIM.costRoundTrip * 100).toFixed(2)}% round-trip (Groww delivery brokerage + STT + exchange + GST + stamp,
          plus slippage). Risk {(DEFAULT_SIM.riskPct * 100).toFixed(0)}% of equity per trade, at most {DEFAULT_SIM.maxConcurrent} positions at once,
          each capped at {(DEFAULT_SIM.maxPositionPct * 100).toFixed(0)}% of equity. Even halving the cost assumption leaves this near breakeven —
          the edge is real but small, and there is no setting that turns it into 20% a month.
        </p>
      </Card>
    </>
  );
}
