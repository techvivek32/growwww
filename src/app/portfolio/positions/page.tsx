import type { Metadata } from "next";
import { POSITIONS, ACCOUNT } from "@/lib/mock";
import { fmtMoney, fmtMoneySigned, fmtPct, toneText } from "@/lib/format";
import { PageHead, StatTile, Pill, Button, SymbolChip } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";

export const metadata: Metadata = { title: "Positions · NOVA India" };

const PRODUCT_TONE = { MIS: "warn", CNC: "brand", NRML: "violet" } as const;

export default function PositionsPage() {
  const pnl = POSITIONS.reduce((s, p) => s + (p.ltp - p.avg) * p.qty * (p.side === "BUY" ? 1 : -1), 0);
  const exposure = POSITIONS.reduce((s, p) => s + p.ltp * p.qty, 0);

  return (
    <>
      <PageHead
        title="Positions"
        sub="Open intraday and F&O positions. MIS legs are auto-squared off by Groww before close."
        right={<Button variant="danger" size="sm">Square off all</Button>}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open P&L" value={fmtMoneySigned(pnl, 0)} tone={pnl >= 0 ? "up" : "down"} sub={`${POSITIONS.length} positions`} />
        <StatTile label="Exposure" value={fmtMoney(exposure, 0)} />
        <StatTile label="Margin used" value={fmtMoney(ACCOUNT.usedMargin, 0)} />
        <StatTile label="Available" value={fmtMoney(ACCOUNT.balance - ACCOUNT.usedMargin, 0)} />
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>Instrument</Th>
            <Th align="center">Product</Th>
            <Th align="center">Side</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Avg</Th>
            <Th align="right">LTP</Th>
            <Th align="right">P&L</Th>
            <Th align="right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {POSITIONS.map((p) => {
            const dir = p.side === "BUY" ? 1 : -1;
            const pl = (p.ltp - p.avg) * p.qty * dir;
            const plPct = ((p.ltp - p.avg) / p.avg) * 100 * dir;
            return (
              <Tr key={p.symbol}>
                <Td>
                  <div className="flex items-center gap-3">
                    <SymbolChip symbol={p.symbol.replace(/\s.*/, "")} size={32} />
                    <span className="text-[13px] font-semibold text-ink">{p.symbol}</span>
                  </div>
                </Td>
                <Td align="center">
                  <Pill tone={PRODUCT_TONE[p.product]}>{p.product}</Pill>
                </Td>
                <Td align="center">
                  <Pill tone={p.side === "BUY" ? "up" : "down"}>{p.side}</Pill>
                </Td>
                <Td align="right" className="tnum">{p.qty}</Td>
                <Td align="right" className="tnum">{fmtMoney(p.avg)}</Td>
                <Td align="right" className="tnum font-medium text-ink">{fmtMoney(p.ltp)}</Td>
                <Td align="right" className={`tnum font-semibold ${toneText(pl)}`}>
                  {fmtMoneySigned(pl, 0)}
                  <span className="block text-[11px] font-normal">{fmtPct(plPct)}</span>
                </Td>
                <Td align="right">
                  <Button size="sm" variant="outline">Exit</Button>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableWrap>
    </>
  );
}
