import "server-only";
import crypto from "node:crypto";
import { appendOrder, type LedgerStatus } from "@/lib/ledger";
import { notify, type NotifTone } from "@/lib/notifications";
import { cancelOrderAs, houseConfigured, orderBookAs, orderByRefAs, placeOrderAs, positionsAs, type PlacedOrder } from "@/lib/api/broker";
import { getBroker } from "@/lib/users";
import { OWNER_ID } from "@/lib/auth";
import { FINAL_ORDER_STATES, type BookOrder, type OpenPosition } from "@/lib/api/groww";
import type { OrderType, Product, Side } from "@/lib/types";
import {
  ACTION_LABEL,
  getOrder,
  insertOrder,
  openOrders,
  ordersOfDay,
  patchOrder,
  type Leg,
  type LiveOrder,
  type OrderAction,
} from "./store";
import { istNow, pool, sleep, withAccountLock } from "./util";
import { clearErasing, isErasing, markErasing } from "@/lib/kycHandoff";

/**
 * Sending, following and closing live-trading orders.
 *
 * Three rules hold everywhere here:
 *  1. An order is written down before it is sent, under an id fixed for its
 *     purpose; an id already on record is never sent again.
 *  2. An order whose outcome is not known is looked up in Groww's order book by
 *     its reference — never sent a second time on a guess.
 *  3. Nothing is closed on our records alone: a close is sized from Groww's
 *     live position, so a position someone already closed is never doubled
 *     into the opposite one.
 */

const hash = (s: string, n: number) => crypto.createHash("sha256").update(s).digest("hex").slice(0, n);

/** A strategy order's id and Groww reference: fixed for the day, step, account and attempt. */
export function strategyKey(day: number, action: OrderAction, accountId: string, attempt: number): { id: string; ref: string } {
  const id = `${day}|${action}|${accountId}|${attempt}`;
  // "s" + day in base 36 + 12 hex + attempt: at most 20 characters, two hyphens (Groww's rule).
  return { id, ref: `s${day.toString(36)}-${hash(id, 12)}-${attempt % 10}` };
}

/** An admin order's id and reference: fixed for the admin action, account and position, so a double submit sends nothing twice. */
export function adminKey(batch: string, accountId: string, what: string): { id: string; ref: string } {
  const id = `${batch}|${accountId}|${what}`;
  return { id, ref: `a${hash(id, 16)}-0` };
}

export interface OrderSpec {
  id: string;
  ref: string;
  day: number;
  source: "auto" | "admin";
  mode: "live" | "shadow";
  action: OrderAction;
  leg: Leg | null;
  batch: string | null;
  accountId: string;
  symbol: string;
  side: Side;
  qty: number;
  product: Product;
  type: OrderType;
  price: number | null;
  segment: "CASH" | "FNO";
  exchange: "NSE" | "BSE";
  /** Shadow only: the price it is taken as filled at. */
  shadowPx?: number | null;
}

/* ------------------------------------------------------------ bookkeeping */

function describe(o: LiveOrder): string {
  const kind = o.product === "MIS" ? "intraday" : o.product === "CNC" ? "delivery" : o.product;
  const at = o.type === "LIMIT" && o.price != null ? ` at ₹${o.price.toLocaleString("en-IN")}` : " at market";
  return `${o.side} ${o.qty.toLocaleString("en-IN")} ${o.symbol} (${kind})${at}`;
}

const byWhom = (o: LiveOrder) => (o.source === "auto" ? "MNHA's automatic strategy" : "the MNHA admin");

/**
 * The account's order ledger and the account holder's notice, once per order,
 * when its outcome is first known. Bookkeeping only: a failed write is logged,
 * never raised — the order already went to Groww.
 */
async function bookkeep(o: LiveOrder): Promise<void> {
  if (o.mode !== "live" || o.state === "refused" || o.state === "sending" || o.state === "not-sent" || o.state === "shadow") return;
  const status: LedgerStatus = o.state === "placed" ? "placed" : o.state === "rejected" ? "rejected" : "unknown";
  try {
    await appendOrder({
      userId: o.accountId,
      status,
      symbol: o.symbol,
      side: o.side,
      qty: o.qty,
      type: o.type,
      product: o.product,
      segment: o.segment,
      exchange: o.exchange,
      price: o.price,
      orderId: o.orderId,
      message: status === "placed" ? (o.status ?? null) : (o.message ?? o.status ?? null),
      by: o.source === "auto" ? "system" : "admin",
    });
  } catch (err) {
    console.error("[live] ledger append failed:", err instanceof Error ? err.message : err);
  }
  const auto = o.source === "auto";
  const title =
    status === "placed"
      ? auto ? "Strategy order placed" : "Order placed by the MNHA admin"
      : status === "rejected"
        ? auto ? "Strategy order rejected" : "Admin's order rejected"
        : auto ? "Strategy order: status unknown" : "Admin's order: status unknown";
  const tone: NotifTone = status === "placed" ? "up" : status === "rejected" ? "down" : "warn";
  const why = status === "rejected" && o.message ? ` · ${o.message}` : status === "unknown" ? " · being checked with Groww" : "";
  await tell(o.accountId, { tone, title, body: `${describe(o)} — ${ACTION_LABEL[o.action]}, sent by ${byWhom(o)}${why}`, key: `lt-${o.ref}` });
}

