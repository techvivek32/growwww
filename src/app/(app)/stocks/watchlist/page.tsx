import type { Metadata } from "next";
import { getQuotes } from "@/lib/api/yahoo";
import { fmtMoney, fmtPct, toneText } from "@/lib/format";
import { PageHead, SymbolChip, Sparkline, Button } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";

export const metadata: Metadata = { title: "Watchlist · MNHA Financials" };
export const revalidate = 300;

/** The names carried through the current trading window, plus the large caps. */
const WATCHED = [
  "RELIANCE", "HDFCBANK", "INFY", "TCS", "ITC",
  "TMPV", "SBIN", "LT", "COALINDIA", "TATAPOWER",
];

export default async function WatchlistPage() {
  const rows = await getQuotes(WATCHED);

  return (
    <>
      <PageHead
        title="Watchlist"
        sub="Stocks you are tracking. Alerts fire on these first."
        right={<Button size="sm">Add symbol</Button>}
      />

      <TableWrap>
        <thead>
          <tr>
            <Th>Stock</Th>
            <Th align="center">30-day trend</Th>
            <Th align="right">LTP</Th>
            <Th align="right">Change</Th>
            <Th align="right">Change %</Th>
            <Th align="right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <Tr key={w.symbol}>
              <Td>
                <div className="flex items-center gap-3">
                  <SymbolChip symbol={w.symbol} size={32} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">{w.symbol}</p>
                    <p className="truncate text-[11px] text-ink3">{w.name}</p>
                  </div>
                </div>
              </Td>
              <Td align="center">
                <div className="flex justify-center">
                  <Sparkline points={w.spark} up={w.change >= 0} baseline={w.prevClose} w={84} h={24} />
                </div>
              </Td>
              <Td align="right" className="tnum font-medium text-ink">{fmtMoney(w.last)}</Td>
              <Td align="right" className={`tnum ${toneText(w.change)}`}>
                {w.change >= 0 ? "+" : ""}
                {w.change.toFixed(2)}
              </Td>
              <Td align="right" className={`tnum font-medium ${toneText(w.changePct)}`}>
                {fmtPct(w.changePct)}
              </Td>
              <Td align="right">
                <Button size="sm" variant="outline">Trade</Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    </>
  );
}
