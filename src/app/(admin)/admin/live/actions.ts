"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { currentUserId } from "@/lib/session";
import { ADMIN_ID } from "@/lib/auth";
import { clientIp } from "@/lib/clientIp";
import { rateLimit } from "@/lib/ratelimit";
import { logAdminAccess } from "@/lib/adminAccess";
import { houseLtp } from "@/lib/api/broker";
import { canTakeOrders, checkAccounts, forgetReadings, tradingAccounts } from "@/lib/liveTrading/accounts";
import { getSettings, ordersOfDay, setBase, setExcluded, setMode, MAX_BASE, MIN_BASE, type LiveMode, type LiveOrder } from "@/lib/liveTrading/store";
import { adminOrderIn, cancelByAdmin, DUPLICATE_MS, exitIn, previewExitIn, recentAdminSame, type ExitPick, type ExitRow } from "@/lib/liveTrading/orders";
import { clock, istNow, pool, sleep } from "@/lib/liveTrading/util";
import type { OrderType, Product, Side } from "@/lib/types";

/**
 * Live trading's admin actions. Each one re-checks that the caller is the
 * admin login; an order or exit to many accounts is a two-step act — a preview
 * kept on the server, then a confirmation that sends exactly that preview, once.
 */

async function requireAdmin(): Promise<boolean> {
  return (await currentUserId()) === ADMIN_ID;
}

const NOT_ADMIN = "Only the admin login can do this.";
const PATH = "/admin/live";

export interface Msg {
  ok?: string;
  error?: string;
}

/* --------------------------------------------------------------- settings */

export async function liveSetMode(_prev: Msg, form: FormData): Promise<Msg> {
  if (!(await requireAdmin())) return { error: NOT_ADMIN };
  // One switch: ON (real orders) or OFF. The page asks "are you sure?" before turning it on.
  const mode = String(form.get("mode") ?? "") as LiveMode;
  if (mode !== "off" && mode !== "live") return { error: "Turn automatic trading ON or OFF." };
  await setMode(mode, clientIp(await headers()));
  revalidatePath(PATH);
  return {
    ok:
      mode === "live"
        ? "Automatic trading is ON: real orders go to every eligible account from the strategy's next step."
        : "Automatic trading is OFF: nothing new is opened. A position the strategy already opened today is still closed (market stop, 10:15, 15:15) — to close everything now, use Exit below.",
  };
}

export async function liveSetBase(_prev: Msg, form: FormData): Promise<Msg> {
  if (!(await requireAdmin())) return { error: NOT_ADMIN };
  const base = Number(String(form.get("base") ?? "").replace(/[₹,\s]/g, ""));
  if (!Number.isInteger(base) || base < MIN_BASE || base > MAX_BASE) {
    return { error: `Enter whole rupees from ₹${MIN_BASE.toLocaleString("en-IN")} to ₹${MAX_BASE.toLocaleString("en-IN")}.` };
  }
  await setBase(base, clientIp(await headers()));
  revalidatePath(PATH);
  return { ok: `Trade size ₹${base.toLocaleString("en-IN")} per account — an account needs this much free to take part. From the next 09:20 trade.` };
}

export async function liveExclude(form: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const id = String(form.get("accountId") ?? "");
  const exclude = String(form.get("exclude") ?? "") === "1";
  const account = (await tradingAccounts()).find((a) => a.id === id);
  if (!account) return;
  await setExcluded(id, exclude, clientIp(await headers()));
  revalidatePath(PATH);
}

/** Cancel one of MNHA's working orders (Today's orders): logged as the admin's act in that client's account. */
export async function liveCancelOrder(form: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const ip = clientIp(await headers());
  const r = await cancelByAdmin(id);
  if (r?.sent) {
    const o = r.order;
    try {
      await logAdminAccess({ kind: "cancel", userId: o.accountId, ip, detail: `Live trading: cancel ${o.side} ${o.qty} ${o.symbol} · ${o.orderId ?? ""} · ${o.message ?? ""}` });
    } catch (err) {
      console.error("[admin-access] cancel not logged:", err instanceof Error ? err.message : err);
    }
  }
  revalidatePath(PATH);
}

export async function liveRefresh(): Promise<void> {
  if (!(await requireAdmin())) return;
  forgetReadings();
  revalidatePath(PATH);
}

/* ----------------------------------------------------------------- plans */

