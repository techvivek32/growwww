import type { Metadata } from "next";
import { SCAN_ROWS } from "@/lib/mock";
import { fmtMoney, fmtPct, toneText } from "@/lib/format";
import { PageHead, Pill, SymbolChip, Button, Card } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";

export const metadata: Metadata = { title: "Scanner · NOVA India" };

const FILTERS = ["All setups", "Breakout", "Trend pullback", "VWAP reclaim", "Momentum", "Base"];

export default function ScannerPage() {
  return (
    <>
      <PageHead
        title="Scanner"
        sub="The full NSE universe the alert engine watches, ranked by setup quality."
        right={<Button variant="outline" size="sm">Export CSV</Button>}
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f, i) => (
            <button
              key={f}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                i === 0
                  ? "bg-brand text-white"
                  : "border border-line text-ink2 hover:bg-surfaceh hover:text-ink"
              }`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto text-[12px] text-ink3">{SCAN_ROWS.length} matches</span>
        </div>
      </Card>

      <TableWrap>
        <thead>
          <tr>
            <Th>Stock</Th>
            <Th>Setup</Th>
            <Th>Sector</Th>
            <Th align="right">LTP</Th>
            <Th align="right">Change</Th>
            <Th align="right">Vol</Th>
            <Th align="right">RSI</Th>
            <Th align="right">ADX</Th>
            <Th align="right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {SCAN_ROWS.map((r) => (
            <Tr key={r.symbol}>
              <Td>
                <div className="flex items-center gap-3">
                  <SymbolChip symbol={r.symbol} size={32} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">{r.symbol}</p>
                    <p className="truncate text-[11px] text-ink3">{r.company}</p>
                  </div>
                </div>
              </Td>
              <Td>
                <Pill tone={r.setup === "Breakout" ? "up" : r.setup === "Momentum" ? "warn" : "neutral"}>
                  {r.setup}
                </Pill>
              </Td>
              <Td>{r.sector}</Td>
              <Td align="right" className="tnum font-medium text-ink">
                {fmtMoney(r.last)}
              </Td>
              <Td align="right" className={`tnum font-medium ${toneText(r.changePct)}`}>
                {fmtPct(r.changePct)}
              </Td>
              <Td align="right" className="tnum">
                {r.volX.toFixed(1)}x
              </Td>
              <Td align="right" className="tnum">
                {r.rsi}
              </Td>
              <Td align="right" className="tnum">
                {r.adx}
              </Td>
              <Td align="right">
                <Button size="sm">Buy</Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    </>
  );
}
