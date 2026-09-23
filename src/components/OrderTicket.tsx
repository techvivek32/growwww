"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitOrder, type OrderState } from "@/app/(app)/trade/actions";
import { fmtMoney } from "@/lib/format";
import type { OrderType, Product, Side } from "@/lib/types";

/**
 * The order ticket.
 *
 * Two deliberate frictions, because this spends real money:
 *
 * 1. Two steps. The form never submits straight from the inputs — you review
 *    a plain-English sentence of exactly what will be sent, then confirm.
 * 2. No default quantity. An empty box cannot be fat-fingered into a fill;
 *    a prefilled "1" invites a reflexive click.
 *
 * The result panel reports the status read BACK from the broker, so "placed"
 * means the order was found in the book, not merely that the write returned.
 */

const TYPES: { value: OrderType; label: string }[] = [
  { value: "MARKET", label: "Market" },
  { value: "LIMIT", label: "Limit" },
  { value: "SL", label: "Stop-loss limit" },
  { value: "SL_M", label: "Stop-loss market" },
];

const PRODUCTS: { value: Product; label: string; hint: string }[] = [
  { value: "CNC", label: "Delivery", hint: "CNC — settled to your demat" },
  { value: "MIS", label: "Intraday", hint: "MIS — auto-squared off before close" },
];

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-12 flex-1 rounded-lg bg-brand text-[15px] font-semibold text-white transition-colors hover:bg-brandh disabled:opacity-60"
    >
      {pending ? "Sending…" : label}
    </button>
  );
}

const field =
  "h-11 w-full rounded-lg border border-line bg-surface px-3 text-[14px] text-ink outline-none transition-colors focus:border-brand";
const labelCls = "mb-1.5 block text-[12px] font-semibold text-ink2";