async function tell(userId: string, n: { tone: NotifTone; title: string; body: string; key: string }): Promise<void> {
  try {
    await notify(userId, { kind: "order", ...n });
  } catch (err) {
    console.error("[live] notice failed:", err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------------ send */

/**
 * Send one order — or, in shadow mode, record it as filled without sending.
 * It is on record before anything leaves; an id already on record returns
 * null and sends nothing. Call it inside the account's lock.
 */
export async function sendOrder(spec: OrderSpec): Promise<LiveOrder | null> {
  if (isErasing(spec.accountId)) return null; // being deleted: nothing more is sent or recorded for it
  const now = Date.now();
  const shadow = spec.mode === "shadow";
  const rec: LiveOrder = {
    id: spec.id,
    ref: spec.ref,
    day: spec.day,
    at: now,
    updatedAt: now,
    source: spec.source,
    mode: spec.mode,
    action: spec.action,
    leg: spec.leg,
    batch: spec.batch,
    accountId: spec.accountId,
    symbol: spec.symbol,
    side: spec.side,
    qty: spec.qty,
    product: spec.product,
    type: spec.type,
    price: spec.price,
    segment: spec.segment,
    exchange: spec.exchange,
    state: shadow ? "shadow" : "sending",
    orderId: null,
    status: null,
    filled: shadow ? spec.qty : null,
    avg: shadow ? (spec.shadowPx ?? null) : null,
    message: shadow ? "Shadow mode: recorded as filled, never sent to Groww." : null,
    final: shadow,
    booked: shadow,
  };
  if (!(await insertOrder(rec))) return null;
  if (shadow) return rec;

  const input = {
    symbol: spec.symbol,
    side: spec.side,
    qty: spec.qty,
    type: spec.type,
    product: spec.product,
    price: spec.price,
    segment: spec.segment,
    exchange: spec.exchange,
    referenceId: spec.ref,
  };
  // From here the position may change at any moment: no close is sized from a reading taken too soon after.
  const key: PosKey = { segment: spec.segment, exchange: spec.exchange, symbol: spec.symbol, product: spec.product };
  const stamp = markActivity(spec.accountId, key);
  let res: PlacedOrder = await placeOrderAs(spec.accountId, input);
  // HTTP 429: throttled before Groww looked at it. Up to two more tries, each
  // only after the order book shows the reference is not there.
  for (let i = 0; i < 2 && res.outcome === "rejected" && res.httpStatus === 429; i++) {
    await sleep(1500 + 1000 * i);
    const book = await orderBookAs(spec.accountId, spec.segment);
    if (!book) break;
    const hit = book.orders.find((b) => b.referenceId === spec.ref);
    if (hit) {
      res = { ok: true, outcome: "placed", orderId: hit.orderId, status: hit.status, filled: hit.filled, message: hit.remark, referenceId: spec.ref };
      break;
    }
    res = await placeOrderAs(spec.accountId, input);
  }

  // If this write fails the record stays "sending", and followOrders finds the
  // order by its reference: the send is never lost, and never repeated.
  if (res.outcome === "rejected" || res.outcome === "refused") clearActivity(spec.accountId, key, stamp);
  const o = await patchOrder(rec.id, {
    state: res.outcome,
    orderId: res.orderId,
    status: res.status ? res.status.toUpperCase() : null,
    filled: res.filled,
    message: res.message,
    final: res.outcome === "rejected" || res.outcome === "refused",
    booked: true,
    sentAt: Date.now(),
  });
  if (o) await bookkeep(o);
  return o;
}

/* ---------------------------------------------------------------- follow */

/** After this long, an order Groww has not been seen to have stops being followed (and says so). */
const FOLLOW_GIVE_UP_MS = 15 * 60_000;
/** An order of unknown outcome is called "never placed" only after two complete order-book
 *  misses MISS_GAP_MS apart, the first at least NOT_FOUND_AFTER_MS after its send returned. */
const NOT_FOUND_AFTER_MS = 45_000;
const MISS_GAP_MS = 30_000;

const gf = globalThis as { __mnhaLiveFollow?: Map<string, number> };
gf.__mnhaLiveFollow ??= new Map();
const followAt = gf.__mnhaLiveFollow;

/**
 * Bring every order still being followed up to date from Groww's order book:
 * fills, average price, final status — and, for an order whose outcome was
 * unknown, whether Groww has it at all. One order-book read per account. An
 * order Groww still shows as working is followed for as long as it works.
 */
export async function followOrders(): Promise<void> {
  const all = await openOrders();
  if (!all.length) return;
  // An earlier day's order cannot be learned about from today's order book: one positive look-up by
  // reference (if the account is still reachable), then it is settled as unresolved.
  const today = istNow().day;
  for (const o of all.filter((x) => x.day !== today)) {
    const hit = (await connectedNow(o.accountId)) === true ? await orderByRefAs(o.accountId, o.ref, o.segment) : null;
    const rejected = hit ? hit.status === "REJECTED" || hit.status === "FAILED" : false;
    const updated = await patchOrder(o.id, {
      final: true,
      ...(hit ? { state: rejected ? ("rejected" as const) : ("placed" as const), orderId: hit.orderId, status: hit.status, filled: hit.filled, booked: true } : {}),
      message: hit
        ? `Found at Groww after its day: ${hit.status.toLowerCase()}${hit.filled ? `, ${hit.filled} filled` : ""}.`
        : `${o.message ? `${o.message} · ` : ""}Not resolved on its day; no longer followed here — check it in Groww.`,
    });
    if (hit && updated) {
      if (!o.booked) await bookkeep(updated);
      else if (o.state === "unknown" || o.state === "sending") {
        await tell(o.accountId, {
          tone: rejected ? "down" : "up",
          title: rejected ? "Order found at Groww: rejected" : "Order found at Groww",
          body: `${describe(updated)} — ${ACTION_LABEL[o.action]}: Groww has it as ${hit.status.toLowerCase()}${hit.filled ? `, ${hit.filled} filled` : ""}.`,
          key: `lt-${o.ref}-f`,
        });
      }
    }
  }
  const open = all.filter((x) => x.day === today);
  const byAccount = new Map<string, LiveOrder[]>();
  for (const o of open) {
    const list = byAccount.get(o.accountId) ?? [];
    list.push(o);
    byAccount.set(o.accountId, list);
  }
  await pool([...byAccount.entries()], 4, async ([accountId, list]) => {
    const now = Date.now();
    // Disconnected (or its key unusable): nothing can be read now, and asking would only fill the log.
    // Checked on every pass — a local read — so a reconnected account is followed again at once.
    if ((await connectedNow(accountId)) !== true) return;
    if ((followAt.get(accountId) ?? 0) > now) return;
    const young = list.some((o) => now - (o.sentAt ?? o.at) < 120_000);
    followAt.set(accountId, now + (young ? 2_500 : 20_000));
    await withAccountLock(accountId, async () => {
      for (const segment of ["CASH", "FNO"] as const) {
        const mine = list.filter((o) => o.segment === segment);
        if (!mine.length) continue;
        const book = await orderBookAs(accountId, segment);
        if (!book) continue;
        for (const o of mine) await resolveOne(o.id, book);
      }
    });
  });
}

async function resolveOne(id: string, book: { orders: BookOrder[]; complete: boolean }): Promise<void> {
  const o = await getOrder(id); // fresh: a send may have updated it meanwhile
  if (!o || o.final || o.mode !== "live") return;
  const now = Date.now();
  const sinceSend = now - (o.sentAt ?? o.at);
  const unsure = o.state === "sending" || o.state === "unknown";
  let hit = (o.orderId ? book.orders.find((b) => b.orderId === o.orderId) : undefined) ?? book.orders.find((b) => b.referenceId === o.ref);
  // Not in the book: ask Groww by reference too (it only ever confirms).
  if (!hit && (unsure || o.state === "not-sent")) hit = (await orderByRefAs(o.accountId, o.ref, o.segment)) ?? undefined;
  if (hit) {
    const rejected = hit.status === "REJECTED" || hit.status === "FAILED";
    if ((hit.filled ?? 0) > (o.filled ?? 0)) markActivity(o.accountId, keyOf(o)); // a fill: the position is about to change
    const updated = await patchOrder(o.id, {
      state: rejected ? "rejected" : "placed",
      orderId: hit.orderId,
      status: hit.status,
      filled: hit.filled,
      avg: hit.avg ?? o.avg,
      message: hit.remark ?? o.message,
      // Followed for as long as Groww shows it working: its unfilled part can still fill.
      final: FINAL_ORDER_STATES.has(hit.status),
      booked: true,
      misses: 0,
    });
    if (!updated) return;
    if (!o.booked) {
      await bookkeep(updated); // the first time this order's outcome is known
    } else if (unsure || o.state === "not-sent") {
      await tell(o.accountId, {
        tone: rejected ? "down" : "up",
        title: rejected ? "Order found at Groww: rejected" : "Order found at Groww",
        body: `${describe(updated)} — ${ACTION_LABEL[o.action]}: Groww has it as ${hit.status.toLowerCase()}${hit.filled ? `, ${hit.filled} filled` : ""}.`,
        key: `lt-${o.ref}-f`,
      });
    } else if (o.state === "placed" && rejected) {
      await tell(o.accountId, {
        tone: "down",
        title: "Order rejected at the exchange",
        body: `${describe(updated)} — ${ACTION_LABEL[o.action]}${hit.remark ? ` · ${hit.remark}` : ""}`,
        key: `lt-${o.ref}-x`,
      });
    }
    return;
  }
  if (o.day !== istNow(now).day) {
    // An earlier day's order that today's book cannot show: nothing more can be learned here.
    await patchOrder(o.id, {
      final: true,
      message: `${o.message ? `${o.message} · ` : ""}Not resolved on its day; no longer followed here — check it in Groww.`,
    });
    return;
  }
  if (o.state === "not-sent") return; // re-checked all day, in case Groww shows it after all
  if (unsure) {
    // "Never placed" needs a complete book that shows references at all (one with a reference,
    // or none at all) — twice, apart. Without that the order is only ever left unconfirmed, and
    // any close is still sized from the live position, never doubled.
    const showsRefs = book.orders.length === 0 || book.orders.some((b) => b.referenceId);
    if (book.complete && showsRefs && sinceSend > NOT_FOUND_AFTER_MS) {
      const misses = o.misses ?? 0;
      if (misses > 0 && now - (o.missAt ?? 0) < MISS_GAP_MS) return;
      if (misses + 1 < 2) {
        await patchOrder(o.id, { misses: misses + 1, missAt: now });
        return;
      }
      // `booked` is left as it was: if Groww shows the order after all, it is booked then.
      const updated = await patchOrder(o.id, {
        state: "not-sent",
        misses: misses + 1,
        missAt: now,
        message: "Groww has no order with this reference: it was not placed (checked again through the day).",
      });
      if (updated && o.booked) {
        // The holder was told "status unknown"; close that out.
        await tell(o.accountId, {
          tone: "neutral",
          title: "Order was not placed",
          body: `${describe(updated)} — ${ACTION_LABEL[o.action]}: Groww has no record of it, so nothing was bought or sold.`,
          key: `lt-${o.ref}-n`,
        });
      }
      return;
    }
    if (sinceSend > FOLLOW_GIVE_UP_MS) {
      await patchOrder(o.id, {
        final: true,
        message: `${o.message ? `${o.message} · ` : ""}Groww could not confirm whether this order was placed; no longer followed here — check it in Groww.`,
      });
    }
    return;
  }
  // Placed (with Groww's id) yet missing from the book: odd — give it time, then say so.
  if (sinceSend > FOLLOW_GIVE_UP_MS) {
    await patchOrder(o.id, {
      final: true,
      message: `${o.message ? `${o.message} · ` : ""}Not found in Groww's order book; no longer followed here — check it in Groww.`,
    });
  }
}

/* --------------------------------------------------------- strategy legs */

/** Groww may still be working on it, so its unfilled part may still fill. */
export function working(o: LiveOrder): boolean {
  if (o.mode !== "live") return false;
  return o.state === "sending" || o.state === "unknown" || (o.state === "placed" && !o.final);
}

/** The most of it that may still fill: all of it while its outcome is unknown. */
function unfilled(o: LiveOrder): number {
  return o.state === "sending" || o.state === "unknown" ? o.qty : Math.max(0, o.qty - (o.filled ?? 0));
}

/**
 * Where a strategy leg stands in one account, from the orders on record:
 *  - open: opening fills minus closing fills;
 *  - possible: the most that may be open — an opening order still working (or
 *    of unknown outcome) counts in full, since it may fill;
 *  - openWorking: an opening order is still working;
 *  - symbol: the leg's symbol.
 */
export function legState(
  orders: LiveOrder[],
  accountId: string,
  leg: Leg,
  mode: "live" | "shadow",
): { open: number; possible: number; openWorking: boolean; symbol: string | null } {
  const opening: Side = leg === "short" ? "SELL" : "BUY";
  let filledOpen = 0;
  let possibleOpen = 0;
  let filledClose = 0;
  let openWorking = false;
  let symbol: string | null = null;
  for (const o of orders) {
    if (o.accountId !== accountId || o.leg !== leg || o.mode !== mode) continue;
    const f = o.filled ?? 0;
    if (o.side === opening) {
      symbol ??= o.symbol;
      filledOpen += f;
      possibleOpen += working(o) ? Math.max(f, o.qty) : f;
      if (working(o)) openWorking = true;
    } else {
      filledClose += f;
    }
  }
  return {
    open: Math.max(0, filledOpen - filledClose),
    possible: Math.max(0, possibleOpen - filledClose),
    openWorking,
    symbol,
  };
}

/** MNHA's orders still working at Groww on this position, in the closing direction. */
function workingOn(orders: LiveOrder[], accountId: string, p: PosKey, closingSide: Side): LiveOrder[] {
  return orders.filter(
    (o) => o.accountId === accountId && working(o) && o.side === closingSide && o.symbol === p.symbol && o.product === p.product && o.segment === p.segment && o.exchange === p.exchange,
  );
}

/** A resting order (limit or stop) that may never fill: it is cancelled before a close, never counted on. */
const resting = (o: LiveOrder) => o.type !== "MARKET" && o.state === "placed";

/**
 * The unfilled part of MNHA's market orders still working at Groww that close
 * this position (any step, leg or source), and of any order whose outcome is
 * unknown. A close is never sized over it: a close stuck at Groww (an upper
 * circuit, say) may fill later, and a second one on top of it would turn the
 * close into a reversal.
 */
function reserved(orders: LiveOrder[], accountId: string, p: PosKey, closingSide: Side): number {
  return workingOn(orders, accountId, p, closingSide)
    .filter((o) => !resting(o))
    .reduce((n, o) => n + unfilled(o), 0);
}

/** Ask Groww again this long after a cancellation it has not carried out, up to CANCEL_TRIES times. */
const CANCEL_RETRY_MS = 20_000;
const CANCEL_TRIES = 3;

/**
 * Ask Groww to cancel one of MNHA's working orders (inside the account's lock):
 * at most CANCEL_TRIES times, CANCEL_RETRY_MS apart, until Groww reports it
 * final. Books the cancellation and tells the holder once. Returns whether a
 * request went out now.
 */
async function requestCancel(o: LiveOrder, why: string, by: "system" | "admin", force = false): Promise<boolean> {
  if (!o.orderId || o.final) return false;
  if ((await connectedNow(o.accountId)) !== true) return false; // no tries used up while it cannot be reached
  if (!force && o.cancelAt && (Date.now() - o.cancelAt < CANCEL_RETRY_MS || (o.cancelTries ?? 1) >= CANCEL_TRIES)) return false;
  const r = await cancelOrderAs(o.accountId, o.orderId, o.segment);
  const tries = (o.cancelTries ?? 0) + 1;
  await patchOrder(o.id, {
    cancelAt: Date.now(),
    cancelTries: tries,
    message: r.ok ? `${why}: cancellation sent.` : `${why}; the cancellation failed (${r.message ?? "no reason given"})${tries < CANCEL_TRIES ? " — trying again" : " — check it in Groww"}.`,
  });
  if (r.ok) {
    try {
      await appendOrder({
        userId: o.accountId, status: "cancelled", symbol: o.symbol, side: o.side, qty: o.qty, type: o.type, product: o.product,
        segment: o.segment, exchange: o.exchange, price: o.price, orderId: o.orderId, message: `Cancelled: ${why.toLowerCase()}`, by,
      });
    } catch (err) {
      console.error("[live] ledger append failed:", err instanceof Error ? err.message : err);
    }
    await tell(o.accountId, {
      tone: "neutral",
      title: "Order cancelled by MNHA",
      body: `${describe(o)} — ${ACTION_LABEL[o.action]}: ${why}, so MNHA cancelled it${o.filled ? `; the ${o.filled} that did fill stay` : ""}.`,
      key: `lt-${o.ref}-c`,
    });
  }
  return true;
}

/**
 * Cancel MNHA's resting orders (limit or stop) on this position in the closing
 * direction — an admin's take-profit, say — before it is closed at market: left
 * working, one could fill after the close and turn it into a reversal, and
 * counting it as if it will fill would leave the position open. Returns how
 * many are still working (wait for Groww to report them final, so their fills
 * are counted). Call it inside the account's lock.
 */
async function cancelResting(orders: LiveOrder[], accountId: string, p: PosKey, closingSide: Side, by: "system" | "admin"): Promise<number> {
  const rest = workingOn(orders, accountId, p, closingSide).filter(resting);
  for (const o of rest) await requestCancel(o, "Resting on a position being closed at market", by);
  return rest.length;
}

/*
 * Groww's positions can lag a fill by a moment. Two guards keep a close from
 * being sized off a reading taken too early:
 *  - activity: for QUIET_MS after any of our orders on a position is sent, or
 *    is seen filling, its reading is treated as not yet caught up;
 *  - expectation: for EXPECT_MS after we send a close, a reading still at (or
 *    only part of the way from) where the position was before it is stale.
 */
const QUIET_MS = 15_000;
const EXPECT_MS = 60_000;
const ge = globalThis as {
  __mnhaLiveExpect?: Map<string, { before: number; after: number; at: number }>;
  __mnhaLiveActivity?: Map<string, number>;
};
ge.__mnhaLiveExpect ??= new Map();
ge.__mnhaLiveActivity ??= new Map();
const expectations = ge.__mnhaLiveExpect;
const activity = ge.__mnhaLiveActivity;

type PosKey = { segment: "CASH" | "FNO"; exchange: string; symbol: string; product: string };
const posKey = (accountId: string, p: PosKey) => `${accountId}|${p.segment}|${p.exchange}|${p.symbol}|${p.product}`;
const keyOf = (o: LiveOrder): PosKey => ({ segment: o.segment, exchange: o.exchange, symbol: o.symbol, product: o.product });

function markActivity(accountId: string, p: PosKey): number {
  const at = Date.now();
  activity.set(posKey(accountId, p), at);
  return at;
}

/** Undo our own mark (an order that never reached the market) — not one something else set since. */
function clearActivity(accountId: string, p: PosKey, stamp: number): void {
  const k = posKey(accountId, p);
  if (activity.get(k) === stamp) activity.delete(k);
}

function readNet(accountId: string, p: PosKey, net: number): number | "stale" {
  const k = posKey(accountId, p);
  if (Date.now() - (activity.get(k) ?? 0) < QUIET_MS) return "stale";
  const e = expectations.get(k);
  if (!e) return net;
  if (Date.now() - e.at > EXPECT_MS) {
    expectations.delete(k);
    return net;
  }
  const partWay = e.before < e.after ? net >= e.before && net < e.after : net <= e.before && net > e.after;
  if (partWay) return "stale";
  expectations.delete(k);
  return net;
}

function expectAfter(accountId: string, p: PosKey, before: number, side: Side, qty: number): void {
  expectations.set(posKey(accountId, p), { before, after: before + (side === "BUY" ? qty : -qty), at: Date.now() });
}

function dropExpectation(accountId: string, p: PosKey): void {
  expectations.delete(posKey(accountId, p));
}

/** The strategy's position row in a CASH book: the symbol, intraday (MIS), on NSE. */
function strategyRow(positions: OpenPosition[], symbol: string): OpenPosition | undefined {
  const rows = positions.filter((p) => p.symbol === symbol && p.product === "MIS");
  return rows.find((p) => p.exchange === "NSE") ?? rows.find((p) => p.exchange === null);
}

/** offline: the account's Groww is disconnected (or its key unusable) — MNHA can no longer close anything there. */
export type CloseResult = "done" | "wait" | "sent" | "gave-up" | "unclear" | "offline";

/** Close attempts per step and account, and the gap between them. */
export const MAX_CLOSE_ATTEMPTS = 3;
const RETRY_GAP_MS = 12_000;

/**
 * Close what is left of one strategy leg in one account (market stop, flip
 * cover, 15:15 close). In live mode the quantity is Groww's live position in
 * the closing direction, less what MNHA closes still working at Groww may yet
 * fill, and never more than the leg may hold. Call it again until it answers
 * "done", "gave-up" or "unclear": it waits while an order is on its way, and
 * re-sends a close that failed, at most MAX_CLOSE_ATTEMPTS times per step.
 * `allow` is asked just before sending (the admin may have switched to Off).
 */
export async function closeLegIn(args: {
  day: number;
  action: OrderAction;
  leg: Leg;
  accountId: string;
  mode: "live" | "shadow";
  shadowPx?: number | null;
  allow?: (accountId: string) => Promise<boolean>;
  /** Told when part of the leg was already closed outside MNHA. */
  onOutside?: (closedOutside: number, symbol: string) => void;
}): Promise<CloseResult> {
  const { day, action, leg, accountId, mode } = args;
  return withAccountLock(accountId, async () => {
    const orders = await ordersOfDay(day);
    const st = legState(orders, accountId, leg, mode);
    if (!st.symbol || st.possible <= 0) return "done";
    const side: Side = leg === "short" ? "BUY" : "SELL";
    const tries = orders.filter((o) => o.accountId === accountId && o.action === action && o.mode === mode);
    const last = tries[tries.length - 1];
    if (last && working(last)) return "wait"; // this step's close is still on its way
    const key: PosKey = { segment: "CASH", exchange: "NSE", symbol: st.symbol, product: "MIS" };
    let qty: number;
    let before: number | null = null;
    if (mode === "shadow") {
      qty = st.open;
      if (qty <= 0) return "done";
    } else {
      const reach = await connectedNow(accountId);
      if (reach === false) return "offline";
      if (reach === "unknown") return "wait";
      // A resting order on the position is cancelled first; its fills count once Groww reports it final.
      if ((await cancelResting(orders, accountId, key, side, "system")) > 0) return "wait";
      const reserve = reserved(orders, accountId, key, side);
      const positions = await positionsAs(accountId, "CASH");
      if (!positions) return "wait";
      const row = strategyRow(positions, st.symbol);
      if (row && row.net === null) return "unclear";
      const net = readNet(accountId, key, row ? (row.net as number) : 0);
      if (net === "stale") return "wait";
      const room = leg === "short" ? Math.max(0, -net) : Math.max(0, net);
      const settled = reserve === 0 && !st.openWorking;
      if (settled && room < st.open) args.onOutside?.(st.open - room, st.symbol);
      qty = Math.min(st.possible, room - reserve);
      if (qty <= 0) return settled ? "done" : "wait";
      before = net;
    }
    if (tries.length >= MAX_CLOSE_ATTEMPTS) return "gave-up";
    if (last && Date.now() - last.updatedAt < RETRY_GAP_MS) return "wait";
    if (args.allow && !(await args.allow(accountId))) return "wait";
    const { id, ref } = strategyKey(day, action, accountId, tries.length);
    if (before !== null) expectAfter(accountId, key, before, side, qty);
    const o = await sendOrder({
      id,
      ref,
      day,
      source: "auto",
      mode,
      action,
      leg,
      batch: null,
      accountId,
      symbol: st.symbol,
      side,
      qty,
      product: "MIS",
      type: "MARKET",
      price: null,
      segment: "CASH",
      exchange: "NSE",
      shadowPx: args.shadowPx ?? null,
    });
    if (!o || o.state === "rejected" || o.state === "refused") dropExpectation(accountId, key);
    return "sent";
  });
}

/** The admin's cancel of one of MNHA's working orders (from Today's orders). Null: nothing to cancel. */
export async function cancelByAdmin(id: string): Promise<{ order: LiveOrder; sent: boolean } | null> {
  const first = await getOrder(id);
  if (!first) return null;
  return withAccountLock(first.accountId, async () => {
    const o = await getOrder(id);
    if (!o || !working(o) || !o.orderId) return null;
    const sent = await requestCancel(o, "Cancelled by the MNHA admin", "admin", true);
    if (!sent) await patchOrder(o.id, { message: `${o.message ? `${o.message} · ` : ""}Cancel not sent: this account's Groww cannot be reached.` });
    const order = await getOrder(id);
    return order ? { order, sent } : null;
  });
}

/** A strategy order opening a leg that has not filled in this long is cancelled: a market order
 *  stuck at a price band (a circuit) could otherwise fill at any later moment, even after 15:15. */
const STUCK_OPEN_MS = 60_000;

/**
 * Cancel today's strategy opening orders (09:20 entry, 10:15 flip buy) still
 * working a minute after they went out. Closing orders are never cancelled
 * here: a stuck close is left to work — getting out is the point. Each order is
 * asked once; its fills, if any, still count, and are closed as usual.
 */
export async function cancelStuckOpeners(day: number, onNote?: (text: string) => void): Promise<void> {
  const stuck = (await ordersOfDay(day)).filter(
    (o) =>
      o.source === "auto" && (o.action === "entry" || o.action === "flip-long") && o.mode === "live" && o.state === "placed" &&
      !o.final && o.orderId && Date.now() - (o.sentAt ?? o.at) > STUCK_OPEN_MS,
  );
  for (const s0 of stuck) {
    await withAccountLock(s0.accountId, async () => {
      const o = await getOrder(s0.id);
      if (!o) return;
      if (await requestCancel(o, `Not filled a minute after it went out (${o.filled ?? 0} of ${o.qty} so far)`, "system")) {
        onNote?.(`${o.symbol} ${ACTION_LABEL[o.action]}: not filled within a minute (${o.filled ?? 0} of ${o.qty}) — cancellation asked.`);
      }
    });
  }
}

/** Open a strategy leg in one account (09:20 entry, 10:15 flip long): once per day, never re-sent.
 *  `allow` is asked just before sending (the admin may have switched to Off). */
export async function openLegIn(args: {
  day: number;
  action: "entry" | "flip-long";
  leg: Leg;
  accountId: string;
  mode: "live" | "shadow";
  symbol: string;
  qty: number;
  shadowPx?: number | null;
  allow?: (accountId: string) => Promise<boolean>;
}): Promise<LiveOrder | null> {
  const { id, ref } = strategyKey(args.day, args.action, args.accountId, 0);
  return withAccountLock(args.accountId, async () => {
    if (args.allow && !(await args.allow(args.accountId))) return null;
    return sendOrder({
      id,
      ref,
      day: args.day,
      source: "auto",
      mode: args.mode,
      action: args.action,
      leg: args.leg,
      batch: null,
      accountId: args.accountId,
      symbol: args.symbol,
      side: args.leg === "short" ? "SELL" : "BUY",
      qty: args.qty,
      product: "MIS",
      type: "MARKET",
      price: null,
      segment: "CASH",
      exchange: "NSE",
      shadowPx: args.shadowPx ?? null,
    });
  });
}

/**
 * Why this account must not be deleted just now, or null. Until the session is
 * over (15:35 IST), an order MNHA sent today that is still working, or a
 * strategy position it may still hold, would be left with nobody watching it.
 */
/**
 * The deletion check, for the delete actions: inside the account's lock (so nothing is half-sent
 * across it), sends to the account are stopped and liveExposure decides. Held: the stop is lifted
 * at once. Passed: it stays while `run` (the erasure) goes, then this request's own mark is lifted —
 * the erasure keeps its own for good, or lifts it if the account could not be removed.
 */
export async function eraseIfClear<T>(accountId: string, run: () => Promise<T>): Promise<{ held: "open" | "unconfirmed" } | { done: T }> {
  let mark: symbol | null = null;
  const held = await withAccountLock(accountId, async () => {
    mark = markErasing(accountId);
    try {
      const ex = await liveExposure(accountId);
      if (ex) clearErasing(accountId, mark);
      return ex;
    } catch (err) {
      clearErasing(accountId, mark);
      throw err;
    }
  });
  if (held) return { held };
  try {
    return { done: await run() };
  } finally {
    if (mark) clearErasing(accountId, mark);
  }
}

/** Whether MNHA can still reach this account's Groww: the house key configured, or a member's key
 *  stored AND usable. "unknown" when the users file cannot be read — never taken as disconnected. */
async function connectedNow(accountId: string): Promise<boolean | "unknown"> {
  if (accountId === OWNER_ID) return houseConfigured();
  try {
    return (await getBroker(accountId)) !== null;
  } catch {
    return "unknown";
  }
}

/**
 * Whether this account must not be deleted just now: "open" — an order MNHA
 * sent today is still working, or a strategy position it opened is still open
 * at Groww; "unconfirmed" — Groww cannot be read to tell; null — go ahead.
 * After the session (15:35 IST), or once the account's Groww is disconnected
 * (MNHA can then neither watch nor close anything there), nothing is held.
 */
export async function liveExposure(accountId: string): Promise<"open" | "unconfirmed" | null> {
  const now = istNow();
  if (now.minute >= 15 * 60 + 35) return null; // intraday positions are squared off by then
  const reach = await connectedNow(accountId);
  if (reach === "unknown") return "unconfirmed"; // never let a read error wave a deletion through
  if (!reach) return null; // disconnected: MNHA can neither watch nor close anything there
  const mine = (await ordersOfDay(now.day)).filter((o) => o.accountId === accountId);
  // An order whose outcome is not known cannot be called open or closed.
  if (mine.some((o) => o.mode === "live" && (o.state === "sending" || o.state === "unknown"))) return "unconfirmed";
  if (mine.some(working)) return "open";
  for (const leg of ["short", "long"] as const) {
    const st = legState(mine, accountId, leg, "live");
    if (st.possible <= 0 || !st.symbol) continue;
    // Only if Groww agrees it is still open (the holder may have closed it in the Groww app) —
    // and not from a reading that may not have caught up with a fill yet.
    const positions = await positionsAs(accountId, "CASH");
    if (!positions) return "unconfirmed";
    const row = strategyRow(positions, st.symbol);
    const raw = row ? row.net : 0;
    if (raw === null) return "unconfirmed";
    const net = readNet(accountId, { segment: "CASH", exchange: "NSE", symbol: st.symbol, product: "MIS" }, raw);
    if (net === "stale") return "unconfirmed";
    if (leg === "short" ? net < 0 : net > 0) return "open";
  }
  return null;
}

/* --------------------------------------------------------- admin actions */

/** The same admin order this recently is a duplicate (a retried confirmation), whatever its size. */
export const DUPLICATE_MS = 15 * 60_000;

/**
 * The admin's orders of this kind (same symbol, side and product — in any size,
 * price or type, since a retry re-sized from the amount differs in quantity) to
 * this account that went out, or may have, since `since` — other than those of
 * `exceptBatch` and the ids in `ignore`. An order that ended with nothing done
 * (cancelled or rejected with no fill) is not counted.
 */
export function recentAdminSame(
  orders: LiveOrder[],
  accountId: string,
  spec: { symbol: string; side: Side; product: Product },
  opts: { since?: number; exceptBatch?: string | null; ignore?: string[] } = {},
): LiveOrder[] {
  const since = opts.since ?? Date.now() - DUPLICATE_MS;
  return orders.filter(
    (o) =>
      o.accountId === accountId && o.source === "admin" && o.action === "manual" && o.batch !== (opts.exceptBatch ?? null) &&
      o.symbol === spec.symbol && o.side === spec.side && o.product === spec.product &&
      ["placed", "unknown", "sending"].includes(o.state) && !nothingHappened(o) &&
      o.at >= since && !(opts.ignore ?? []).includes(o.id),
  );
}

/** Groww itself reported the order cancelled, rejected or failed with nothing filled. An order whose
 *  outcome was never learned (given up, or never found) is NOT "nothing": it may have filled. */
function nothingHappened(o: LiveOrder): boolean {
  return o.state === "placed" && o.final && (o.filled ?? 0) === 0 && /CANCEL|REJECT|FAIL/.test(o.status ?? "");
}

export type AdminSend = { order: LiveOrder } | { held: "duplicate" | "erasing" | "exists"; dup?: LiveOrder };

/**
 * The admin's order to one account (always real: shadow mode is for the
 * automatic strategy). The duplicate check is made here, inside the account's
 * lock, just before sending — so it sees how every earlier send to the account
 * ended, and two overlapping confirmations can never both send: held back when
 * an order of the same kind from another batch went to this account since
 * `since`, except the ones in `ignore` (those the admin was shown in the
 * preview and chose to send again).
 */
export async function adminOrderIn(args: {
  batch: string;
  day: number;
  accountId: string;
  symbol: string;
  side: Side;
  qty: number;
  product: Product;
  type: OrderType;
  price: number | null;
  since: number;
  ignore?: string[];
}): Promise<AdminSend> {
  const { id, ref } = adminKey(args.batch, args.accountId, "order");
  return withAccountLock(args.accountId, async () => {
    if (isErasing(args.accountId)) return { held: "erasing" as const };
    const dups = recentAdminSame(await ordersOfDay(args.day), args.accountId, args, { since: args.since, exceptBatch: args.batch, ignore: args.ignore });
    if (dups.length) return { held: "duplicate" as const, dup: dups[dups.length - 1] };
    const order = await sendOrder({
      id,
      ref,
      day: args.day,
      source: "admin",
      mode: "live",
      action: "manual",
      leg: null,
      batch: args.batch,
      accountId: args.accountId,
      symbol: args.symbol,
      side: args.side,
      qty: args.qty,
      product: args.product,
      type: args.type,
      price: args.price,
      segment: "CASH",
      exchange: "NSE",
    });
    return order ? { order } : { held: "exists" as const };
  });
}

/** How one open position would be closed, or why it is left alone. */
export interface ExitRow {
  symbol: string;
  segment: "CASH" | "FNO";
  exchange: "NSE" | "BSE" | null;
  product: Product | null;
  net: number | null;
  avg: number | null;
  side: Side | null;
  qty: number;
  skip: string | null;
}

/** What closing these positions takes, position by position (net 0 rows are already closed and left out). */
export function exitRows(positions: OpenPosition[], symbol: string | null): ExitRow[] {
  const out: ExitRow[] = [];
  for (const p of positions) {
    if (symbol && p.symbol !== symbol) continue;
    if (p.net === 0) continue;
    const row: ExitRow = { symbol: p.symbol, segment: p.segment, exchange: p.exchange, product: p.product, net: p.net, avg: p.avg, side: null, qty: 0, skip: null };
    if (p.net === null) row.skip = "Groww's quantities disagree about the direction: close it in Groww.";
    else if (p.product === null) row.skip = "A product this desk does not know: close it in Groww.";
    else if (p.exchange === null) row.skip = "Groww did not say which exchange: close it in Groww.";
    else if (p.product === "CNC" && p.net < 0) row.skip = "Shares sold from holdings today: nothing to close.";
    else if (p.segment === "CASH" && p.product === "NRML") row.skip = "Not an intraday or delivery position: close it in Groww.";
    else {
      row.side = p.net > 0 ? "SELL" : "BUY";
      row.qty = Math.abs(p.net);
    }
    out.push(row);
  }
  return out;
}

/** A position the admin saw in the exit preview, and how it was to be closed. */
export interface ExitPick {
  segment: "CASH" | "FNO";
  exchange: "NSE" | "BSE";
  symbol: string;
  product: Product;
  side: Side;
  qty: number;
}

export interface ExitOutcome {
  rows: ExitRow[];
  orders: LiveOrder[];
  error: string | null;
}

/**
 * Close open positions in one account at market: everything, or one symbol.
 * Sized from a fresh read of Groww's positions taken inside the account's
 * lock, so it never races the executor or another exit.
 */
export async function exitIn(args: { batch: string; day: number; accountId: string; symbol: string | null; picks?: ExitPick[] }): Promise<ExitOutcome> {
  const { batch, day, accountId, symbol, picks } = args;
  return withAccountLock(accountId, async () => {
    const [cash, fno] = await Promise.all([positionsAs(accountId, "CASH"), positionsAs(accountId, "FNO")]);
    if (!cash || !fno) return { rows: [], orders: [], error: "Groww's positions could not be read, so nothing was sent." };
    const rows = exitRows([...cash, ...fno], symbol);
    const orders: LiveOrder[] = [];
    const today = await ordersOfDay(day);
    for (const row of rows) {
      if (!row.side || row.skip || !row.product || !row.exchange || row.net === null) continue;
      const key: PosKey = { segment: row.segment, exchange: row.exchange, symbol: row.symbol, product: row.product };
      const net = readNet(accountId, key, row.net);
      if (net === "stale") {
        row.skip = "Groww's positions are still catching up with an order just sent or filled: try again in a few seconds.";
        continue;
      }
      // A resting MNHA order on it is cancelled first; the exit is then run again.
      if ((await cancelResting(today, accountId, key, row.side, "admin")) > 0) {
        row.skip = "MNHA's resting order on it is being cancelled first — press Exit again in a few seconds.";
        continue;
      }
      // Only what the admin saw in the preview, in the direction shown there, never more than shown.
      const pick = picks?.find((p) => p.segment === row.segment && p.exchange === row.exchange && p.symbol === row.symbol && p.product === row.product);
      if (picks && !pick) {
        row.skip = "Not in the preview you confirmed — preview again to include it.";
        continue;
      }
      if (pick && pick.side !== row.side) {
        row.skip = "Its direction changed since the preview — preview again.";
        continue;
      }
      // Never over an MNHA close of this position that is still working at Groww.
      const reserve = reserved(today, accountId, key, row.side);
      const qty = Math.min(pick ? pick.qty : Infinity, Math.abs(net) - reserve);
      if ((row.side === "SELL" ? net <= 0 : net >= 0) || qty <= 0) {
        row.skip = reserve > 0 ? "An MNHA order closing it is still working at Groww." : "Already closed.";
        continue;
      }
      row.qty = qty;
      // Closing a position the strategy holds counts toward that leg, so the
      // executor does not try to close it again.
      let leg: Leg | null = null;
      if (row.segment === "CASH" && row.product === "MIS" && row.exchange === "NSE") {
        for (const l of ["short", "long"] as const) {
          const st = legState(today, accountId, l, "live");
          if (st.symbol === row.symbol && st.open > 0 && row.side === (l === "short" ? "BUY" : "SELL")) leg = l;
        }
      }
      const { id, ref } = adminKey(batch, accountId, `${row.segment}:${row.exchange}:${row.symbol}:${row.product}`);
      expectAfter(accountId, key, net, row.side, row.qty);
      const o = await sendOrder({
        id,
        ref,
        day,
        source: "admin",
        mode: "live",
        action: "exit",
        leg,
        batch,
        accountId,
        symbol: row.symbol,
        side: row.side,
        qty: row.qty,
        product: row.product,
        type: "MARKET",
        price: null,
        segment: row.segment,
        exchange: row.exchange,
      });
      if (!o || o.state === "rejected" || o.state === "refused") dropExpectation(accountId, key);
      if (o) orders.push(o);
      else row.skip = "Already sent by this same exit.";
    }
    return { rows, orders, error: null };
  });
}

/** Every open position in one account, as the exit would treat it (read-only; for the preview). */
export async function previewExitIn(accountId: string, symbol: string | null): Promise<{ rows: ExitRow[]; error: string | null }> {
  const [cash, fno] = await Promise.all([positionsAs(accountId, "CASH"), positionsAs(accountId, "FNO")]);
  if (!cash || !fno) return { rows: [], error: "Groww's positions could not be read." };
  return { rows: exitRows([...cash, ...fno], symbol), error: null };
}
