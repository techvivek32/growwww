import type { Metadata } from "next";
import { getHoldings } from "@/lib/api/broker";
import { fmtMoney, fmtMoneySigned, fmtPct, toneText } from "@/lib/format";
import { PageHead, StatTile, SymbolChip, Button } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";
import NotConnected from "@/components/NotConnected";

export const metadata: Metadata = { title: "Holdings · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const holdings = await getHoldings();

  if (holdings.length === 0) {
    return (
      <>
        <PageHead title="Holdings" sub="Delivery positions in your Groww demat account." />
        <NotConnected
          what="No holdings to show"
          detail="Holdings are read from your Groww account. Connect it and everything you own appears here, priced live."
        />
      </>
    );
  }

  const invested = holdings.reduce((s, h) => s + h.avg * h.qty, 0);
  const current = holdings.reduce((s, h) => s + h.ltp * h.qty, 0);
  const pnl = current - invested;
  const dayPnl = holdings.reduce((s, h) => s + h.ltp * h.qty * (h.dayPct / 100), 0);

  return (
    <>
      <PageHead title="Holdings" sub="Delivery positions in your Groww demat account." />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Invested" value={fmtMoney(invested, 0)} sub={`${holdings.length} stocks`} />
        <StatTile label="Current value" value={fmtMoney(current, 0)} />
        <StatTile label="Total P&L" value={fmtMoneySigned(pnl, 0)} sub={fmtPct((pnl / invested) * 100)} tone={pnl >= 0 ? "up" : "down"} />
        <StatTile label="Day's P&L" value={fmtMoneySigned(dayPnl, 0)} tone={dayPnl >= 0 ? "up" : "down"} />
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>Stock</Th><Th align="right">Qty</Th><Th align="right">Avg cost</Th>
            <Th align="right">LTP</Th><Th align="right">Value</Th>
            <Th align="right">P&L</Th><Th align="right">Day</Th><Th align="right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const value = h.ltp * h.qty;
            const p = value - h.avg * h.qty;
            return (
              <Tr key={h.symbol}>
                <Td>
                  <div className="flex items-center gap-3">
                    <SymbolChip symbol={h.symbol} size={36} />
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold text-ink">{h.symbol}</p>
                      <p className="truncate text-[12px] text-ink3">{h.company}</p>
                    </div>
                  </div>
                </Td>
                <Td align="right" className="tnum">{h.qty}</Td>
                <Td align="right" className="tnum">{fmtMoney(h.avg)}</Td>
                <Td align="right" className="tnum font-medium text-ink">{fmtMoney(h.ltp)}</Td>
                <Td align="right" className="tnum font-medium text-ink">{fmtMoney(value, 0)}</Td>
                <Td align="right" className={`tnum font-semibold ${toneText(p)}`}>
                  {fmtMoneySigned(p, 0)}
                  <span className="block text-[11.5px] font-normal">{fmtPct((p / (h.avg * h.qty)) * 100)}</span>
                </Td>
                <Td align="right" className={`tnum ${toneText(h.dayPct)}`}>{fmtPct(h.dayPct)}</Td>
                <Td align="right"><Button size="sm" variant="outline">Exit</Button></Td>
              </Tr>
            );
          })}
        </tbody>
      </TableWrap>
    </>
  );
}
