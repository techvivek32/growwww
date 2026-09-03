import type { Metadata } from "next";
import {
  POSITIONS, TODAY, TODAY_NET, TODAY_GROSS, TODAY_CHARGES, TODAY_TURNOVER, ACCOUNT,
} from "@/lib/book";
import { fmtMoney, fmtMoneySigned, fmtPct, toneText } from "@/lib/format";
import { PageHead, StatTile, Pill, SymbolChip, Card } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";

export const metadata: Metadata = { title: "Positions · MNHA Financials" };

const PRODUCT_TONE = { MIS: "warn", CNC: "brand", NRML: "violet" } as const;

export default function PositionsPage() {
  const wins = POSITIONS.filter((p) => p.realised > 0).length;

  return (
    <>
      <PageHead
        title="Positions"
        sub={`${TODAY.label} — intraday MIS, squared off before the close. Net quantity is zero, so no margin is blocked overnight.`}
        right={<Pill tone="neutral">Session closed</Pill>}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Realised today"
          value={fmtMoneySigned(TODAY_NET, 2)}
          sub={`${wins}W · ${POSITIONS.length - wins}L across ${POSITIONS.length} positions`}
          tone={TODAY_NET >= 0 ? "up" : "down"}
        />
        <StatTile label="Gross today" value={fmtMoneySigned(TODAY_GROSS, 0)} tone={TODAY_GROSS >= 0 ? "up" : "down"} />
        <StatTile label="Charges today" value={fmtMoney(TODAY_CHARGES)} sub="Brokerage, STT, GST, stamp duty" />
        <StatTile label="Turnover" value={fmtMoney(TODAY_TURNOVER, 0)} sub="Buy + sell value" />
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>Instrument</Th>
            <Th align="center">Product</Th>
            <Th align="center">Side</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Avg entry</Th>
            <Th align="right">Exit</Th>
            <Th align="right">Net qty</Th>
            <Th align="right">Realised P&L</Th>
          </tr>
        </thead>
        <tbody>
          {POSITIONS.map((p) => (
            <Tr key={p.symbol}>
              <Td>
                <div className="flex items-center gap-3">
                  <SymbolChip symbol={p.symbol} size={32} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">{p.symbol}</p>
                    <p className="truncate text-[11px] text-ink3">{p.company}</p>
                  </div>
                </div>
              </Td>
              <Td align="center"><Pill tone={PRODUCT_TONE[p.product]}>{p.product}</Pill></Td>
              <Td align="center"><Pill tone={p.side === "BUY" ? "up" : "down"}>{p.side}</Pill></Td>
              <Td align="right" className="tnum">{p.qty}</Td>
              <Td align="right" className="tnum">{fmtMoney(p.entry)}</Td>
              <Td align="right" className="tnum font-medium text-ink">{fmtMoney(p.exit)}</Td>
              <Td align="right" className="tnum text-ink3">0</Td>
              <Td align="right" className={`tnum font-semibold ${toneText(p.realised)}`}>
                {fmtMoneySigned(p.realised, 2)}
                <span className="block text-[11px] font-normal">{fmtPct(p.pct)}</span>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>

      <Card className="mt-4">
        <p className="text-[13px] leading-relaxed text-ink2">
          MIS positions are auto-squared-off by Groww ahead of the close, so nothing carries into tomorrow and the
          full <strong className="font-semibold text-ink">{fmtMoney(ACCOUNT.balance)}</strong> is available again at
          the next open.
        </p>
      </Card>
    </>
  );
}
