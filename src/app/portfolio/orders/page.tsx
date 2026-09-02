import type { Metadata } from "next";
import { ORDERS } from "@/lib/mock";
import { fmtMoney } from "@/lib/format";
import { PageHead, Pill, Button, Card } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";

export const metadata: Metadata = { title: "Orders · NOVA India" };

const STATUS_TONE = {
  COMPLETE: "up",
  OPEN: "brand",
  "TRIGGER PENDING": "warn",
  REJECTED: "down",
  CANCELLED: "neutral",
} as const;

const PRODUCT_TONE = { MIS: "warn", CNC: "brand", NRML: "violet" } as const;

export default function OrdersPage() {
  const open = ORDERS.filter((o) => o.status === "OPEN" || o.status === "TRIGGER PENDING");

  return (
    <>
      <PageHead
        title="Orders"
        sub="Today's order book. Every submission is read back from the broker and verified before it is shown as placed."
        right={
          <div className="flex items-center gap-2">
            <Pill tone="brand">{open.length} working</Pill>
            <Button variant="outline" size="sm">Cancel all</Button>
          </div>
        }
      />

      <TableWrap>
        <thead>
          <tr>
            <Th>Time</Th>
            <Th>Instrument</Th>
            <Th align="center">Side</Th>
            <Th align="center">Type</Th>
            <Th align="center">Product</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Price</Th>
            <Th align="right">Avg fill</Th>
            <Th align="center">Status</Th>
          </tr>
        </thead>
        <tbody>
          {ORDERS.map((o) => (
            <Tr key={o.id}>
              <Td className="tnum whitespace-nowrap">
                {o.time}
                <span className="block text-[10px] text-ink3">{o.id}</span>
              </Td>
              <Td>
                <span className="text-[13px] font-semibold text-ink">{o.symbol}</span>
                {o.note && <span className="block text-[11px] text-ink3">{o.note}</span>}
              </Td>
              <Td align="center">
                <Pill tone={o.side === "BUY" ? "up" : "down"}>{o.side}</Pill>
              </Td>
              <Td align="center" className="text-[12px] font-medium text-ink2">{o.type}</Td>
              <Td align="center">
                <Pill tone={PRODUCT_TONE[o.product]}>{o.product}</Pill>
              </Td>
              <Td align="right" className="tnum">
                {o.filled}/{o.qty}
              </Td>
              <Td align="right" className="tnum">{o.price === null ? "—" : fmtMoney(o.price)}</Td>
              <Td align="right" className="tnum font-medium text-ink">
                {o.avg === null ? "—" : fmtMoney(o.avg)}
              </Td>
              <Td align="center">
                <Pill tone={STATUS_TONE[o.status]}>{o.status}</Pill>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>

      <Card className="mt-4">
        <p className="text-[13px] leading-relaxed text-ink2">
          <strong className="font-semibold text-ink">Order types Groww accepts:</strong> MARKET, LIMIT, SL and SL_M,
          across CNC (delivery), MIS (intraday) and NRML (F&O). There are no bracket or cover orders, so the stop and
          target you see paired above are a GTT + OCO pair — filling one cancels the other.
        </p>
      </Card>
    </>
  );
}
