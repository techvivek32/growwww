"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { placeOrder, cancelOrder, canTrade } from "@/lib/api/broker";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth";
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

/** A hard ceiling that no UI path can exceed — the fat-finger backstop. */
const MAX_QTY = 10_000;

async function signedIn(): Promise<boolean> {
  const jar = await cookies();
  return verifyToken(jar.get(SESSION_COOKIE)?.value);
}

function fail(message: string): OrderState {
  return { status: "error", message };
}

export async function submitOrder(_prev: OrderState, form: FormData): Promise<OrderState> {
  if (!(await signedIn())) return fail("Your session expired. Sign in again.");
  if (!canTrade()) return fail("Order placement is disabled on this server.");

  const symbol = String(form.get("symbol") ?? "").trim().toUpperCase();
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
  if (!Number.isInteger(qty) || qty < 1) return fail("Quantity must be a whole number of at least 1.");
  if (qty > MAX_QTY) return fail(`Quantity is capped at ${MAX_QTY.toLocaleString("en-IN")} per order.`);

  let price: number | null = null;
  if (type === "LIMIT" || type === "SL") {
    price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) return fail("A limit price is required for this order type.");
  }

  let triggerPrice: number | null = null;
  if (type === "SL" || type === "SL_M") {
    triggerPrice = Number(triggerRaw);
    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
      return fail("A trigger price is required for this order type.");
    }
  }

  const result = await placeOrder({ symbol, side, qty, type, product, price, triggerPrice });

  // The order book changed either way — a rejection belongs on screen too.
  revalidatePath("/portfolio/orders");
  revalidatePath("/portfolio/positions");
  revalidatePath("/portfolio/holdings");

  if (!result.ok) {
    return fail(result.message ?? "Groww rejected the order.");
  }

  return {
    status: "ok",
    orderId: result.orderId ?? undefined,
    orderStatus: result.status ?? undefined,
    filled: result.filled ?? undefined,
    message: result.message ?? undefined,
  };
}

export async function cancelOrderAction(_prev: OrderState, form: FormData): Promise<OrderState> {
  if (!(await signedIn())) return fail("Your session expired. Sign in again.");

  const orderId = String(form.get("orderId") ?? "").trim();
  if (!orderId) return fail("Missing order id.");

  const segment = String(form.get("segment") ?? "CASH") === "FNO" ? "FNO" : "CASH";
  const res = await cancelOrder(orderId, segment);

  revalidatePath("/portfolio/orders");

  return res.ok
    ? { status: "ok", message: "Cancellation sent." }
    : fail(res.message ?? "Groww refused the cancellation.");
}
