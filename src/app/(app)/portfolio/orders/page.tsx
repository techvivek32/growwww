import type { Metadata } from "next";
import { getOrders, isConnected } from "@/lib/api/broker";
import { fmtMoney } from "@/lib/format";
import { PageHead, Pill, Button, Card } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";
import NotConnected from "@/components/NotConnected";

export const metadata: Metadata = { title: "Orders · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  COMPLETE: "up", OPEN: "brand", "TRIGGER PENDING": "warn",
  REJECTED: "down", CANCELLED: "neutral",
} as const;
const PRODUCT_TONE = { MIS: "warn", CNC: "brand", NRML: "violet" } as const;

export default async function OrdersPage() {
  const orders = await getOrders();

  if (orders.length === 0) {
    if (!isConnected()) {
      return (
        <>
          <PageHead title="Orders" sub="Today's order book." />
          <NotConnected
            connected={false}
            what="No orders to show"
            detail="The order book is read from your Groww account once credentials are configured on the server."
          />
        </>
      );
    }
    // Groww's empty state: the little rocket and nothing else in the way.
    return (
      <div className="flex min-h-[52vh] items-center justify-center">
        <div className="flex items-center gap-8">
          <svg width="130" height="130" viewBox="0 0 120 120" fill="none" aria-hidden="true">
            <path d="M20 100 60 60" stroke="var(--c-border-strong)" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 7" />
            <path d="M30 96l16-6 10 10-6 16c-1.5 3-5.5 2.5-7-1l-4-8-8-4c-3.5-1.5-4-5.5-1-7Z" fill="var(--c-brand-soft)" />
            <path d="M62 22c10-10 28-12 34-6s4 24-6 34L64 76 44 56Z" fill="var(--c-violet-soft)" stroke="var(--c-violet)" strokeWidth="2" />
            <circle cx="74" cy="42" r="7" fill="var(--c-surface)" stroke="var(--c-violet)" strokeWidth="2" />
            <path d="M46 58 32 62l8-14M62 74l-4 14 14-8" stroke="var(--c-brand)" strokeWidth="2" strokeLinejoin="round" fill="var(--c-brand-soft)" />
          </svg>
          <div>
            <p className="text-[26px] leading-snug font-semibold tracking-[-0.02em] text-ink">
              You have
              <br />
              no orders
            </p>
          </div>
        </div>
      </div>
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
            <Pill tone="brand">{working.length} working</Pill>
            <Button variant="outline" size="sm" disabled title="Order placement is not enabled — manage orders in Groww">Cancel all</Button>
          </div>
        }
      />

      <TableWrap>
        <thead>
          <tr>
            <Th>Time</Th><Th>Instrument</Th><Th align="center">Side</Th><Th align="center">Type</Th>
            <Th align="center">Product</Th><Th align="right">Qty</Th><Th align="right">Price</Th>
            <Th align="right">Avg fill</Th><Th align="center">Status</Th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <Tr key={o.id}>
              <Td className="tnum whitespace-nowrap">
                {o.time}<span className="block text-[11px] text-ink3">{o.id}</span>
              </Td>
              <Td>
                <span className="text-[13.5px] font-semibold text-ink">{o.symbol}</span>
                {o.note && <span className="block text-[11.5px] text-ink3">{o.note}</span>}
              </Td>
              <Td align="center"><Pill tone={o.side === "BUY" ? "up" : "down"}>{o.side}</Pill></Td>
              <Td align="center" className="text-[12.5px] font-medium text-ink2">{o.type}</Td>
              <Td align="center"><Pill tone={PRODUCT_TONE[o.product]}>{o.product}</Pill></Td>
              <Td align="right" className="tnum">{o.filled}/{o.qty}</Td>
              <Td align="right" className="tnum">{o.price === null ? "—" : fmtMoney(o.price)}</Td>
              <Td align="right" className="tnum font-medium text-ink">{o.avg === null ? "—" : fmtMoney(o.avg)}</Td>
              <Td align="center"><Pill tone={STATUS_TONE[o.status]}>{o.status}</Pill></Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>

      <Card className="mt-4">
        <p className="text-[13.5px] leading-relaxed text-ink2">
          <strong className="font-semibold text-ink">Order types Groww accepts:</strong> MARKET, LIMIT, SL and
          SL_M, across CNC, MIS and NRML. There are no bracket or cover orders.
        </p>
      </Card>
    </>
  );
}