export default function OrderTicket({
  symbol,
  company,
  ltp,
  side = "BUY",
  suggestedPrice,
  trigger,
  disabledReason,
}: {
  symbol: string;
  company?: string;
  ltp: number | null;
  side?: Side;
  /** Prefills the limit price — typically the setup's entry level. */
  suggestedPrice?: number | null;
  /** The button that opens the ticket. */
  trigger: { label: string; variant?: "primary" | "outline" | "danger"; full?: boolean };
  /** When set, the button is disabled and this explains why. */
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [type, setType] = useState<OrderType>("MARKET");
  const [product, setProduct] = useState<Product>("CNC");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(suggestedPrice ? String(suggestedPrice) : "");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [state, action] = useActionState<OrderState, FormData>(submitOrder, { status: "idle" });
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const qtyNum = Number(qty);
  const needsPrice = type === "LIMIT" || type === "SL";
  const needsTrigger = type === "SL" || type === "SL_M";
  const effectivePrice = needsPrice ? Number(price) : ltp;
  const estimate =
    Number.isFinite(qtyNum) && qtyNum > 0 && effectivePrice ? qtyNum * effectivePrice : null;

  const ready =
    Number.isInteger(qtyNum) &&
    qtyNum >= 1 &&
    (!needsPrice || Number(price) > 0) &&
    (!needsTrigger || Number(triggerPrice) > 0);

  const btn =
    trigger.variant === "danger"
      ? "bg-down text-white hover:opacity-90"
      : trigger.variant === "outline"
        ? "border border-line2 text-ink hover:bg-surfaceh"
        : "bg-brand text-white hover:bg-brandh";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setReview(false);
          setOpen(true);
        }}
        disabled={Boolean(disabledReason)}
        title={disabledReason}
        className={`inline-flex h-9 items-center justify-center rounded-lg px-3.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${btn} ${trigger.full ? "w-full" : ""}`}
      >
        {trigger.label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${side} ${symbol}`}
          className="fixed inset-0 z-[90] flex items-end justify-center bg-bg/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        >
          <div
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-line bg-surface sm:rounded-2xl"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            {/* header */}
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <p className="text-[16px] font-bold tracking-tight text-ink">
                  {side === "BUY" ? "Buy" : "Sell"} {symbol}
                </p>
                <p className="truncate text-[12.5px] text-ink3">
                  {company ?? "NSE"} · {ltp === null ? "price unavailable" : `LTP ${fmtMoney(ltp)}`}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink3 hover:bg-surfaceh hover:text-ink"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {state.status === "ok" ? (
              <div className="px-5 py-6">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-upsoft text-up">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7" />
                  </svg>
                </div>
                <p className="mt-3 text-center text-[15px] font-semibold text-ink">Order placed</p>
                <dl className="mt-4 space-y-2 rounded-lg border border-line bg-surface2 px-3.5 py-3 text-[12.5px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink3">Order id</dt>
                    <dd className="tnum font-medium break-all text-ink">{state.orderId ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink3">Status at the broker</dt>
                    <dd className="font-medium text-ink">{state.orderStatus ?? "—"}</dd>
                  </div>
                  {state.filled !== undefined && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink3">Filled</dt>
                      <dd className="tnum font-medium text-ink">{state.filled}</dd>
                    </div>
                  )}
                </dl>
                <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">
                  Status is read back from Groww after submitting, not taken from the submission itself.
                  Track it on the Orders page.
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-4 h-11 w-full rounded-lg border border-line2 text-[14px] font-semibold text-ink hover:bg-surfaceh"
                >
                  Done
                </button>
              </div>
            ) : (
              <form action={action} className="px-5 py-4">
                <input type="hidden" name="symbol" value={symbol} />
                <input type="hidden" name="side" value={side} />
                <input type="hidden" name="type" value={type} />
                <input type="hidden" name="product" value={product} />
                <input type="hidden" name="qty" value={qty} />
                <input type="hidden" name="price" value={needsPrice ? price : ""} />
                <input type="hidden" name="trigger" value={needsTrigger ? triggerPrice : ""} />

                {!review ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls} htmlFor="ot-qty">Quantity</label>
                        <input
                          id="ot-qty"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="e.g. 10"
                          value={qty}
                          onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
                          className={field}
                        />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor="ot-type">Order type</label>
                        <select
                          id="ot-type"
                          value={type}
                          onChange={(e) => setType(e.target.value as OrderType)}
                          className={field}
                        >
                          {TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {(needsPrice || needsTrigger) && (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        {needsPrice && (
                          <div>
                            <label className={labelCls} htmlFor="ot-price">Limit price</label>
                            <input
                              id="ot-price"
                              inputMode="decimal"
                              value={price}
                              onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                              className={field}
                            />
                          </div>
                        )}
                        {needsTrigger && (
                          <div>
                            <label className={labelCls} htmlFor="ot-trigger">Trigger price</label>
                            <input
                              id="ot-trigger"
                              inputMode="decimal"
                              value={triggerPrice}
                              onChange={(e) => setTriggerPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                              className={field}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    <p className={`${labelCls} mt-4`}>Product</p>
                    <div className="grid grid-cols-2 gap-2">
                      {PRODUCTS.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => setProduct(p.value)}
                          className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                            product === p.value
                              ? "border-brand bg-brandsoft"
                              : "border-line hover:bg-surfaceh"
                          }`}
                        >
                          <span className="block text-[13px] font-semibold text-ink">{p.label}</span>
                          <span className="block text-[11px] text-ink3">{p.hint}</span>
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3 text-[13px]">
                      <span className="text-ink3">
                        {type === "MARKET" ? "Approx. value" : "Order value"}
                      </span>
                      <span className="tnum font-semibold text-ink">
                        {estimate === null ? "—" : fmtMoney(estimate, 0)}
                      </span>
                    </div>

                    {state.status === "error" && (
                      <p role="alert" className="mt-3 rounded-lg border border-down/30 bg-downsoft px-3 py-2.5 text-[12.5px] leading-snug text-down">
                        {state.message}
                      </p>
                    )}

                    <button
                      type="button"
                      disabled={!ready}
                      onClick={() => setReview(true)}
                      className="mt-4 h-12 w-full rounded-lg bg-brand text-[15px] font-semibold text-white transition-colors hover:bg-brandh disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Review order
                    </button>
                  </>
                ) : (
                  <>
                    <p className="rounded-lg border border-line bg-surface2 px-4 py-3.5 text-[14px] leading-relaxed text-ink">
                      {side === "BUY" ? "Buy" : "Sell"}{" "}
                      <strong className="font-semibold">{qtyNum}</strong> of{" "}
                      <strong className="font-semibold">{symbol}</strong> on NSE as{" "}
                      <strong className="font-semibold">
                        {PRODUCTS.find((p) => p.value === product)?.label.toLowerCase()}
                      </strong>
                      ,{" "}
                      {type === "MARKET" ? (
                        "at the market price"
                      ) : type === "LIMIT" ? (
                        <>at a limit of <strong className="font-semibold">{fmtMoney(Number(price))}</strong></>
                      ) : type === "SL_M" ? (
                        <>at market once it trades through <strong className="font-semibold">{fmtMoney(Number(triggerPrice))}</strong></>
                      ) : (
                        <>
                          at a limit of <strong className="font-semibold">{fmtMoney(Number(price))}</strong> once it
                          trades through <strong className="font-semibold">{fmtMoney(Number(triggerPrice))}</strong>
                        </>
                      )}
                      . Valid for today.
                    </p>

                    {estimate !== null && (
                      <p className="mt-3 flex items-baseline justify-between text-[13px]">
                        <span className="text-ink3">
                          {type === "MARKET" ? "Approx. value" : "Order value"}
                        </span>
                        <span className="tnum font-semibold text-ink">{fmtMoney(estimate, 0)}</span>
                      </p>
                    )}

                    <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">
                      This places a real order on your Groww account. A market order fills at whatever
                      price is available, which can differ from the last traded price.
                    </p>

                    {state.status === "error" && (
                      <p role="alert" className="mt-3 rounded-lg border border-down/30 bg-downsoft px-3 py-2.5 text-[12.5px] leading-snug text-down">
                        {state.message}
                      </p>
                    )}

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setReview(false)}
                        className="h-12 rounded-lg border border-line2 px-4 text-[14px] font-semibold text-ink hover:bg-surfaceh"
                      >
                        Back
                      </button>
                      <Submit label={`Place ${side.toLowerCase()} order`} />
                    </div>
                  </>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
