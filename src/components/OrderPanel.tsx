"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitOrder, type OrderState } from "@/app/(app)/trade/actions";
import { fmtMoney } from "@/lib/format";
import type { OrderType, Product, Side } from "@/lib/types";

/**
 * The docked order panel — Groww's right-rail ticket, not a modal.
 *
 * BUY/SELL tabs, Delivery/Intraday product pills, a quantity row (a lot
 * stepper on FNO), a price-type selector with the "At market" box, and the
 * Balance / Approx req footer above one big action button.
 *
 * A new instrument must REMOUNT this panel (parents key it by the trading
 * symbol) — half a ticket carried over to the wrong strike is how mistakes
 * get sent.
 *
 * Groww fires on first click; this keeps one confirm step — the button turns
 * into "Confirm buy · ₹…" and the second press sends. Real money deserves
 * one deliberate beat, and it costs a single click.
 */

export interface OrderPanelInstrument {
  symbol: string;
  displayName: string;
  exchange: "NSE" | "BSE";
  segment: "CASH" | "FNO";
  lotSize: number;
  ltp: number | null;
  changePct?: number | null;
}

const TYPES: { value: OrderType; label: string }[] = [
  { value: "MARKET", label: "Market" },
  { value: "LIMIT", label: "Limit" },
  { value: "SL", label: "SL" },
  { value: "SL_M", label: "SL-M" },
];

function ActionButton({ side, label }: { side: Side; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`h-11 w-full rounded-lg text-[14.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 ${
        side === "BUY" ? "bg-brand" : "bg-down"
      }`}
    >
      {pending ? "Sending…" : label}
    </button>
  );
}

