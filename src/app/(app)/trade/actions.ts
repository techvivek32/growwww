"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { placeOrder, cancelOrder, canTrade } from "@/lib/api/broker";
import { lotSizeOf } from "@/lib/instruments";
import { currentUserId, inAdminView } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { hasBroker } from "@/lib/users";
import { DENIAL_MESSAGE, tradePermission } from "@/lib/trading";
import { rateLimit } from "@/lib/ratelimit";
import { notify } from "@/lib/notifications";
import { appendOrder } from "@/lib/ledger";
import { hasConsented, SIGN_FIRST } from "@/lib/consent";
import { logAdminAccess } from "@/lib/adminAccess";
import { clientIp } from "@/lib/clientIp";
import type { OrderType, Product, Side } from "@/lib/types";

/** The ledger is our bookkeeping, not the order path: a failed write must
 *  never turn an order Groww accepted into an error on screen. */
async function record(e: Parameters<typeof appendOrder>[0]): Promise<void> {
  try {
    await appendOrder(e);
  } catch (err) {
    console.error("[ledger] append failed:", err instanceof Error ? err.message : err);
  }
}

/** The same for the notice that tells the account holder what happened: the
 *  order already went to Groww, so a failed write must not turn it into an
 *  error on screen — that invites a retry, and a second real order. */
