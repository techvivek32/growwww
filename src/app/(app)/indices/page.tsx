import type { Metadata } from "next";
import Link from "next/link";
import { getIndices } from "@/lib/api/yahoo";
import { fmtNum } from "@/lib/format";
import { PageHead, SymbolChip, Pill } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";
import { LivePrice, LiveChange } from "@/components/Live";

export const metadata: Metadata = { title: "Indices · MNHA Financials" };

// Live levels — never bake this at build time.
export const dynamic = "force-dynamic";

/**
 * The benchmarks this terminal actually prices — the five wired into the
 * live feed. A longer list would be rows nothing here can keep honest, so
 * it stays at what is real; more join as the feed map grows.
 */
export default async function IndicesPage() {
  const indices = await getIndices();

  return (
    <>
      <PageHead
        title="Indices"
        sub="NSE and BSE benchmarks, priced live. Open one for its chart, and the option chain where it trades derivatives."
      />

      <TableWrap>
        <thead>
          <tr>
            <Th>Index</Th>
            <Th align="right">Level</Th>
            <Th align="right">Change</Th>
            <Th align="right">High</Th>
            <Th align="right">Low</Th>
            <Th align="right">Prev close</Th>
          </tr>
        </thead>
        <tbody>
          {indices.map((ix) => (
            <Tr key={ix.symbol}>
              <Td>
                <Link href={`/stock/${ix.symbol}`} className="flex items-center gap-3 hover:opacity-80">
                  <SymbolChip symbol={ix.symbol} size={32} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                      {ix.symbol}
                      {ix.stale && <Pill tone="warn">Snap {ix.asOf}</Pill>}
                    </p>
                    <p className="truncate text-[11.5px] text-ink3">{ix.name}</p>
                  </div>
                </Link>
              </Td>
              <Td align="right" className="font-semibold text-ink">
                {ix.stale ? (
                  <span className="tnum">{fmtNum(ix.last, 2)}</span>
                ) : (
                  <LivePrice symbol={ix.symbol} initial={ix.last} plain />
                )}
              </Td>
              <Td align="right">
                {ix.stale ? (
                  <span className="tnum text-ink3">—</span>
                ) : (
                  <LiveChange symbol={ix.symbol} initialChange={ix.change} initialPct={ix.changePct} />
                )}
              </Td>
              <Td align="right" className="tnum text-ink2">
                {ix.dayHigh === null ? "—" : fmtNum(ix.dayHigh, 2)}
              </Td>
              <Td align="right" className="tnum text-ink2">
                {ix.dayLow === null ? "—" : fmtNum(ix.dayLow, 2)}
              </Td>
              <Td align="right" className="tnum text-ink2">{fmtNum(ix.prevClose, 2)}</Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    </>
  );
}
