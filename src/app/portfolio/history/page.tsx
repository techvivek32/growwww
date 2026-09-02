import type { Metadata } from "next";
import { TRADES } from "@/lib/mock";
import { fmtMoney, fmtMoneySigned, fmtPct, toneText } from "@/lib/format";
import { PageHead, StatTile, Pill, SymbolChip, Button } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";

export const metadata: Metadata = { title: "History · NOVA India" };

function hold(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export default function HistoryPage() {
  const gross = TRADES.reduce((s, t) => s + t.pnl, 0);
  const charges = TRADES.reduce((s, t) => s + t.charges, 0);
  const wins = TRADES.filter((t) => t.pnl > 0).length;

  return (
    <>
      <PageHead
        title="Trade history"
        sub="Closed round-trips only. Nothing here is estimated — each row is a matched buy and sell."
        right={<Button variant="outline" size="sm">Download statement</Button>}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Gross P&L" value={fmtMoneySigned(gross, 0)} tone={gross >= 0 ? "up" : "down"} sub={`${TRADES.length} round-trips`} />
        <StatTile label="Charges" value={fmtMoney(charges, 0)} sub="Brokerage, STT, GST, stamp duty" />
        <StatTile label="Net P&L" value={fmtMoneySigned(gross - charges, 0)} tone={gross - charges >= 0 ? "up" : "down"} />
        <StatTile label="Win rate" value={`${Math.round((wins / TRADES.length) * 100)}%`} sub={`${wins}W · ${TRADES.length - wins}L`} />
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Stock</Th>
            <Th align="center">Side</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Entry</Th>
            <Th align="right">Exit</Th>
            <Th align="right">Hold</Th>
            <Th align="right">Charges</Th>
            <Th align="right">Net P&L</Th>
          </tr>
        </thead>
        <tbody>
          {TRADES.map((t, i) => {
            const net = t.pnl - t.charges;
            const pct = ((t.exit - t.entry) / t.entry) * 100;
            return (
              <Tr key={`${t.date}-${t.symbol}-${i}`}>
                <Td className="whitespace-nowrap">{t.date}</Td>
                <Td>
                  <div className="flex items-center gap-3">
                    <SymbolChip symbol={t.symbol} size={28} />
                    <span className="text-[13px] font-semibold text-ink">{t.symbol}</span>
                  </div>
                </Td>
                <Td align="center">
                  <Pill tone={t.side === "BUY" ? "up" : "down"}>{t.side}</Pill>
                </Td>
                <Td align="right" className="tnum">{t.qty}</Td>
                <Td align="right" className="tnum">{fmtMoney(t.entry)}</Td>
                <Td align="right" className="tnum">{fmtMoney(t.exit)}</Td>
                <Td align="right" className="tnum">{hold(t.holdMins)}</Td>
                <Td align="right" className="tnum text-ink3">{fmtMoney(t.charges)}</Td>
                <Td align="right" className={`tnum font-semibold ${toneText(net)}`}>
                  {fmtMoneySigned(net, 0)}
                  <span className="block text-[11px] font-normal">{fmtPct(pct)}</span>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableWrap>
    </>
  );
}
