import "server-only";
import { OWNER_ID, isReservedId } from "@/lib/auth";
import { listUsers } from "@/lib/users";
import { tradePermission, type TradeDenial } from "@/lib/trading";
import { currentConsent } from "@/lib/consent";
import { fundsAs, houseConfigured } from "@/lib/api/broker";
import type { Funds } from "@/lib/api/groww";
import type { LiveSettings } from "./store";
import { inr, pool, sleep } from "./util";

/**
 * Which accounts live trading may use, and why not.
 *
 *  - eligible: Groww connected, orders can be sent from its address, the
 *    agreement signed, and at least the base value free (cash minus margin in use);
 *  - low: all of that, but less than the base value free;
 *  - blocked: something above is missing (said in `reason`);
 *  - excluded: kept out of the automatic strategy by the admin.
 *
 * There is no switch a client turns on: every connected account is in, as the
 * owner decided (clients sign up for this on paper), unless the admin keeps it out.
 */

export type AccountGroup = "eligible" | "low" | "blocked" | "excluded";

export interface TradingAccount {
  id: string;
  label: string;
  owner: boolean;
}

export interface AccountCheck extends TradingAccount {
  canSend: boolean;
  signed: boolean;
  agreement: string | null;
  excluded: boolean;
  funds: Funds | null;
  group: AccountGroup;
  reason: string | null;
  checkedAt: number;
}

const WHY_NOT: Record<TradeDenial, string> = {
  "not-signed-in": "Not a trading account.",
  "no-broker": "Groww is not connected.",
  "no-ip": "No static IP is registered on their Groww key.",
  "ip-mismatch": "The IP on their Groww key is not one this server can send orders from.",
  "no-server-ip": "This server has no order address configured.",
};

/** Every account live trading could use: the house account (when its key is configured) and every member with Groww connected. */
export async function tradingAccounts(): Promise<TradingAccount[]> {
  const out: TradingAccount[] = [];
  if (houseConfigured()) out.push({ id: OWNER_ID, label: "Owner · house account", owner: true });
  for (const u of await listUsers()) {
    if (u.hasBroker && !isReservedId(u.id)) out.push({ id: u.id, label: u.email, owner: false });
  }
  return out;
}

/** id → label, for notes and tables. */
export async function accountLabels(): Promise<Map<string, string>> {
  return new Map((await tradingAccounts()).map((a) => [a.id, a.label]));
}

interface Reading {
  at: number;
  /** A stand-in while the first reading is still on its way (pages only). */
  pending?: boolean;
  canSend: boolean;
  denial: TradeDenial | null;
  signed: boolean;
  agreement: string | null;
  funds: Funds | null;
}

// Recent readings, so the admin page does not read every account's cash from
// Groww on each render. The executor always asks for fresh ones.
const g = globalThis as { __mnhaLiveReadings?: Map<string, Reading>; __mnhaLiveReading?: Map<string, Promise<Reading>> };
g.__mnhaLiveReadings ??= new Map();
g.__mnhaLiveReading ??= new Map();
const readings = g.__mnhaLiveReadings;
/** Reads under way, one per account: callers share it instead of piling up calls on a slow broker. */
const reading = g.__mnhaLiveReading;

function readOnce(a: TradingAccount): Promise<Reading> {
  const running = reading.get(a.id);
  if (running) return running;
  const p = read(a)
    .then((r) => {
      readings.set(a.id, r);
      return r;
    })
    .finally(() => reading.delete(a.id));
  reading.set(a.id, p);
  return p;
}

async function read(a: TradingAccount): Promise<Reading> {
  const [perm, consent, funds] = await Promise.all([
    tradePermission(a.id),
    a.owner ? Promise.resolve(null) : currentConsent(a.id).catch(() => null),
    fundsAs(a.id),
  ]);
  return {
    at: Date.now(),
    canSend: perm.allowed,
    denial: perm.allowed ? null : (perm.reason ?? "no-broker"),
    signed: a.owner || consent !== null,
    agreement: consent?.agreementVersion ?? null,
    funds,
  };
}

function classify(a: TradingAccount, r: Reading, settings: LiveSettings): AccountCheck {
  const excluded = settings.excluded.includes(a.id);
  let group: AccountGroup = "eligible";
  let reason: string | null = null;
  if (excluded) {
    group = "excluded";
    reason = "Kept out of the automatic strategy by the admin.";
  } else if (r.pending) {
    group = "blocked";
    reason = "Still being read from Groww — refresh in a moment.";
  } else if (!r.canSend) {
    group = "blocked";
    reason = WHY_NOT[r.denial ?? "no-broker"];
  } else if (!r.signed) {
    group = "blocked";
    reason = "Has not signed the MNHA agreement.";
  } else if (!r.funds) {
    group = "blocked";
    reason = "Groww did not report this account's cash just now.";
  } else if (r.funds.free < settings.base) {
    group = "low";
    reason = `${inr(r.funds.free)} free, below the base value of ${inr(settings.base)}.`;
  }
  return {
    ...a,
    canSend: r.canSend,
    signed: r.signed,
    agreement: r.agreement,
    excluded,
    funds: r.funds,
    group,
    reason,
    checkedAt: r.at,
  };
}

/**
 * Check every account against the settings. `maxAgeMs`: reuse a reading that
 * young (0, the default, reads every account fresh from Groww). `budgetMs`
 * (pages): wait at most that long for a fresh reading — past it the last
 * reading stands in (or "not read yet"), and the read finishes in the background.
 */
export async function checkAccounts(
  settings: LiveSettings,
  opts: { maxAgeMs?: number; only?: string[]; budgetMs?: number } = {},
): Promise<AccountCheck[]> {
  const maxAge = opts.maxAgeMs ?? 0;
  let accounts = await tradingAccounts();
  if (opts.only) accounts = accounts.filter((a) => opts.only!.includes(a.id));
  // Forget readings of accounts that are gone (disconnected or erased).
  const ids = new Set(accounts.map((a) => a.id));
  if (!opts.only) for (const k of [...readings.keys()]) if (!ids.has(k)) readings.delete(k);
  return pool(accounts, opts.budgetMs ? 16 : 4, async (a) => {
    const hit = readings.get(a.id);
    if (hit && maxAge > 0 && Date.now() - hit.at < maxAge) return classify(a, hit, settings);
    const fresh = readOnce(a);
    if (!opts.budgetMs) return classify(a, await fresh, settings);
    const r = await Promise.race([fresh, sleep(opts.budgetMs).then(() => null)]);
    return classify(a, r ?? hit ?? { at: Date.now(), pending: true, canSend: false, denial: null, signed: false, agreement: null, funds: null }, settings);
  });
}

/**
 * Which of these accounts can take an order right now — Groww connected, sendable
 * from its address, agreement signed — without reading anything from Groww (the
 * admin's confirmations: fast, so the answer never waits on a slow broker).
 */
export async function canTakeOrders(ids: string[]): Promise<Map<string, string>> {
  const accounts = (await tradingAccounts()).filter((a) => ids.includes(a.id));
  const out = new Map<string, string>();
  await pool(accounts, 8, async (a) => {
    const [perm, consent] = await Promise.all([tradePermission(a.id), a.owner ? Promise.resolve(true) : currentConsent(a.id).then((c) => c !== null).catch(() => false)]);
    if (perm.allowed && consent) out.set(a.id, a.label);
  });
  return out;
}

/** Drop the cached readings (the admin's "Read again"). */
export function forgetReadings(): void {
  readings.clear();
}
