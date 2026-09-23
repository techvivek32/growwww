import type { Metadata } from "next";
import { getOrders } from "@/lib/api/broker";
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
    return (
      <>
        <PageHead title="Orders" sub="Today's order book." />
        <NotConnected
          what="No orders today"
          detail="The order book is read straight from Groww. Connect your account and every placement, fill and rejection lands here."
        />
      </>
    );
  }

  const working = orders.filter((o) => o.status === "OPEN" || o.status === "TRIGGER PENDING");

  return (
    <>
      <PageHead
        title="Orders"
        sub="Today's order book. Every submission is read back from the broker and verified before it is shown as placed."
        right={
          <div className="flex items-center gap-2">
            <Pill tone="brand">{working.length} working</Pill>
            <Button variant="outline" size="sm">Cancel all</Button>
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
          <strong className="font-semibold text-ink">Order types Groww accepts:</strong> MARKET, LIMIT, SL and SL_M,
          across CNC, MIS and NRML. There are no bracket orders, so a stop and target pair is a GTT + OCO — filling
          one cancels the other.
        </p>
      </Card>
    </>
  );
}
