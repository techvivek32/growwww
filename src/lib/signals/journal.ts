import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Side } from "./strategies";

/**
 * The live signal journal — every signal the engine has published, and what
 * actually happened to it. This is the "learning": outcomes are measured
 * against real prices (stop or target touched), never assumed, and the rolling
 * per-strategy hit rate that comes out of it is what ranks and filters the
 * board. A setup that stops paying stops being surfaced.
 *
 * Persisted like the watchlists — one JSON file, serialised writes, tmp+rename
 * so a crash never leaves half a record. No database for a single-account
 * terminal.
 */

export type SignalStatus = "open" | "won" | "lost" | "expired";

export interface JournalSignal {
  id: string;
  symbol: string;
  segment: "CASH" | "FNO";
  strategy: string;
  side: Side;
  interval: number;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  reason: string;
  createdAt: number;
  status: SignalStatus;
  resolvedAt?: number;
  exit?: number;
  /** realised R at resolution: +rr on target, −1 on stop. */
  r?: number;
}

interface Store {
  signals: JournalSignal[];
}

const FILE = process.env.SIGNAL_JOURNAL_FILE ?? path.join(process.cwd(), "data", "signals.json");
const MAX_SIGNALS = 4000;
/** An open signal that never hit either level is void after this many ms. */
const EXPIRE_MS = 5 * 24 * 3_600 * 1_000;

const g = globalThis as { __mnhaSignals?: { queue: Promise<unknown> } };
g.__mnhaSignals ??= { queue: Promise.resolve() };

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaSignals!.queue.then(job, job);
  g.__mnhaSignals!.queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<Store> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (!Array.isArray(parsed.signals)) return { signals: [] };
    return parsed;
  } catch {
    return { signals: [] };
  }
}

async function write(store: Store): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
}

export async function getSignals(): Promise<JournalSignal[]> {
  return (await read()).signals;
}

export async function openSignals(): Promise<JournalSignal[]> {
  return (await read()).signals.filter((s) => s.status === "open");
}

/**
 * Record a new signal, unless one for the same symbol+strategy+side is already
 * open — the engine re-fires the same pattern every scan and we do not want a
 * pile of duplicates for one move.
 */
export async function recordSignals(candidates: Omit<JournalSignal, "id" | "createdAt" | "status">[]): Promise<number> {
  return enqueue(async () => {
    const store = await read();
    const openKey = new Set(
      store.signals.filter((s) => s.status === "open").map((s) => `${s.symbol}|${s.strategy}|${s.side}`),
    );
    let added = 0;
    for (const c of candidates) {
      const key = `${c.symbol}|${c.strategy}|${c.side}`;
      if (openKey.has(key)) continue;
      openKey.add(key);
      store.signals.push({
        ...c,
        id: `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: Date.now(),
        status: "open",
      });
      added++;
    }
    if (store.signals.length > MAX_SIGNALS) {
      store.signals = store.signals.slice(-MAX_SIGNALS);
    }
    if (added) await write(store);
    return added;
  });
}

/**
 * Resolve open signals against the latest prices. A LONG wins when price has
 * reached its target, loses when it has reached its stop; SHORT mirrors it.
 * Signals older than the expiry window that never resolved are voided so a
 * stale entry cannot masquerade as still-working.
 */
export async function resolveSignals(prices: Record<string, number>): Promise<number> {
  return enqueue(async () => {
    const store = await read();
    const now = Date.now();
    let changed = 0;
    for (const s of store.signals) {
      if (s.status !== "open") continue;
      const px = prices[s.symbol];
      if (px === undefined) {
        if (now - s.createdAt > EXPIRE_MS) {
          s.status = "expired";
          s.resolvedAt = now;
          changed++;
        }
        continue;
      }
      const hitStop = s.side === "LONG" ? px <= s.stop : px >= s.stop;
      const hitTarget = s.side === "LONG" ? px >= s.target : px <= s.target;
      if (hitStop) {
        s.status = "lost";
        s.exit = s.stop;
        s.r = -1;
        s.resolvedAt = now;
        changed++;
      } else if (hitTarget) {
        s.status = "won";
        s.exit = s.target;
        s.r = s.rr;
        s.resolvedAt = now;
        changed++;
      } else if (now - s.createdAt > EXPIRE_MS) {
        s.status = "expired";
        s.resolvedAt = now;
        changed++;
      }
    }
    if (changed) await write(store);
    return changed;
  });
}

export interface LiveStat {
  strategy: string;
  resolved: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** mean realised R over resolved (won/lost) signals. */
  expectancy: number | null;
}

/** Rolling per-strategy performance from the journal's resolved signals. */
export function liveStats(signals: JournalSignal[]): Map<string, LiveStat> {
  const by = new Map<string, LiveStat>();
  for (const s of signals) {
    let st = by.get(s.strategy);
    if (!st) {
      st = { strategy: s.strategy, resolved: 0, open: 0, wins: 0, losses: 0, winRate: null, expectancy: null };
      by.set(s.strategy, st);
    }
    if (s.status === "open") st.open++;
    else if (s.status === "won") {
      st.resolved++;
      st.wins++;
    } else if (s.status === "lost") {
      st.resolved++;
      st.losses++;
    }
  }
  for (const s of signals) {
    if (s.status !== "won" && s.status !== "lost") continue;
    const st = by.get(s.strategy)!;
    st.expectancy = (st.expectancy ?? 0) + (s.r ?? 0);
  }
  for (const st of by.values()) {
    if (st.resolved > 0) {
      st.winRate = +((st.wins / st.resolved) * 100).toFixed(1);
      st.expectancy = +((st.expectancy ?? 0) / st.resolved).toFixed(3);
    } else {
      st.expectancy = null;
    }
  }
  return by;
}
