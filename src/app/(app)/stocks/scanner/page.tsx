import type { Metadata } from "next";
import { getUniverse } from "@/lib/api/yahoo";
import { buildScanRows } from "@/lib/alerts";
import { fmtMoney, fmtPct, toneText } from "@/lib/format";
import { PageHead, Pill, SymbolChip, Button, Chip, Sparkline } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";

export const metadata: Metadata = { title: "Scanner · MNHA Financials" };
export const revalidate = 300;

const FILTERS = ["All setups", "Breakout", "Volume spike", "Trend pullback", "Base", "Below trend"];

const SETUP_TONE: Record<string, "up" | "warn" | "brand" | "down" | "neutral"> = {
  Breakout: "up",
  "Volume spike": "warn",
  "Trend pullback": "brand",
  "Below trend": "down",
  Base: "neutral",
  Watching: "neutral",
};

export default async function ScannerPage() {
  const universe = await getUniverse();
  const rows = buildScanRows(universe);

  return (
    <>
      <PageHead
        title="Scanner"
        sub="The full NSE universe the alert engine watches, ranked by today's move."
        right={<Button variant="outline" size="sm">Export CSV</Button>}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        {FILTERS.map((f, i) => (
          <Chip key={f} active={i === 0}>
            {f}
          </Chip>
        ))}
        <span className="ml-auto text-[13px] text-ink3">{rows.length} stocks</span>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>Stock</Th>
            <Th align="center">Trend</Th>
            <Th>Setup</Th>
            <Th align="right">LTP</Th>
            <Th align="right">Change</Th>
            <Th align="right">Vol</Th>
            <Th align="right">RSI</Th>
            <Th align="right">Score</Th>
            <Th align="right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
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
              <Td align="center">
                <div className="flex justify-center">
                  <Sparkline points={r.spark} up={r.change >= 0} baseline={r.last - r.change} w={72} h={22} />
                </div>
              </Td>
              <Td>
                <Pill tone={SETUP_TONE[r.setup] ?? "neutral"}>{r.setup}</Pill>
              </Td>
              <Td align="right" className="tnum font-medium text-ink">
                {fmtMoney(r.last)}
              </Td>
              <Td align="right" className={`tnum font-medium ${toneText(r.changePct)}`}>
                {fmtPct(r.changePct)}
              </Td>
              <Td align="right" className="tnum">
                {r.volX === null ? "—" : `${r.volX.toFixed(1)}x`}
              </Td>
              <Td align="right" className="tnum">{r.rsi}</Td>
              <Td align="right" className="tnum font-semibold text-ink">
                {r.score || "—"}
              </Td>
              <Td align="right">
                <Button size="sm" variant={r.changePct >= 0 ? "primary" : "outline"}>
                  {r.changePct >= 0 ? "Buy" : "View"}
                </Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    </>
  );
}
