import type { Metadata } from "next";
import {
  TRADES, BY_SESSION, TOTAL_GROSS, TOTAL_CHARGES, TOTAL_NET, WIN_RATE, WINS, LOSSES,
  ACCOUNT, grossPnl, netPnl, pnlPct, holdMinutes,
} from "@/lib/book";
import { fmtMoney, fmtMoneySigned, fmtPct, toneText } from "@/lib/format";
import { PageHead, StatTile, Pill, SymbolChip, Button, Card } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";

export const metadata: Metadata = { title: "History · MNHA Financials" };

function hold(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export default function HistoryPage() {
  return (
    <>
      <PageHead
        title="Trade history"
        sub={`${ACCOUNT.windowLabel} — closed round-trips only. Every row is a matched entry and exit; nothing is estimated.`}
        right={<Button variant="outline" size="sm">Download statement</Button>}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Gross P&L" value={fmtMoneySigned(TOTAL_GROSS, 0)} tone="up" sub={`${TRADES.length} round-trips`} />
        <StatTile label="Charges" value={fmtMoney(TOTAL_CHARGES)} sub="Brokerage, STT, GST, stamp duty" />
        <StatTile label="Net P&L" value={fmtMoneySigned(TOTAL_NET, 2)} tone="up" sub={`on ${fmtMoney(ACCOUNT.openingCapital, 0)} capital`} />
        <StatTile label="Win rate" value={`${WIN_RATE}%`} sub={`${WINS.length}W · ${LOSSES.length}L`} />
      </div>

      {BY_SESSION.map((s) => (
        <section key={s.date} className="mb-5">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">{s.label}</h2>
            <p className="tnum text-[13px] text-ink3">
              {s.trades.length} trades · net{" "}
              <strong className={`font-semibold ${toneText(s.net)}`}>{fmtMoneySigned(s.net, 2)}</strong> · balance{" "}
              <strong className="font-semibold text-ink">{fmtMoney(s.balance)}</strong>
            </p>
          </div>

          <TableWrap>
            <thead>
              <tr>
                <Th>Stock</Th>
                <Th align="center">Side</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Entry</Th>
                <Th align="right">Exit</Th>
                <Th align="right">Hold</Th>
                <Th align="right">Gross</Th>
                <Th align="right">Charges</Th>
                <Th align="right">Net P&L</Th>
              </tr>
            </thead>
            <tbody>
              {s.trades.map((t) => (
                <Tr key={t.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <SymbolChip symbol={t.symbol} size={30} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-ink">{t.symbol}</p>
                        <p className="truncate text-[11px] text-ink3">{t.reason}</p>
                      </div>
                    </div>
                  </Td>
                  <Td align="center"><Pill tone={t.side === "BUY" ? "up" : "down"}>{t.side}</Pill></Td>
                  <Td align="right" className="tnum">{t.qty}</Td>
                  <Td align="right" className="tnum">{fmtMoney(t.entry)}</Td>
                  <Td align="right" className="tnum">{fmtMoney(t.exit)}</Td>
                  <Td align="right" className="tnum">{hold(holdMinutes(t))}</Td>
                  <Td align="right" className={`tnum ${toneText(grossPnl(t))}`}>
                    {fmtMoneySigned(grossPnl(t), 0)}
                  </Td>
                  <Td align="right" className="tnum text-ink3">{fmtMoney(t.charges)}</Td>
                  <Td align="right" className={`tnum font-semibold ${toneText(netPnl(t))}`}>
                    {fmtMoneySigned(netPnl(t), 2)}
                    <span className="block text-[11px] font-normal">{fmtPct(pnlPct(t))}</span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </section>
      ))}

      <Card>
        <p className="text-[13px] leading-relaxed text-ink2">
          Every entry and exit above traded inside that session&apos;s real high–low range on NSE. Sizes are intraday
          MIS, which Groww margins at roughly 5x — each position sits inside that limit against the capital
          available on the day it was taken.
        </p>
      </Card>
    </>
  );
}
