import type { Metadata } from "next";
import { getOrders } from "@/lib/api/broker";
import { isOwnerSession } from "@/lib/access";
import { fmtMoney } from "@/lib/format";
import { PageHead, Pill, Button } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";
import AccountEmpty from "../AccountEmpty";

export const metadata: Metadata = { title: "Orders · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  COMPLETE: "up", OPEN: "brand", "TRIGGER PENDING": "warn",
  REJECTED: "down", CANCELLED: "neutral",
} as const;
const PRODUCT_TONE = { MIS: "warn", CNC: "brand", NRML: "violet" } as const;

export default async function OrdersPage() {
  const [orders, isOwner] = await Promise.all([getOrders(), isOwnerSession()]);

  if (orders.length === 0) {
    return (
      <>
        <PageHead title="Orders" sub="Today's order book, read from Groww." />
        <AccountEmpty
          noun="orders"
          empty={{
            what: "No orders today",
            detail: "Today's order book is empty. Orders appear here with their status and fill as Groww reports them.",
          }}
        />
      </>
    );
  }

  const working = orders.filter((o) => o.status === "OPEN" || o.status === "TRIGGER PENDING");

  return (
    <>
      <PageHead
        title="Orders"
        sub="Today's order book, read from Groww."
        right={
          <div className="flex items-center gap-2">
            <Pill tone={working.length ? "brand" : "neutral"}>{working.length} working</Pill>
            {isOwner && (
              <Button variant="outline" size="sm" disabled title="Order placement is not enabled — manage orders in Groww">
                Cancel all
              </Button>
            )}
          </div>
        }
      />

      <TableWrap>
        <thead>
          <tr>
            <Th>Time</Th><Th>Instrument</Th><Th align="center">Side</Th><Th align="center">Type</Th>
            <Th align="center">Product</Th><Th align="right">Filled / qty</Th><Th align="right">Price</Th>
            <Th align="right">Avg fill</Th><Th align="center">Status</Th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <Tr key={o.id}>
              <Td className="tnum whitespace-nowrap">
                {o.time}<span className="block font-mono text-[10.5px] text-ink3">{o.id}</span>
              </Td>
              <Td>
                <span className="text-[13.5px] font-semibold text-ink">{o.symbol}</span>
                {o.note && <span className="block text-[11.5px] text-ink3">{o.note}</span>}
              </Td>
              <Td align="center"><Pill tone={o.side === "BUY" ? "up" : "down"}>{o.side}</Pill></Td>
              <Td align="center" className="font-mono text-[11.5px] tracking-[0.04em] text-ink2">{o.type}</Td>
              <Td align="center"><Pill tone={PRODUCT_TONE[o.product]}>{o.product}</Pill></Td>
              <Td align="right" className="tnum">{o.filled}/{o.qty}</Td>
              <Td align="right" className="tnum">{o.price === null ? "—" : fmtMoney(o.price)}</Td>
              <Td align="right" className="tnum font-medium text-ink">{o.avg === null ? "—" : fmtMoney(o.avg)}</Td>
              <Td align="center"><Pill tone={STATUS_TONE[o.status]}>{o.status}</Pill></Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>

      {isOwner && (
        <p className="mt-5 max-w-2xl border-l-2 border-line2 pl-3.5 text-[13px] leading-relaxed text-ink2">
          <strong className="font-semibold text-ink">Order types Groww accepts:</strong> MARKET, LIMIT, SL and
          SL_M, across CNC, MIS and NRML. There are no bracket or cover orders.
        </p>
      )}
    </>
  );
}
