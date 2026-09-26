import type { Metadata } from "next";
import PublicShell, { LegalArticle } from "@/components/PublicShell";

export const metadata: Metadata = {
  title: "Risk Disclosure · MNHA Financials",
  description: "The risks of trading equities and derivatives, stated plainly.",
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[17px] font-semibold tracking-tight text-ink">{children}</h2>;
}

export default function RiskPage() {
  return (
    <PublicShell>
      <LegalArticle title="Risk Disclosure" updated="September 2026">
        <div className="rounded-xl border border-warn/40 bg-warnsoft/50 p-5 text-[14px] leading-relaxed text-ink2">
          <p className="font-semibold text-ink">Trading can lose you money — potentially all of it, and in derivatives more than you put in.</p>
          <p className="mt-2">
            Read this before you trade on anything you see in MNHA Financials. If a claim of guaranteed or effortless
            returns ever reaches you — from us or anyone — treat it as false.
          </p>
        </div>

        <div className="space-y-2">
          <H>Markets are risky</H>
          <p>
            Prices of equities and derivatives move for reasons no model fully captures. You can lose part or all of
            your capital. Leveraged instruments (futures and options) can lose more than your initial margin.
          </p>
        </div>

        <div className="space-y-2">
          <H>Most active traders lose</H>
          <p>
            SEBI&apos;s own studies have found that the large majority of individual F&amp;O traders lose money after
            costs. Trading costs — brokerage, STT, exchange fees, GST, stamp duty and slippage — are real and
            compound; a strategy that looks profitable before costs can be a loss after them. Our backtest simulation
            charges these costs on purpose, so you can see the difference.
          </p>
        </div>

        <div className="space-y-2">
          <H>Signals are not advice or predictions</H>
          <p>
            The setups shown are mechanical rules read off historical and live data. They are not forecasts, not
            personalised advice, and not a recommendation. A setup with a positive historical edge can still lose, and
            edges decay as markets change. Nothing here guarantees a future outcome.
          </p>
        </div>

        <div className="space-y-2">
          <H>Technology can fail</H>
          <p>
            Data can be delayed, wrong or missing; the Service can be down; an order may not reach the exchange, or may
            reach it after you think it failed. Always verify positions and orders with your broker. Do not rely on the
            Service as your only source of truth.
          </p>
        </div>

        <div className="space-y-2">
          <H>Trade only what you can afford to lose</H>
          <p>
            Never trade money you need for essentials, and never trade under pressure to hit a target. Consider your
            own financial situation and, if needed, consult a SEBI-registered investment adviser. You are responsible
            for your own decisions.
          </p>
        </div>
      </LegalArticle>
    </PublicShell>
  );
}
