"use server";

import { revalidatePath } from "next/cache";
import { placeOrder, cancelOrder, canTrade } from "@/lib/api/broker";
import { lotSizeOf } from "@/lib/instruments";
import { currentUserId } from "@/lib/session";
import { rateLimit } from "@/lib/ratelimit";
import { notify } from "@/lib/notifications";
import type { OrderType, Product, Side } from "@/lib/types";

/**
 * Order placement, server-side.
 *
 * Everything is re-validated here. The browser sends a form; it does not send
 * a trusted instruction. A crafted request must not be able to place an order
 * with a quantity, symbol or price the UI would never offer — so the session
 * is checked again, every field is parsed from scratch, and anything that
 * fails validation is refused before a single call reaches Groww.
 */

export interface OrderState {
  status: "idle" | "ok" | "error";
  message?: string;
  orderId?: string;
  orderStatus?: string;
  filled?: number;
}

const SIDES: Side[] = ["BUY", "SELL"];
const TYPES: OrderType[] = ["MARKET", "LIMIT", "SL", "SL_M"];
const PRODUCTS: Product[] = ["CNC", "MIS", "NRML"];

/** NSE trading symbols: capitals, digits, and the occasional & or -. */
const SYMBOL = /^[A-Z0-9&-]{1,30}$/;

/** Hard ceilings no UI path can exceed — the fat-finger backstops. */
const MAX_QTY = 10_000;
/** Per-order notional cap (enforced where a price is known). */
const MAX_NOTIONAL = 5_000_000;

function fail(message: string): OrderState {
  return { status: "error", message };
}

export async function submitOrder(_prev: OrderState, form: FormData): Promise<OrderState> {
  const userId = await currentUserId();
  if (!userId) return fail("Your session expired. Sign in again.");
  // Throttle the order path so a stuck client or a script cannot machine-gun
  // the broker: at most 30 submissions a minute per user.
  if (!rateLimit(`order:${userId}`, 30, 60_000).ok) {
    return fail("Too many orders in a short window. Pause a moment and retry.");
  }
  if (!canTrade()) return fail("Order placement is disabled, or no broker is connected on this account.");

  const symbol = String(form.get("symbol") ?? "").trim().toUpperCase();
  const segment = String(form.get("segment") ?? "CASH") === "FNO" ? ("FNO" as const) : ("CASH" as const);
  const exchange = String(form.get("exchange") ?? "NSE") === "BSE" ? ("BSE" as const) : ("NSE" as const);
  if (exchange === "BSE" && segment !== "FNO") {
    return fail("BSE orders are supported for index derivatives only.");
  }
  const side = String(form.get("side") ?? "") as Side;
  const type = String(form.get("type") ?? "") as OrderType;
  const product = String(form.get("product") ?? "") as Product;
  const qty = Number(form.get("qty"));
  const priceRaw = String(form.get("price") ?? "").trim();
  const triggerRaw = String(form.get("trigger") ?? "").trim();

  if (!SYMBOL.test(symbol)) return fail("That symbol does not look like an NSE trading symbol.");
  if (!SIDES.includes(side)) return fail("Invalid side.");
  if (!TYPES.includes(type)) return fail("Invalid order type.");
  if (!PRODUCTS.includes(product)) return fail("Invalid product.");
  if (segment === "FNO" && product === "CNC") return fail("FNO orders settle NRML or MIS, not CNC.");
  if (!Number.isInteger(qty) || qty < 1) return fail("Quantity must be a whole number of at least 1.");
  if (qty > MAX_QTY) return fail(`Quantity is capped at ${MAX_QTY.toLocaleString("en-IN")} per order.`);

  if (segment === "FNO") {
    // The exchange only accepts whole lots; the lot size comes from the same
    // instrument master the chain was built from, not from the form.
    const lot = await lotSizeOf(symbol);
    if (lot === null) return fail("That contract is not in the instrument master.");
    if (qty % lot !== 0) return fail(`Quantity must be a multiple of the lot size (${lot}).`);
  }

  let price: number | null = null;
  if (type === "LIMIT" || type === "SL") {
    price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) return fail("A limit price is required for this order type.");
    // Notional backstop: quantity × price cannot exceed the per-order ceiling.
    if (qty * price > MAX_NOTIONAL) {
      return fail(`This order's value exceeds the ₹${MAX_NOTIONAL.toLocaleString("en-IN")} per-order limit.`);
    }
  }

  let triggerPrice: number | null = null;
  if (type === "SL" || type === "SL_M") {
    triggerPrice = Number(triggerRaw);
    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
      return fail("A trigger price is required for this order type.");
    }
  }

  const result = await placeOrder({ symbol, side, qty, type, product, price, triggerPrice, segment, exchange });

  // The order book changed either way — a rejection belongs on screen too.
  revalidatePath("/portfolio/orders");
  revalidatePath("/portfolio/positions");
  revalidatePath("/portfolio/holdings");

  const label = `${side} ${qty} ${symbol}`;
  if (!result.ok) {
    await notify(userId, {
      kind: "order",
      tone: "down",
      title: "Order rejected",
      body: `${label} — ${result.message ?? "Groww rejected the order."}`,
      key: result.referenceId ? `rej-${result.referenceId}` : undefined,
    });
    return fail(result.message ?? "Groww rejected the order.");
  }

  await notify(userId, {
    kind: "order",
    tone: "up",
    title: "Order placed",
    body: `${label} · status ${result.status ?? "sent"}${result.orderId ? ` · ${result.orderId}` : ""}`,
    key: result.orderId ? `ord-${result.orderId}` : undefined,
  });

  return {
    status: "ok",
    orderId: result.orderId ?? undefined,
    orderStatus: result.status ?? undefined,
    filled: result.filled ?? undefined,
    message: result.message ?? undefined,
  };
}

export async function cancelOrderAction(_prev: OrderState, form: FormData): Promise<OrderState> {
  const userId = await currentUserId();
  if (!userId) return fail("Your session expired. Sign in again.");
  if (!rateLimit(`cancel:${userId}`, 30, 60_000).ok) {
    return fail("Too many cancellations in a short window. Pause a moment and retry.");
  }

  const orderId = String(form.get("orderId") ?? "").trim();
  if (!orderId) return fail("Missing order id.");

  const segment = String(form.get("segment") ?? "CASH") === "FNO" ? "FNO" : "CASH";
  const res = await cancelOrder(orderId, segment);

  revalidatePath("/portfolio/orders");

  if (res.ok) {
    await notify(userId, { kind: "order", tone: "neutral", title: "Cancellation sent", body: `Order ${orderId}` });
    return { status: "ok", message: "Cancellation sent." };
  }
  return fail(res.message ?? "Groww refused the cancellation.");
}
