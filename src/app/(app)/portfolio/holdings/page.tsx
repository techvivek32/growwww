import type { Metadata } from "next";
import { getHoldings, isConnected, canTrade } from "@/lib/api/broker";
import { fmtMoney, fmtMoneySigned, fmtPct, toneText } from "@/lib/format";
import { PageHead, StatTile, SymbolChip } from "@/components/ui";
import OrderTicket from "@/components/OrderTicket";
import { LivePrice } from "@/components/Live";
import { TableWrap, Th, Td, Tr } from "@/components/Table";
import NotConnected from "@/components/NotConnected";

export const metadata: Metadata = { title: "Holdings · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const holdings = await getHoldings();
  const tradable = canTrade();

  if (holdings.length === 0) {
    return (
      <>
        <PageHead title="Holdings" sub="Delivery positions in your Groww demat account." />
        <NotConnected
          connected={isConnected()}
          what={isConnected() ? "No holdings in this account" : "No holdings to show"}
          detail={
            isConnected()
              ? "Your Groww demat account holds no delivery positions right now. Anything you buy appears here, priced live."
              : "Holdings are read from your Groww account once credentials are configured on the server."
          }
        />
      </>
    );
  }

  // Rows without a live price are excluded from every total — valuing a
  // holding at its own cost would print a fake ₹0 P&L.
  const priced = holdings.filter(
    (h): h is (typeof holdings)[number] & { ltp: number } => h.ltp !== null,
  );
  const invested = priced.reduce((s, h) => s + h.avg * h.qty, 0);
  const current = priced.reduce((s, h) => s + h.ltp * h.qty, 0);
  const pnl = current - invested;
  const unpriced = holdings.length - priced.length;

  return (
    <>
      <PageHead
        title="Holdings"
        sub="Delivery positions in your Groww demat account, priced from the live feed."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Invested"
          value={fmtMoney(invested, 0)}
          sub={`${holdings.length} stocks${unpriced ? ` · ${unpriced} awaiting a price` : ""}`}
        />
        <StatTile label="Current value" value={priced.length ? fmtMoney(current, 0) : "—"} />
        <StatTile
          label="Total P&L"
          value={priced.length && invested > 0 ? fmtMoneySigned(pnl, 0) : "—"}
          sub={priced.length && invested > 0 ? fmtPct((pnl / invested) * 100) : undefined}
          tone={pnl >= 0 ? "up" : "down"}
        />
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>Stock</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Avg cost</Th>
            <Th align="right">LTP</Th>
            <Th align="right">Value</Th>
            <Th align="right">P&L</Th>
            <Th align="right">Day</Th>
            <Th align="right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const value = h.ltp !== null ? h.ltp * h.qty : null;
            const p = value !== null ? value - h.avg * h.qty : null;
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
                <Td align="right" className="font-medium text-ink">
                  {h.ltp === null ? (
                    "—"
                  ) : (
                    <LivePrice symbol={h.symbol.replace(/\s.*/, "")} initial={h.ltp} />
                  )}
                </Td>
                <Td align="right" className="tnum font-medium text-ink">
                  {value === null ? "—" : fmtMoney(value, 0)}
                </Td>
                <Td
                  align="right"
                  className={`tnum font-semibold ${p === null ? "text-ink3" : toneText(p)}`}
                >
                  {p === null ? (
                    "—"
                  ) : (
                    <>
                      {fmtMoneySigned(p, 0)}
                      <span className="block text-[11.5px] font-normal">
                        {fmtPct((p / (h.avg * h.qty)) * 100)}
                      </span>
                    </>
                  )}
                </Td>
                <Td align="right" className={`tnum ${h.dayPct === null ? "text-ink3" : toneText(h.dayPct)}`}>
                  {h.dayPct === null ? "—" : fmtPct(h.dayPct)}
                </Td>
                <Td align="right">
                  <OrderTicket
                    symbol={h.symbol.replace(/\s.*/, "")}
                    ltp={h.ltp}
                    side="SELL"
                    suggestedPrice={h.ltp}
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