interface OrderSpec {
  symbol: string;
  side: Side;
  product: Product;
  type: OrderType;
  price: number | null;
  qty: number;
}
type Plan =
  /** flagged: per account, the ids of the same-kind orders the preview showed as already sent. */
  | { kind: "order"; at: number; spec: OrderSpec; accounts: string[]; flagged: Record<string, string[]> }
  /** picks: per account, exactly the positions the preview showed as to be closed. */
  | { kind: "exit"; at: number; symbol: string | null; accounts: string[]; picks: Record<string, ExitPick[]> };

const PLAN_TTL_MS = 10 * 60_000;
const gp = globalThis as { __mnhaLivePlans?: Map<string, Plan> };
gp.__mnhaLivePlans ??= new Map();
const plans = gp.__mnhaLivePlans;

function keepPlan(plan: Plan): string {
  for (const [k, p] of plans) if (Date.now() - p.at > PLAN_TTL_MS) plans.delete(k);
  const id = `b${randomBytes(8).toString("hex")}`;
  plans.set(id, plan);
  return id;
}

/** Take a plan out (once: a second confirmation of the same preview finds nothing). */
function takePlan(id: string, kind: Plan["kind"]): Plan | null {
  const p = plans.get(id);
  if (!p || p.kind !== kind) return null;
  plans.delete(id);
  return Date.now() - p.at > PLAN_TTL_MS ? null : p;
}

/** Accounts an admin order or exit may go to: Groww connected, orders sendable, agreement signed. */
async function sendable(ids: string[]): Promise<{ ok: Map<string, string>; refused: string[] }> {
  const ok = await canTakeOrders(ids);
  return { ok, refused: ids.filter((id) => !ok.has(id)) };
}

export interface SentRow {
  id: string;
  label: string;
  state: string;
  qty: number;
  symbol: string;
  side: string;
  message: string | null;
  orderId: string | null;
}

const sentRow = (label: string, o: LiveOrder): SentRow => ({
  id: o.accountId,
  label,
  state: o.state,
  qty: o.qty,
  symbol: o.symbol,
  side: o.side,
  message: o.message,
  orderId: o.orderId,
});

async function logBulk(kind: "bulk-order" | "bulk-exit", userId: string, detail: string, ip: string): Promise<void> {
  try {
    await logAdminAccess({ kind, userId, ip, detail });
  } catch (err) {
    console.error("[admin-access] bulk line not logged:", err instanceof Error ? err.message : err);
  }
}

/** How long a confirmation waits for its orders before answering (the rest go on in the background). */
const ANSWER_WITHIN_MS = 40_000;
/** Per account, the same kind of admin orders (symbol, side, product — any size) that went out since `since`. */
async function recentSame(spec: OrderSpec, accounts: string[], since?: number): Promise<Map<string, LiveOrder[]>> {
  const today = await ordersOfDay(istNow().day);
  const out = new Map<string, LiveOrder[]>();
  for (const id of accounts) {
    const hits = recentAdminSame(today, id, spec, { since });
    if (hits.length) out.set(id, hits);
  }
  return out;
}

/* ----------------------------------------------------------- bulk order */

export interface OrderPlanView {
  id: string;
  spec: OrderSpec;
  /** The price the value is worked out at. */
  px: number;
  value: number;
  rows: { id: string; label: string; free: number | null; note: string | null; dup: string | null }[];
  refused: string[];
}

export interface OrderFlowState {
  error?: string;
  /** The preview an error belongs to (shown only under that one). */
  errorFor?: string;
  plan?: OrderPlanView;
  done?: { planId: string; summary: string; rows: SentRow[]; pending: boolean };
}

const SYMBOL = /^[A-Z0-9&-]{1,30}$/;

