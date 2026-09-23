import type { Metadata } from "next";
import { getPositions, isConnected, canTrade } from "@/lib/api/broker";
import { fmtMoney, fmtMoneySigned, fmtPct, toneText } from "@/lib/format";
import { PageHead, StatTile, Pill, SymbolChip } from "@/components/ui";
import OrderTicket from "@/components/OrderTicket";
import Link from "next/link";
import { LivePrice } from "@/components/Live";
import { TableWrap, Th, Td, Tr } from "@/components/Table";
import NotConnected from "@/components/NotConnected";

export const metadata: Metadata = { title: "Positions · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

const PRODUCT_TONE = { MIS: "warn", CNC: "brand", NRML: "violet" } as const;

export default async function PositionsPage() {
  const positions = await getPositions();
  const tradable = canTrade();

  if (positions.length === 0) {
    return (
      <>
        <PageHead title="Positions" sub="Open intraday and F&O positions." />
        <NotConnected
          connected={isConnected()}
          what={isConnected() ? "No open positions" : "No positions to show"}
          detail={
            isConnected()
              ? "Your Groww account has nothing working right now. Open positions appear here with live P&L."
              : "Positions are read from your Groww account once credentials are configured on the server."
          }
        />
      </>
    );
  }

  // Rows without a live price cannot contribute to the totals — valuing a
  // position at its own cost would print a fake flat P&L.
  const priced = positions.filter(
    (p): p is (typeof positions)[number] & { ltp: number } => p.ltp !== null,
  );
  const pnl = priced.reduce(
    (s, p) => s + (p.ltp - p.avg) * p.qty * (p.side === "BUY" ? 1 : -1),
    0,
  );
  const exposure = priced.reduce((s, p) => s + p.ltp * p.qty, 0);
  const unpriced = positions.length - priced.length;

  return (
    <>
      <PageHead
        title="Positions"
        sub="Open intraday and F&O positions. MIS legs are auto-squared off by Groww before close."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Open P&L"
          value={priced.length ? fmtMoneySigned(pnl, 0) : "—"}
          tone={pnl >= 0 ? "up" : "down"}
          sub={`${positions.length} positions${unpriced ? ` · ${unpriced} awaiting a price` : ""}`}
        />
        <StatTile label="Exposure" value={priced.length ? fmtMoney(exposure, 0) : "—"} />
        <StatTile
          label="Realised today"
          value={fmtMoneySigned(positions.reduce((s, p) => s + p.realised, 0), 0)}
        />
        <StatTile label="Instruments" value={String(positions.length)} />
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
          {positions.map((p) => {
            const dir = p.side === "BUY" ? 1 : -1;
            const pl = p.ltp !== null ? (p.ltp - p.avg) * p.qty * dir : null;
            return (
              <Tr key={p.symbol}>
                <Td>
                  <Link
                    href={`/stock/${p.symbol.replace(/\s.*/, "")}`}
                    className="flex items-center gap-3 hover:opacity-80"
                  >
                    <SymbolChip symbol={p.symbol.replace(/\s.*/, "")} size={36} />
                    <span className="text-[13.5px] font-semibold text-ink">{p.symbol}</span>
                  </Link>
                </Td>
                <Td align="center"><Pill tone={PRODUCT_TONE[p.product]}>{p.product}</Pill></Td>
                <Td align="center"><Pill tone={p.side === "BUY" ? "up" : "down"}>{p.side}</Pill></Td>
                <Td align="right" className="tnum">{p.qty}</Td>
                <Td align="right" className="tnum">{fmtMoney(p.avg)}</Td>
                <Td align="right" className="font-medium text-ink">
                  {p.ltp === null ? (
                    "—"
                  ) : (
                    <LivePrice symbol={p.symbol.replace(/\s.*/, "")} initial={p.ltp} />
                  )}
                </Td>
                <Td
                  align="right"
                  className={`tnum font-semibold ${pl === null ? "text-ink3" : toneText(pl)}`}
                >
                  {pl === null ? (
                    "—"
                  ) : (
                    <>
                      {fmtMoneySigned(pl, 0)}
                      <span className="block text-[11.5px] font-normal">
                        {fmtPct(((p.ltp as number) / p.avg - 1) * 100 * dir)}
                      </span>
                    </>
                  )}
                </Td>
                <Td align="right">
                  <OrderTicket
                    symbol={p.symbol.replace(/\s.*/, "")}
                    ltp={p.ltp}
                    side="SELL"
                    suggestedPrice={p.ltp}
                    trigger={{ label: "Exit", variant: "outline" }}
                    disabledReason={tradable ? undefined : "Order placement is disabled on this server"}
                  />
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableWrap>
    </>
  );
}
