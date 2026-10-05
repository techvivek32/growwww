import type { Metadata } from "next";
import { getHoldings, canTrade } from "@/lib/api/broker";
import { isOwnerSession } from "@/lib/access";
import { fmtMoney, fmtMoneySigned, fmtPct, toneText } from "@/lib/format";
import { PageHead, StatTile, SymbolChip } from "@/components/ui";
import OrderTicket from "@/components/OrderTicket";
import Link from "next/link";
import { LivePrice } from "@/components/Live";
import { TableWrap, Th, Td, Tr } from "@/components/Table";
import AccountEmpty from "../AccountEmpty";
import PriceGapNote from "../PriceGapNote";

export const metadata: Metadata = { title: "Holdings · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const [holdings, isOwner] = await Promise.all([getHoldings(), isOwnerSession()]);
  const tradable = canTrade();

  if (holdings.length === 0) {
    return (
      <>
        <PageHead title="Holdings" sub="Delivery positions in your Groww demat account." />
        <AccountEmpty
          noun="holdings"
          empty={{
            what: "No holdings in this account",
            detail:
              "Your Groww demat account holds no delivery positions right now. Any that land in it appear here, priced live.",
          }}
        />
      </>
    );
  }

  // Invested (qty × average cost) comes straight from Groww, so it is always
  // known. Current value and P&L need a live price for EVERY row — a partial
  // total, or a holding valued at its own cost, would print a fake figure.
  const priced = holdings.filter(
    (h): h is (typeof holdings)[number] & { ltp: number } => h.ltp !== null,
  );
  const invested = holdings.reduce((s, h) => s + h.avg * h.qty, 0);
  const unpriced = holdings.length - priced.length;
  const allPriced = unpriced === 0;
  const current = priced.reduce((s, h) => s + h.ltp * h.qty, 0);
  const pnl = current - invested;
  const hasPnl = allPriced && invested > 0;

  return (
    <>
      <PageHead
        title="Holdings"
        sub="Delivery positions in your Groww demat account, priced from the live feed."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Invested"
          value={fmtMoney(invested, 0)}
          sub={`${holdings.length} stocks`}
        />
        <StatTile
          label="Current value"
          value={allPriced ? fmtMoney(current, 0) : "—"}
          sub={allPriced ? undefined : `${unpriced} of ${holdings.length} awaiting a price`}
        />
        <StatTile
          label="Total P&L"
          value={hasPnl ? fmtMoneySigned(pnl, 0) : "—"}
          sub={hasPnl ? fmtPct((pnl / invested) * 100) : undefined}
          tone={hasPnl ? (pnl >= 0 ? "up" : "down") : undefined}
        />
      </div>

      <PriceGapNote unpriced={unpriced} total={holdings.length} />

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
            {isOwner && <Th align="right">Action</Th>}
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const value = h.ltp !== null ? h.ltp * h.qty : null;
            const p = value !== null ? value - h.avg * h.qty : null;
            return (
              <Tr key={h.symbol}>
                <Td>
                  <Link href={`/stock/${h.symbol}`} className="group flex items-center gap-3">
                    <SymbolChip symbol={h.symbol} size={34} />
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold text-ink group-hover:text-brandtext">{h.symbol}</p>
                      <p className="truncate text-[12px] text-ink3">{h.company}</p>
                    </div>
                  </Link>
                </Td>
                <Td align="right" className="tnum">{h.qty}</Td>
                <Td align="right" className="tnum">{fmtMoney(h.avg)}</Td>
                <Td align="right" className="tnum font-medium text-ink">
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
                {isOwner && (
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
                )}
              </Tr>
            );
          })}
        </tbody>
      </TableWrap>
    </>
  );
}