export async function livePreviewOrder(_prev: OrderFlowState, form: FormData): Promise<OrderFlowState> {
  if (!(await requireAdmin())) return { error: NOT_ADMIN };
  if (!rateLimit("live-admin", 40, 60_000).ok) return { error: "Too many requests in a minute. Wait a moment." };
  const symbol = String(form.get("symbol") ?? "").trim().toUpperCase();
  const side = String(form.get("side") ?? "") as Side;
  const product = String(form.get("product") ?? "") as Product;
  const type = String(form.get("type") ?? "") as OrderType;
  const priceRaw = String(form.get("price") ?? "").trim();
  const qtyRaw = String(form.get("qty") ?? "").trim();
  const amountRaw = String(form.get("amount") ?? "").replace(/[₹,\s]/g, "");
  const ids = [...new Set(form.getAll("acct").map(String))];

  if (!SYMBOL.test(symbol)) return { error: "Enter an NSE trading symbol, e.g. TCS." };
  if (side !== "BUY" && side !== "SELL") return { error: "Pick Buy or Sell." };
  if (product !== "MIS" && product !== "CNC") return { error: "Pick Intraday (MIS) or Delivery (CNC)." };
  if (type !== "MARKET" && type !== "LIMIT") return { error: "Pick Market or Limit." };
  if (!ids.length) return { error: "Tick at least one account." };

  let price: number | null = null;
  if (type === "LIMIT") {
    price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) return { error: "A limit order needs its price." };
    price = Math.round(price * 100) / 100;
  }
  const live = (await houseLtp([symbol]))[symbol];
  const px = price ?? live;
  if (!px || !(px > 0)) return { error: `No live price for ${symbol} — check the symbol (NSE cash only).` };

  let qty: number;
  if (qtyRaw) {
    qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty < 1) return { error: "Quantity must be a whole number of at least 1." };
  } else {
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount per account, or a quantity." };
    qty = Math.floor(amount / (px * 1.003));
    if (qty < 1) return { error: `₹${amount.toLocaleString("en-IN")} does not buy one share of ${symbol} at ₹${px}.` };
  }
  const value = qty * px;
  if (value > MAX_BASE) return { error: `₹${Math.round(value).toLocaleString("en-IN")} per account is above the ₹${MAX_BASE.toLocaleString("en-IN")} limit for one order.` };

  const { ok, refused } = await sendable(ids);
  if (!ok.size) return { error: "None of the ticked accounts can take an order right now (see Accounts)." };
  // Cash is shown for information only: a slow broker never holds the preview up for long.
  const checks = await checkAccounts(await getSettings(), { maxAgeMs: 60_000, only: [...ok.keys()], budgetMs: 8_000 });
  const spec: OrderSpec = { symbol, side, product, type, price, qty };
  const dups = await recentSame(spec, [...ok.keys()]);
  const rows = [...ok.entries()].map(([id, label]) => {
    const free = checks.find((c) => c.id === id)?.funds?.free ?? null;
    const note =
      side === "BUY" && free !== null && free < (product === "CNC" ? value : value / 5)
        ? `Free ₹${Math.round(free).toLocaleString("en-IN")} may not cover it — Groww will refuse it if so.`
        : null;
    const list = dups.get(id) ?? [];
    const dup = list.length
      ? `${list.length === 1 ? "An order" : `${list.length} orders`} of this kind already went to this account: ${list
          .map((o) => `${o.side} ${o.qty.toLocaleString("en-IN")} at ${clock(istNow(o.at).minute)} (${o.status ? o.status.toLowerCase() : o.state})`)
          .join("; ")}.`
      : null;
    return { id, label, free, note, dup };
  });
  const flagged = Object.fromEntries([...dups.entries()].map(([acct, list]) => [acct, list.map((o) => o.id)]));
  const id = keepPlan({ kind: "order", at: Date.now(), spec, accounts: rows.map((r) => r.id), flagged });
  const names = new Map((await tradingAccounts()).map((a) => [a.id, a.label]));
  return { plan: { id, spec, px, value, rows, refused: refused.map((r) => names.get(r) ?? r) } };
}