export default function OrderPanel({
  instrument,
  balance,
  tradable,
  initialSide = "BUY",
  allowSides = ["BUY", "SELL"],
  onClose,
}: {
  instrument: OrderPanelInstrument;
  balance: number | null;
  tradable: boolean;
  initialSide?: Side;
  allowSides?: Side[];
  /** Rendered as an ✕ when the panel floats over a chain. */
  onClose?: () => void;
}) {
  const fno = instrument.segment === "FNO";
  const [side, setSide] = useState<Side>(initialSide);
  const [product, setProduct] = useState<Product>(fno ? "NRML" : "CNC");
  const [type, setType] = useState<OrderType>("MARKET");
  const [qty, setQty] = useState("");
  const [lots, setLots] = useState("1");
  const [price, setPrice] = useState("");
  const [trigger, setTrigger] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState<OrderState, FormData>(submitOrder, { status: "idle" });


  const lotsNum = Number(lots);
  const qtyNum = fno
    ? Number.isInteger(lotsNum) && lotsNum >= 1
      ? lotsNum * instrument.lotSize
      : NaN
    : Number(qty);

  const needsPrice = type === "LIMIT" || type === "SL";
  const needsTrigger = type === "SL" || type === "SL_M";
  const effectivePrice = needsPrice ? Number(price) : instrument.ltp;
  const approx =
    side === "BUY" && Number.isFinite(qtyNum) && qtyNum > 0 && effectivePrice
      ? qtyNum * effectivePrice
      : side === "SELL"
        ? 0
        : null;

  const ready =
    tradable &&
    Number.isInteger(qtyNum) &&
    qtyNum >= 1 &&
    (!needsPrice || Number(price) > 0) &&
    (!needsTrigger || Number(trigger) > 0);

  const pill = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
      on ? "border-brand bg-brandsoft text-brandtext" : "border-line text-ink2 hover:bg-surfaceh"
    }`;

  return (
    <div className="rounded-lg border border-line bg-surface">
      {/* header */}
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold tracking-tight text-ink">
            {instrument.displayName}
          </p>
          <p className="tnum text-[12px] text-ink3">
            {instrument.ltp === null ? "price unavailable" : `₹${instrument.ltp.toFixed(2)}`}
            {instrument.changePct != null && (
              <span className={instrument.changePct >= 0 ? "text-up" : "text-down"}>
                {" "}
                ({instrument.changePct >= 0 ? "+" : ""}
                {instrument.changePct.toFixed(2)}%)
              </span>
            )}
            <span className="ml-1.5">· {instrument.exchange}</span>
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close order panel"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink3 hover:bg-surfaceh hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>

      {/* BUY / SELL tabs */}
      <div className="mt-3 flex border-b border-line px-4">
        {allowSides.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSide(s);
              setConfirming(false);
            }}
            className={`relative px-4 pb-2.5 text-[13px] font-semibold tracking-wide transition-colors ${
              side === s ? (s === "BUY" ? "text-brandtext" : "text-down") : "text-ink3 hover:text-ink2"
            }`}
          >
            {s}
            {side === s && (
              <span
                className={`absolute inset-x-2 -bottom-px h-[2.5px] rounded-full ${
                  s === "BUY" ? "bg-brand" : "bg-down"
                }`}
              />
            )}
          </button>
        ))}
      </div>

      {state.status === "ok" ? (
        <div className="px-4 py-5 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-upsoft text-up">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.5 4.5L19 7" />
            </svg>
          </div>
          <p className="mt-2 text-[14px] font-semibold text-ink">Order placed</p>
          <p className="tnum mt-1 text-[11.5px] break-all text-ink3">{state.orderId}</p>
          <p className="mt-1 text-[12px] text-ink2">
            Status at the broker: <strong className="font-semibold">{state.orderStatus ?? "—"}</strong>
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink3">
            Read back from Groww after submitting — track it on the Orders page.
          </p>
        </div>
      ) : (
        <form action={action} className="px-4 py-3.5">
          <input type="hidden" name="symbol" value={instrument.symbol} />
          <input type="hidden" name="side" value={side} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="product" value={product} />
          <input type="hidden" name="qty" value={Number.isFinite(qtyNum) ? String(qtyNum) : ""} />
          <input type="hidden" name="segment" value={instrument.segment} />
          <input type="hidden" name="exchange" value={instrument.exchange} />
          <input type="hidden" name="price" value={needsPrice ? price : ""} />
          <input type="hidden" name="trigger" value={needsTrigger ? trigger : ""} />

          {/* product pills */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setProduct(fno ? "NRML" : "CNC")}
              className={pill(product !== "MIS")}
            >
              Delivery{fno && <span className="ml-1 text-[10px] text-ink3">NRML</span>}
            </button>
            <button type="button" onClick={() => setProduct("MIS")} className={pill(product === "MIS")}>
              Intraday
            </button>
          </div>

          {/* qty */}
          <div className="mt-3.5 flex items-center justify-between gap-3">
            <span className="text-[13px] text-ink2">
              Qty {instrument.exchange}
              {fno && <span className="ml-1 text-[11px] text-ink3">lot of {instrument.lotSize}</span>}
            </span>
            {fno ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="One lot fewer"
                  onClick={() => setLots((v) => String(Math.max(1, (Number(v) || 1) - 1)))}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-line text-[16px] text-ink2 hover:bg-surfaceh"
                >
                  −
                </button>
                <input
                  inputMode="numeric"
                  value={lots}
                  onChange={(e) => setLots(e.target.value.replace(/[^0-9]/g, ""))}
                  aria-label="Lots"
                  className="h-9 w-16 rounded-lg border border-line bg-surface text-center text-[14px] text-ink outline-none focus:border-brand"
                />
                <button
                  type="button"
                  aria-label="One lot more"
                  onClick={() => setLots((v) => String((Number(v) || 0) + 1))}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-line text-[16px] text-ink2 hover:bg-surfaceh"
                >
                  +
                </button>
              </span>
            ) : (
              <input
                inputMode="numeric"
                placeholder="0"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
                aria-label="Quantity"
                className="h-9 w-28 rounded-lg border border-line bg-surface px-3 text-right text-[14px] text-ink outline-none focus:border-brand"
              />
            )}
          </div>
          {fno && Number.isFinite(qtyNum) && qtyNum > 0 && (
            <p className="mt-1 text-right text-[11px] text-ink3">= {qtyNum} qty</p>
          )}

          {/* price */}
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[13px] text-ink2">
              Price
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as OrderType);
                  setConfirming(false);
                }}
                aria-label="Order type"
                className="rounded-md border border-line bg-surface px-1.5 py-1 text-[12.5px] text-ink outline-none focus:border-brand"
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </span>
            {needsPrice ? (
              <input
                inputMode="decimal"
                placeholder={instrument.ltp === null ? "0.00" : instrument.ltp.toFixed(2)}
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                aria-label="Limit price"
                className="h-9 w-28 rounded-lg border border-line bg-surface px-3 text-right text-[14px] text-ink outline-none focus:border-brand"
              />
            ) : (
              <span className="flex h-9 w-28 items-center justify-end rounded-lg bg-surface2 px-3 text-[13px] text-ink3">
                At market
              </span>
            )}
          </div>

          {needsTrigger && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[13px] text-ink2">Trigger</span>
              <input
                inputMode="decimal"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value.replace(/[^0-9.]/g, ""))}
                aria-label="Trigger price"
                className="h-9 w-28 rounded-lg border border-line bg-surface px-3 text-right text-[14px] text-ink outline-none focus:border-brand"
              />
            </div>
          )}

          {state.status === "error" && (
            <p role="alert" className="mt-3 rounded-lg border border-down/30 bg-downsoft px-3 py-2 text-[12px] leading-snug text-down">
              {state.message}
            </p>
          )}

          {/* footer */}
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[11.5px] text-ink3">
            <span>
              Balance : <span className="tnum text-ink2">{balance === null ? "—" : fmtMoney(balance, 0)}</span>
            </span>
            <span>
              Approx req :{" "}
              <span className="tnum text-ink2">{approx === null ? "—" : fmtMoney(approx, 0)}</span>
            </span>
          </div>

          <div className="mt-3">
            {!tradable ? (
              <p className="rounded-lg bg-surface2 px-3 py-2.5 text-center text-[12px] text-ink3">
                Order placement is disabled on this server
              </p>
            ) : !confirming ? (
              <button
                type="button"
                disabled={!ready}
                onClick={() => setConfirming(true)}
                className={`h-11 w-full rounded-lg text-[14.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${
                  side === "BUY" ? "bg-brand" : "bg-down"
                }`}
              >
                {side === "BUY" ? "Buy" : "Sell"}
              </button>
            ) : (
              <div className="space-y-2">
                <ActionButton
                  side={side}
                  label={`Confirm ${side.toLowerCase()}${approx ? ` · ${fmtMoney(approx, 0)}` : ""}`}
                />
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="h-9 w-full rounded-lg border border-line text-[12.5px] font-medium text-ink2 hover:bg-surfaceh"
                >
                  Back
                </button>
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