async function tell(userId: string, n: Parameters<typeof notify>[1]): Promise<void> {
  try {
    await notify(userId, n);
  } catch (err) {
    console.error("[notify] order notice failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * The admin may place and cancel orders from inside a client's account ("Open
 * account"), but it is never passed off as the client's own act: the ledger
 * entry is marked `by: "admin"`, the admin access log gets a line saying what
 * was sent and how it ended, and the client's notification says who sent it.
 * A line is written whenever a ledger entry is, and also for an admin
 * cancellation Groww did not confirm (which has no ledger entry). Like the
 * ledger, the log is bookkeeping, so a failed write is reported here and never raised.
 */
async function logAdminAct(kind: "order" | "cancel", userId: string, detail: string): Promise<void> {
  try {
    await logAdminAccess({ kind, userId, ip: clientIp(await headers()), detail });
  } catch (err) {
    console.error("[admin-access] log failed:", err instanceof Error ? err.message : err);
  }
}

/** Added to the client's notification when the admin sent the order. */
const SENT_BY_ADMIN = " · sent by the MNHA admin from inside your account";

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
  // The admin inside this client's account may send it, recorded as the
  // admin's act (see logAdminAct).
  const byAdmin = await inAdminView();
  const note = byAdmin ? SENT_BY_ADMIN : "";
  // Pages send a member who has not signed to /consent, but an order can come
  // from a page opened earlier, or from no page at all — so check here too.
  if (userId !== OWNER_ID && !(await hasConsented(userId))) return fail(SIGN_FIRST);
  // A member may trade once the static IP registered on their OWN Groww key is
  // the address this server sends orders from. Without that match Groww refuses
  // the order at the gate, so refusing it here is both honest and faster.
  const permission = await tradePermission(userId);
  if (!permission.allowed) return fail(DENIAL_MESSAGE[permission.reason ?? "no-broker"]);
  // Throttle the order path so a stuck client or a script cannot machine-gun
  // the broker: at most 30 submissions a minute per user.
  if (!rateLimit(`order:${userId}`, 30, 60_000).ok) {
    return fail("Too many orders in a short window. Pause a moment and retry.");
  }
  // canTrade() alone reads the server's house account when no user context
  // is set, so a user's own connection is checked explicitly.
  if (!canTrade() || (userId !== OWNER_ID && !(await hasBroker(userId)))) {
    return fail("Order placement is disabled, or no broker is connected on this account.");
  }

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
  // The platform's own append-only record of this order ("hisab") — only for
  // requests that actually went to Groww; a local refusal is not an order.
  if (result.outcome !== "refused") {
    await record({
      userId, status: result.outcome, symbol, side, qty, type, product, segment, exchange,
      price, trigger: triggerPrice, orderId: result.orderId ?? null, message: result.outcome === "placed" ? (result.status ?? null) : (result.message ?? result.status ?? null),
      ...(byAdmin ? { by: "admin" as const } : {}),
    });
    if (byAdmin) {
      await logAdminAct("order", userId, `${label} ${exchange} ${segment} ${type} ${product}${price != null ? ` @ ${price}` : ""}${triggerPrice != null ? ` trigger ${triggerPrice}` : ""} · ${result.outcome}${result.orderId ? ` · ${result.orderId}` : ""}`);
    }
  }
  if (result.outcome === "refused") return fail(result.message ?? "Nothing was sent to Groww.");
  if (result.outcome === "unknown") {
    await tell(userId, {
      kind: "order",
      tone: "warn",
      title: byAdmin ? "Admin's order: status unknown" : "Order status unknown",
      body: `${label} — ${result.message ?? "Check the order book in Groww before retrying."}${note}`,
      key: result.referenceId ? `unk-${result.referenceId}` : undefined,
    });
    return fail(result.message ?? "Order status unknown — check the order book in Groww before retrying.");
  }
  if (result.outcome !== "placed") {
    // Includes an order Groww accepted but the exchange then rejected.
    const why = result.message ?? (result.status ? `Status: ${result.status}` : "Groww rejected the order.");
    await tell(userId, {
      kind: "order",
      tone: "down",
      title: byAdmin ? "Admin's order rejected" : "Order rejected",
      body: `${label} — ${why}${note}`,
      key: result.referenceId ? `rej-${result.referenceId}` : undefined,
    });
    return fail(why);
  }

  await tell(userId, {
    kind: "order",
    tone: "up",
    title: byAdmin ? "Order placed by admin" : "Order placed",
    body: `${label} · status ${result.status ?? "sent"}${result.orderId ? ` · ${result.orderId}` : ""}${note}`,
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
  const byAdmin = await inAdminView(); // recorded as the admin's act, as in submitOrder
  // No agreement check here: a cancellation only reduces exposure, so it is never blocked.
  // Cancelling is part of the same desk: whoever may place may also cancel.
  const permission = await tradePermission(userId);
  if (!permission.allowed) return fail(DENIAL_MESSAGE[permission.reason ?? "no-broker"]);
  if (!rateLimit(`cancel:${userId}`, 30, 60_000).ok) {
    return fail("Too many cancellations in a short window. Pause a moment and retry.");
  }

  const orderId = String(form.get("orderId") ?? "").trim();
  if (!orderId) return fail("Missing order id.");

  const segment = String(form.get("segment") ?? "CASH") === "FNO" ? "FNO" : "CASH";
  const res = await cancelOrder(orderId, segment);

  revalidatePath("/portfolio/orders");

  if (res.ok) {
    await record({
      userId, status: "cancelled", symbol: "", side: "", qty: 0, type: "", product: "", segment, exchange: "",
      price: null, orderId, message: "Cancellation sent",
      ...(byAdmin ? { by: "admin" as const } : {}),
    });
    if (byAdmin) await logAdminAct("cancel", userId, `Order ${orderId} · cancellation sent`);
    await tell(userId, {
      kind: "order",
      tone: "neutral",
      title: byAdmin ? "Cancellation sent by admin" : "Cancellation sent",
      body: `Order ${orderId}${byAdmin ? SENT_BY_ADMIN : ""}`,
    });
    return { status: "ok", message: "Cancellation sent." };
  }
  if (byAdmin && res.sent) {
    // Not confirmed is not "nothing happened": Groww may still have cancelled it.
    const why = res.message ?? "Groww refused the cancellation.";
    await logAdminAct("cancel", userId, `Order ${orderId} · cancellation not confirmed: ${why}`);
    await tell(userId, { kind: "order", tone: "warn", title: "Admin's cancellation not confirmed", body: `Order ${orderId} — ${why}${SENT_BY_ADMIN}` });
  }
  return fail(res.message ?? "Groww refused the cancellation.");
}