export async function liveConfirmOrder(_prev: OrderFlowState, form: FormData): Promise<OrderFlowState> {
  const answerBy = Date.now() + ANSWER_WITHIN_MS;
  if (!(await requireAdmin())) return { error: NOT_ADMIN };
  const planId = String(form.get("planId") ?? "");
  const plan = takePlan(planId, "order");
  if (!plan || plan.kind !== "order") return { error: "This preview has expired or was already sent. Make a new one.", errorFor: planId };
  const again = String(form.get("again") ?? "") === "1";
  const ok = await canTakeOrders(plan.accounts);
  const day = istNow().day;
  const s = plan.spec;
  // The duplicate window runs from 15 minutes before the PREVIEW, so a duplicate the admin was shown
  // cannot age out before the click. The decision is made per account inside its lock, just before
  // sending (adminOrderIn), where every earlier send has finished: an order of the same kind held
  // back — unless the admin ticked "send it again", and then only the orders the preview showed are
  // overridden. One that Groww reports cancelled or rejected with nothing filled does not count.
  const since = Math.min(plan.at, Date.now()) - DUPLICATE_MS;
  const shown = (id: string) => plan.flagged[id] ?? [];
  const targets = [...ok.entries()];
  const ip = clientIp(await headers());
  const describeSpec = `${s.side} ${s.qty} ${s.symbol} ${s.product} ${s.type}${s.price != null ? ` @ ${s.price}` : ""}`;
  const tally = { held: 0, erasing: 0, exists: 0, errors: 0 };
  const run = pool(targets, 4, async ([accountId, label]) => {
    try {
      const r = await adminOrderIn({ batch: planId, day, accountId, symbol: s.symbol, side: s.side, qty: s.qty, product: s.product, type: s.type, price: s.price, since, ignore: again ? shown(accountId) : [] });
      if ("held" in r) {
        if (r.held === "duplicate") {
          tally.held++;
          await logBulk("bulk-order", accountId, `${describeSpec} · held back: ${r.dup ? `${r.dup.side} ${r.dup.qty} ${r.dup.symbol} already went to this account at ${clock(istNow(r.dup.at).minute)}` : "the same order already went to this account"}`, ip);
        } else if (r.held === "erasing") {
          tally.erasing++;
          await logBulk("bulk-order", accountId, `${describeSpec} · not sent: the account was being deleted`, ip);
        } else {
          tally.exists++;
        }
        return null;
      }
      const o = r.order;
      await logBulk("bulk-order", accountId, `${describeSpec} · ${o.state}${o.orderId ? ` · ${o.orderId}` : ""}`, ip);
      return sentRow(label, o);
    } catch (err) {
      // One account's failure never stops the others, nor hides what they did.
      tally.errors++;
      console.error(`[live] bulk order for ${accountId} failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  });
  // Answer within ANSWER_WITHIN_MS of the click; a big batch carries on in the background (see Today's orders).
  const rows = await Promise.race([run, sleep(Math.max(0, answerBy - Date.now())).then(() => undefined)]);
  revalidatePath(PATH);
  const skipped = plan.accounts.length - ok.size;
  const tail = (extraNotes: string) => `${extraNotes}${skipped ? `, ${skipped} skipped (no longer able to trade)` : ""}`;
  if (rows === undefined) {
    return { done: { planId, summary: `${s.side} ${s.qty.toLocaleString("en-IN")} ${s.symbol}: still sending to ${targets.length} account${targets.length === 1 ? "" : "s"}${tail("")} — results appear under Today's orders and in the admin access log.`, rows: [], pending: true } };
  }
  const sent = rows.filter((r): r is SentRow => r !== null);
  const by = (st: string) => sent.filter((r) => r.state === st).length;
  const notes = [
    tally.held ? `${tally.held} held back (the same order already went there)` : "",
    tally.erasing ? `${tally.erasing} not sent (being deleted at that moment)` : "",
    tally.exists ? `${tally.exists} already sent by this same confirmation` : "",
  ].filter(Boolean);
  return {
    done: {
      planId,
      summary: `${s.side} ${s.qty.toLocaleString("en-IN")} ${s.symbol}: ${by("placed")} placed, ${by("rejected")} rejected, ${by("unknown")} unknown, ${by("refused")} refused${tail(notes.length ? `, ${notes.join(", ")}` : "")}${tally.errors ? ` — and ${tally.errors} stopped with an error: some of those may have gone out; check Today's orders` : ""}.`,
      rows: sent,
      pending: false,
    },
  };
}

/* ------------------------------------------------------------------ exits */

export interface ExitPlanView {
  id: string;
  symbol: string | null;
  accounts: { id: string; label: string; rows: ExitRow[]; error: string | null }[];
  refused: string[];
}

export interface ExitFlowState {
  error?: string;
  /** The preview an error belongs to (shown only under that one). */
  errorFor?: string;
  plan?: ExitPlanView;
  done?: { planId: string; summary: string; pending: boolean; accounts: { id: string; label: string; error: string | null; skipped: ExitRow[]; sent: SentRow[] }[] };
}

const EXIT_PREVIEW_WITHIN_MS = 20_000;
const NOT_READ_IN_TIME = "Groww's positions were not read in time — left out of this exit; preview again to include it.";

export async function livePreviewExit(_prev: ExitFlowState, form: FormData): Promise<ExitFlowState> {
  if (!(await requireAdmin())) return { error: NOT_ADMIN };
  if (!rateLimit("live-admin", 40, 60_000).ok) return { error: "Too many requests in a minute. Wait a moment." };
  const scope = String(form.get("scope") ?? "all");
  const symbol = scope === "symbol" ? String(form.get("symbol") ?? "").trim().toUpperCase() : null;
  if (scope === "symbol" && (!symbol || !/^[A-Z0-9&-]{1,40}$/.test(symbol))) return { error: "Enter the symbol to close, exactly as Groww shows it." };
  const ids = [...new Set(form.getAll("acct").map(String))];
  if (!ids.length) return { error: "Tick at least one account." };
  const { ok, refused } = await sendable(ids);
  if (!ok.size) return { error: "None of the ticked accounts can send orders right now (see Accounts)." };
  // Up to 16 accounts are read side by side, all under one deadline so the preview answers in time
  // however many accounts are ticked: an account not read by then is shown so and left out.
  const endAt = Date.now() + EXIT_PREVIEW_WITHIN_MS;
  const late = sleep(EXIT_PREVIEW_WITHIN_MS).then(() => ({ rows: [] as ExitRow[], error: NOT_READ_IN_TIME }));
  const accounts = await pool([...ok.entries()], 16, async ([id, label]) => {
    if (Date.now() >= endAt) return { id, label, rows: [] as ExitRow[], error: NOT_READ_IN_TIME };
    const read = previewExitIn(id, symbol).catch(() => ({ rows: [] as ExitRow[], error: "Groww's positions could not be read." }));
    return { id, label, ...(await Promise.race([read, late])) };
  });
  // The confirmation closes only what this preview shows: an account whose positions could not be read is left out.
  const picks: Record<string, ExitPick[]> = {};
  for (const a of accounts) {
    if (a.error) continue;
    picks[a.id] = a.rows
      .filter((r) => r.side && !r.skip && r.product && r.exchange)
      .map((r) => ({ segment: r.segment, exchange: r.exchange as "NSE" | "BSE", symbol: r.symbol, product: r.product!, side: r.side!, qty: r.qty }));
  }
  const planId = keepPlan({ kind: "exit", at: Date.now(), symbol, accounts: Object.keys(picks), picks });
  const names = new Map((await tradingAccounts()).map((a) => [a.id, a.label]));
  return { plan: { id: planId, symbol, accounts, refused: refused.map((r) => names.get(r) ?? r) } };
}

export async function liveConfirmExit(_prev: ExitFlowState, form: FormData): Promise<ExitFlowState> {
  const answerBy = Date.now() + ANSWER_WITHIN_MS;
  if (!(await requireAdmin())) return { error: NOT_ADMIN };
  const planId = String(form.get("planId") ?? "");
  if (String(form.get("confirm") ?? "").trim().toUpperCase() !== "EXIT") return { error: "Type EXIT to close these positions.", errorFor: planId };
  const plan = takePlan(planId, "exit");
  if (!plan || plan.kind !== "exit") return { error: "This preview has expired or was already sent. Make a new one.", errorFor: planId };
  const ok = await canTakeOrders(plan.accounts);
  const day = istNow().day;
  const ip = clientIp(await headers());
  // Sized again from Groww's positions at this moment, inside each account's lock (see exitIn) —
  // so running it twice never closes twice.
  const run = pool([...ok.entries()], 4, async ([id, label]) => {
    try {
      const r = await exitIn({ batch: planId, day, accountId: id, symbol: plan.symbol, picks: plan.picks[id] ?? [] });
      for (const o of r.orders) {
        await logBulk("bulk-exit", id, `${o.side} ${o.qty} ${o.symbol} ${o.segment} ${o.product} MARKET (exit) · ${o.state}${o.orderId ? ` · ${o.orderId}` : ""}`, ip);
      }
      return { id, label, error: r.error, skipped: r.rows.filter((x) => x.skip), sent: r.orders.map((o) => sentRow(label, o)) };
    } catch (err) {
      // One account's failure never stops the others, nor hides what they did.
      console.error(`[live] exit for ${id} failed:`, err instanceof Error ? err.message : err);
      return { id, label, error: "Stopped with an error — some closes may have gone out; check Today's orders and its positions.", skipped: [], sent: [] };
    }
  });
  const accounts = await Promise.race([run, sleep(Math.max(0, answerBy - Date.now())).then(() => undefined)]);
  revalidatePath(PATH);
  if (accounts === undefined) {
    return { done: { planId, summary: `${plan.symbol ? `Exit ${plan.symbol}` : "Exit all"}: still closing in ${ok.size} account${ok.size === 1 ? "" : "s"} — results appear under Today's orders.`, pending: true, accounts: [] } };
  }
  const all = accounts.flatMap((a) => a.sent);
  const by = (st: string) => all.filter((r) => r.state === st).length;
  return {
    done: {
      planId,
      summary: `${plan.symbol ? `Exit ${plan.symbol}` : "Exit all"}: ${all.length} order${all.length === 1 ? "" : "s"} — ${by("placed")} placed, ${by("rejected")} rejected, ${by("unknown")} unknown, ${by("refused")} refused.`,
      pending: false,
      accounts,
    },
  };
}
