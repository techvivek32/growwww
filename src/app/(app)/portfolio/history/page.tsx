import type { Metadata } from "next";
import { getTrades } from "@/lib/api/broker";
import { fmtMoney, fmtMoneySigned, fmtPct, toneText } from "@/lib/format";
import { PageHead, StatTile, Pill, SymbolChip, Button } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";
import NotConnected from "@/components/NotConnected";

export const metadata: Metadata = { title: "History · MNHA Financials" };

export default async function HistoryPage() {
  const trades = await getTrades();

  if (trades.length === 0) {
    return (
      <>
        <PageHead title="Trade history" sub="Closed round-trips, straight from your broker statement." />
        <NotConnected
          what="No trades recorded yet"
          detail="History is built from matched buys and sells on your Groww account. Nothing is estimated, so nothing appears until there is a real fill to record."
        />
      </>
    );
  }

  const netOf = (t: (typeof trades)[number]) =>
    (t.exit - t.entry) * t.qty * (t.side === "BUY" ? 1 : -1) - t.charges;

  const gross = trades.reduce(
    (s, t) => s + (t.exit - t.entry) * t.qty * (t.side === "BUY" ? 1 : -1),
    0,
  );
  const charges = trades.reduce((s, t) => s + t.charges, 0);
  const wins = trades.filter((t) => netOf(t) > 0).length;

  return (
    <>
      <PageHead
        title="Trade history"
        sub="Closed round-trips only. Every row is a matched buy and sell — nothing is estimated."
        right={
          <Button variant="outline" size="sm">
            Download statement
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Gross P&L"
          value={fmtMoneySigned(gross, 0)}
          tone={gross >= 0 ? "up" : "down"}
          sub={`${trades.length} round-trips`}
        />
        <StatTile label="Charges" value={fmtMoney(charges, 0)} sub="Brokerage, STT, GST, stamp duty" />
        <StatTile
          label="Net P&L"
          value={fmtMoneySigned(gross - charges, 0)}
          tone={gross - charges >= 0 ? "up" : "down"}
        />
        <StatTile
          label="Win rate"
          value={`${Math.round((wins / trades.length) * 100)}%`}
          sub={`${wins}W · ${trades.length - wins}L`}
        />
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
            <Th align="right">Charges</Th>
            <Th align="right">Net P&L</Th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const dir = t.side === "BUY" ? 1 : -1;
            return (
              <Tr key={t.id}>
                <Td className="whitespace-nowrap">{t.day}</Td>
                <Td>
                  <div className="flex items-center gap-3">
                    <SymbolChip symbol={t.symbol} size={32} />
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold text-ink">{t.symbol}</p>
                      <p className="truncate text-[12px] text-ink3">{t.company}</p>
                    </div>
                  </div>
                </Td>
                <Td align="center">
                  <Pill tone={t.side === "BUY" ? "up" : "down"}>{t.side}</Pill>
                </Td>
                <Td align="right" className="tnum">{t.qty}</Td>
                <Td align="right" className="tnum">{fmtMoney(t.entry)}</Td>
                <Td align="right" className="tnum">{fmtMoney(t.exit)}</Td>
                <Td align="right" className="tnum text-ink3">{fmtMoney(t.charges)}</Td>
                <Td align="right" className={`tnum font-semibold ${toneText(netOf(t))}`}>
                  {fmtMoneySigned(netOf(t), 0)}
                  <span className="block text-[11.5px] font-normal">
                    {fmtPct(((t.exit - t.entry) / t.entry) * 100 * dir)}
                  </span>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableWrap>
    </>
  );
}
