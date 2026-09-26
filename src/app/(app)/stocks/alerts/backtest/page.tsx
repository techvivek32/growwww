import type { Metadata } from "next";
import Link from "next/link";
import { simulatePortfolio, DEFAULT_SIM } from "@/lib/signals/simulate";
import { hasCredentials } from "@/lib/api/groww";
import EquityCurve from "@/components/EquityCurve";
import { PageHead, Card, CardHead, Empty } from "@/components/ui";

export const metadata: Metadata = { title: "Backtest simulation · MNHA Financials" };
export const dynamic = "force-dynamic";

// Realistic all-in round-trip costs on ₹-notional.
const COST_DELIVERY = 0.0045; // equity delivery: 0.2% STT both sides dominates
const COST_FUTURES = 0.0012; // futures: ~0.02% STT sell-only + flat brokerage + slippage

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

  const [delivery, futures] = await Promise.all([
    simulatePortfolio(["mean-reversion"], { ...DEFAULT_SIM, costRoundTrip: COST_DELIVERY }),
    simulatePortfolio(["mean-reversion"], { ...DEFAULT_SIM, costRoundTrip: COST_FUTURES }),
  ]);

  // The honest "max" is the best net-of-cost path — futures — annualised.
  const maxCagr = futures.cagrPct;

  return (
    <>
      <PageHead
        title="Backtest simulation"
        sub={`Mean-reversion traded on ${inr(DEFAULT_SIM.startCapital)} across ${futures.years} years of real Groww candles — risk-sized, cost-charged. This is the forward test, run on the past.`}
        right={
          <Link href="/stocks/alerts" className="text-[13px] font-medium text-brandtext hover:opacity-75">
            ← Signals
          </Link>
        }
      />

      {/* the honest answer */}
      <Card className="mb-6 border-warn/40 bg-warnsoft/40">
        <div className="flex gap-3">
          <span className="mt-0.5 text-warn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
          </span>
          <div className="text-[13px] leading-relaxed text-ink2">
            <p className="text-[15px] font-semibold text-ink">
              The honest answer: after costs, this does not reliably make money — nowhere near 20% a month.
            </p>
            <p className="mt-1">
              Traded as delivery shares the edge <strong className="text-down">loses</strong> (₹{DEFAULT_SIM.startCapital.toLocaleString("en-IN")} →
              {" "}{inr(delivery.endNet)}, {pct(delivery.totalReturnPct)}) — the 0.2% delivery STT alone eats it. Even through
              <strong> futures</strong>, where costs are ~5× lower, it lands about <span className={toneOf(maxCagr)}>{pct(maxCagr)}</span> a
              year — essentially <strong>breakeven</strong>. I searched 120 parameter sets and optimised directly for net-of-cost
              return; none of them clears the bar on this period.
            </p>
            <p className="mt-2">
              What is actually achievable for disciplined systematic retail trading is the low double digits <em>per year</em> in a
              good year, with real drawdowns — and most people underperform even that. There is no algorithm, model, or amount of
              data that turns this into 20% a month. That number is not real, and I will not draw you a fake curve that says it is.
            </p>
          </div>
        </div>
      </Card>

      {/* the curve — best (futures) scenario */}
      <Card className="mb-6">
        <CardHead title="Equity curve — best case (futures costs)" sub="Gross (dashed) vs net of costs (solid). The gap is what trading it costs." />
        <EquityCurve net={futures.curveNet} gross={futures.curveGross} startCapital={futures.startCapital} />
      </Card>

      {/* the numbers (futures scenario) */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Net return" value={pct(futures.totalReturnPct)} tone={toneOf(futures.totalReturnPct)} sub={`${inr(futures.endNet)} final`} />
        <Stat label="Annualised (CAGR)" value={pct(futures.cagrPct)} tone={toneOf(futures.cagrPct)} />
        <Stat label="Max drawdown" value={futures.maxDrawdownPct === null ? "—" : `−${futures.maxDrawdownPct}%`} tone="text-down" />
        <Stat label="Win rate" value={futures.winRate === null ? "—" : `${futures.winRate}%`} sub={`${futures.wins}W · ${futures.losses}L`} />
        <Stat label="Trades taken" value={String(futures.taken)} sub={`${futures.skipped} skipped (no slot)`} />
        <Stat label="Avg hold" value={futures.avgHoldDays === null ? "—" : `${futures.avgHoldDays}d`} />
        <Stat label="Out-of-sample" value={futures.oos ? pct(futures.oos.returnPct) : "—"} tone={toneOf(futures.oos?.returnPct ?? null)} sub="held-out last 40%" />
        <Stat label="If delivery instead" value={pct(delivery.totalReturnPct)} tone={toneOf(delivery.totalReturnPct)} sub="costs eat the edge" />
      </div>

      {/* monthly */}
      <Card>
        <CardHead title="Month by month (futures costs)" sub="Net return each month — the green/red mix a real account would have lived through." />
        <div className="flex flex-wrap gap-1.5">
          {futures.months.map((m) => (
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
          Costs modelled: futures {(COST_FUTURES * 100).toFixed(2)}% vs delivery {(COST_DELIVERY * 100).toFixed(2)}% round-trip. Risk{" "}
          {(DEFAULT_SIM.riskPct * 100).toFixed(0)}% of equity per trade, at most {DEFAULT_SIM.maxConcurrent} positions at once, each capped at{" "}
          {(DEFAULT_SIM.maxPositionPct * 100).toFixed(0)}% of equity. Every entry and exit is the strategy&apos;s own real level on real candles;
          the out-of-sample figure is the held-out last 40% the parameters were not chosen on. No configuration in a 120-way search produced 20% a
          month — that number does not exist.
        </p>
      </Card>
    </>
  );
}
