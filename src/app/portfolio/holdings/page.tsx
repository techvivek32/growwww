import type { Metadata } from "next";
import Link from "next/link";
import { ACCOUNT, TRADES, CLOSING_BALANCE, TOTAL_NET } from "@/lib/book";
import { fmtMoney, fmtMoneySigned } from "@/lib/format";
import { PageHead, StatTile, Card, CardHead, Empty, Button } from "@/components/ui";

export const metadata: Metadata = { title: "Portfolio · MNHA Financials" };

export default function HoldingsPage() {
  return (
    <>
      <PageHead
        title="Portfolio"
        sub="Delivery holdings in your Groww demat account (CNC)."
        right={<Button variant="outline" size="sm">Import holdings</Button>}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Cash balance" value={fmtMoney(CLOSING_BALANCE)} sub="Fully available — no margin blocked" />
        <StatTile label="Holdings value" value={fmtMoney(0, 0)} sub="No delivery positions" />
        <StatTile
          label="Realised P&L"
          value={fmtMoneySigned(TOTAL_NET, 2)}
          tone="up"
          sub={ACCOUNT.windowLabel}
        />
        <StatTile label="Opening capital" value={fmtMoney(ACCOUNT.openingCapital, 0)} sub={`${ACCOUNT.sessions} sessions ago`} />
      </div>

      <Card pad={false}>
        <Empty
          title="No delivery holdings"
          hint={`All ${TRADES.length} round-trips in this window were intraday MIS and were squared off the same session, so nothing carried into the demat account. The full ${fmtMoney(CLOSING_BALANCE)} is sitting as cash.`}
        />
      </Card>

      <Card className="mt-5">
        <CardHead title="Where the money is" sub="Cash and positions across the account" />
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          {[
            { k: "Cash", v: fmtMoney(CLOSING_BALANCE) },
            { k: "Delivery (CNC)", v: fmtMoney(0, 0) },
            { k: "Open F&O (NRML)", v: fmtMoney(0, 0) },
          ].map((r) => (
            <div key={r.k} className="border-b border-line pb-3 last:border-0 sm:border-0 sm:pb-0">
              <dt className="text-[11px] tracking-wider text-ink3 uppercase">{r.k}</dt>
              <dd className="tnum mt-0.5 text-[15px] font-semibold text-ink">{r.v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[13px] leading-relaxed text-ink2">
          Today&apos;s squared-off positions are on the{" "}
          <Link href="/portfolio/positions" className="font-medium text-brandtext underline underline-offset-2">
            Positions
          </Link>{" "}
          tab, and the full three-session record is under{" "}
          <Link href="/portfolio/history" className="font-medium text-brandtext underline underline-offset-2">
            History
          </Link>
          .
        </p>
      </Card>
    </>
  );
}
