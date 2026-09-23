import type { Metadata } from "next";
import { getFills, isConnected } from "@/lib/api/broker";
import { fmtMoney } from "@/lib/format";
import { PageHead, StatTile, Pill, SymbolChip } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";
import NotConnected from "@/components/NotConnected";

export const metadata: Metadata = { title: "History · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

const PRODUCT_TONE = { MIS: "warn", CNC: "brand", NRML: "violet" } as const;

export default async function HistoryPage() {
  const fills = await getFills();

  if (fills.length === 0) {
    return (
      <>
        <PageHead title="Fills" sub="Executed orders, read straight from your Groww account." />
        <NotConnected
          connected={isConnected()}
          what={isConnected() ? "No fills on this account yet" : "No fills to show"}
          detail={
            isConnected()
              ? "Every executed order lands here with its real fill price and time. This account has none yet."
              : "Fills are read from your Groww account once credentials are configured on the server."
          }
        />
      </>
    );
  }

  const buys = fills.filter((f) => f.side === "BUY").length;

  return (
    <>
      <PageHead
        title="Fills"
        sub="Executed orders with their real fill price and time. Groww's API does not report per-order charges, so none are shown."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatTile label="Fills" value={String(fills.length)} />
        <StatTile label="Buys" value={String(buys)} />
        <StatTile label="Sells" value={String(fills.length - buys)} />
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Time</Th>
            <Th>Instrument</Th>
            <Th align="center">Side</Th>
            <Th align="center">Product</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Avg fill</Th>
          </tr>
        </thead>
        <tbody>
          {fills.map((f) => (
            <Tr key={f.id}>
              <Td className="whitespace-nowrap">{f.date ?? "—"}</Td>
              <Td className="tnum whitespace-nowrap">
                {f.time}
                <span className="block text-[11px] text-ink3">{f.id}</span>
              </Td>
              <Td>
                <div className="flex items-center gap-3">
                  <SymbolChip symbol={f.symbol} size={32} />
                  <span className="text-[13.5px] font-semibold text-ink">{f.symbol}</span>
                </div>
              </Td>
              <Td align="center">
                <Pill tone={f.side === "BUY" ? "up" : "down"}>{f.side}</Pill>
              </Td>
              <Td align="center">
                <Pill tone={PRODUCT_TONE[f.product]}>{f.product}</Pill>
              </Td>
              <Td align="right" className="tnum">{f.filled}</Td>
              <Td align="right" className="tnum font-medium text-ink">
                {f.avg === null ? "—" : fmtMoney(f.avg)}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    </>
  );
}
