import "server-only";
import { positionsAs } from "@/lib/api/broker";
import { canTakeOrders, tradingAccounts } from "./accounts";
import { exitRows, type ExitPick, type ExitRow } from "./orders";
import { pool, sleep } from "./util";

/**
 * Open positions of every connected account, for the admin's live view and its
 * Exit buttons. One reading per account is shared by every viewer and kept 2
 * seconds, so however many admin tabs poll, each account's Groww is read at
 * most once in that time — and not at all while nobody is looking.
 */

export interface AccountPositions {
  id: string;
  label: string;
  /** Orders (closes) can be sent to it now: Groww connected, sendable, agreement signed. */
  canExit: boolean;
  /** When these rows were read from Groww (null: never read yet). */
  at: number | null;
  rows: ExitRow[];
  /** The last reading failed (the rows are then the last good ones). */
  error: string | null;
}

interface Snap {
  at: number | null;
  tried: number;
  rows: ExitRow[];
  error: string | null;
}

const FRESH_MS = 2_000;
/** Which accounts can take orders changes rarely (no Groww call goes into it): looked at every 10 s. */
const SENDABLE_MS = 10_000;

const g = globalThis as {
  __mnhaLivePos?: { snaps: Map<string, Snap>; reading: Map<string, Promise<Snap>>; sendable: { at: number; ids: Map<string, string> } | null };
};
g.__mnhaLivePos ??= { snaps: new Map(), reading: new Map(), sendable: null };
const W = g.__mnhaLivePos;

async function sendableNow(ids: string[]): Promise<Map<string, string>> {
  if (W.sendable && Date.now() - W.sendable.at < SENDABLE_MS) return W.sendable.ids;
  const fresh = await canTakeOrders(ids);
  W.sendable = { at: Date.now(), ids: fresh };
  return fresh;
}

function readOnce(id: string): Promise<Snap> {
  const running = W.reading.get(id);
  if (running) return running;
  const p = (async (): Promise<Snap> => {
    const prev = W.snaps.get(id);
    const [cash, fno] = await Promise.all([positionsAs(id, "CASH"), positionsAs(id, "FNO")]);
    const snap: Snap =
      cash && fno
        ? { at: Date.now(), tried: Date.now(), rows: exitRows([...cash, ...fno], null), error: null }
        : { at: prev?.at ?? null, tried: Date.now(), rows: prev?.rows ?? [], error: "Groww's positions could not be read just now." };
    W.snaps.set(id, snap);
    return snap;
  })().finally(() => W.reading.delete(id));
  W.reading.set(id, p);
  return p;
}

/** One account's positions, read again if older than `maxAgeMs`. */
export async function positionsOf(id: string, maxAgeMs = FRESH_MS): Promise<Snap> {
  const hit = W.snaps.get(id);
  if (hit && Date.now() - hit.tried < maxAgeMs) return hit;
  return readOnce(id);
}

/**
 * Every connected account's positions. Readings older than 2 s are refreshed
 * (16 at a time); the answer waits at most `budgetMs` for them — past that the
 * last reading stands in and the refresh finishes for the next look.
 */
export async function watchPositions(budgetMs = 1_500): Promise<AccountPositions[]> {
  const accounts = await tradingAccounts();
  const ids = new Set(accounts.map((a) => a.id));
  for (const k of [...W.snaps.keys()]) if (!ids.has(k)) W.snaps.delete(k); // disconnected or erased
  const sendable = await sendableNow([...ids]);
  const deadline = sleep(budgetMs).then(() => null);
  const endAt = Date.now() + budgetMs;
  return pool(accounts, 16, async (a) => {
    // An account that cannot take orders is not read: nothing could be closed there from here.
    if (!sendable.has(a.id)) return { id: a.id, label: a.label, canExit: false, at: null, rows: [], error: null };
    const hit = W.snaps.get(a.id);
    let snap: Snap | null | undefined = hit && Date.now() - hit.tried < FRESH_MS ? hit : undefined;
    // Past the budget no new reading starts (the next look picks the account up), so at most 16 run.
    if (!snap && Date.now() < endAt) snap = await Promise.race([readOnce(a.id).catch(() => null), deadline]);
    const s = snap ?? hit ?? { at: null, tried: 0, rows: [], error: null };
    return { id: a.id, label: a.label, canExit: sendable.has(a.id), at: s.at, rows: s.rows, error: s.error };
  });
}

/** The rows an Exit would close, as picks (what the admin sees is all an Exit may close). */
export function picksOf(rows: ExitRow[]): ExitPick[] {
  return rows
    .filter((r) => r.side && !r.skip && r.product && r.exchange)
    .map((r) => ({ segment: r.segment, exchange: r.exchange as "NSE" | "BSE", symbol: r.symbol, product: r.product!, side: r.side!, qty: r.qty }));
}

/** Forget an account's reading (after an exit, so the next look reads Groww again). */
export function forgetPositions(id: string): void {
  W.snaps.delete(id);
}
