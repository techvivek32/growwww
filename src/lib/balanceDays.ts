import type { BalanceReading } from "./api/groww";
import { isTradingDate } from "./market";

/**
 * The pure half of lib/balances: IST time and the day-by-day working-out, with no file or network
 * access, so it can be tested on its own (scripts/test-balances.cjs).
 */

export type ReadingWhy = "watch" | "linked" | "seed";

export interface BalanceRow extends BalanceReading {
  userId: string;
  at: number;
  why: ReadingWhy;
  /** Only on a "seed" row: where its figure comes from. */
  note?: string;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const IST_OFFSET = 330 * MINUTE;

/* ------------------------------------------------------------------ IST time */

/** IST calendar date `YYYY-MM-DD` of an instant. */
export function istDate(at: number): string {
  return new Date(at + IST_OFFSET).toISOString().slice(0, 10);
}
/** IST minute of the day of an instant. */
export function istMinute(at: number): number {
  return Math.floor(((at + IST_OFFSET) % DAY) / MINUTE);
}
/** The instant of the 15:30 IST close on a date. */
function closeOf(date: string): number {
  return Date.parse(`${date}T15:30:00+05:30`);
}
function nextTradingDate(date: string): string {
  let t = Date.parse(`${date}T12:00:00Z`);
  for (let i = 0; i < 15; i++) {
    t += DAY;
    const d = new Date(t).toISOString().slice(0, 10);
    if (isTradingDate(d)) return d;
  }
  return new Date(t).toISOString().slice(0, 10);
}
/** Which part of an IST day an instant falls in: before the open, the session, after the close. */
export function windowOf(at: number): string {
  const m = istMinute(at);
  return `${istDate(at)}:${m < 9 * 60 + 15 ? "am" : m < 15 * 60 + 30 ? "mkt" : "pm"}`;
}

/* ------------------------------------------------------------------ the days */

export interface DayLine {
  /** IST trading date. */
  date: string;
  /** Clear cash the day started with (in effect at its close, before Groww settled it); null: no reading. */
  start: number | null;
  /** Clear cash after Groww settled the day; null: not settled yet, or no reading. */
  end: number | null;
  /** end − start. */
  pnl: number | null;
  /** Groww's realised P&L for the day, before charges: the last reading of the day. */
  realised: number | null;
  /** How much more the balance rose than the day's trades made (pnl − realised), when it did. Charges
   *  only take away, so trading alone cannot do that: it is money paid in (a deposit), or a settlement
   *  that is not this day's. null: nothing unexplained, or nothing to compare. */
  unexplained: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Below this, a rise above the realised P&L is rounding, not money paid in. */
const UNEXPLAINED_FROM = 1;

/**
 * The owner's share of one day: `pct` of a profit day, nothing on a loss day. When the balance rose more
 * than the trades made (see `unexplained`), only the trades' part is shared: money paid in is not profit.
 * Groww's realised figure is before charges, so on such a day the share can be a little high, never
 * inflated by a deposit.
 */
export function dayShare(line: DayLine, pct: number): number {
  if (line.pnl === null || line.pnl <= 0) return 0;
  const basis = line.unexplained !== null && line.realised !== null ? Math.min(line.pnl, line.realised) : line.pnl;
  return basis > 0 ? round2((basis * pct) / 100) : 0;
}

/** The trading days covered by these readings (oldest first in, latest first out). */
export function dayLines(rows: BalanceRow[], now = Date.now()): DayLine[] {
  if (!rows.length) return [];
  const cashAt = (t: number): number | null => {
    let v: number | null = null;
    for (const r of rows) {
      if (r.at > t) break;
      v = r.cash;
    }
    return v;
  };
  const today = istDate(now);
  const out: DayLine[] = [];
  for (let d = istDate(rows[0].at); d <= today; d = new Date(Date.parse(`${d}T12:00:00Z`) + DAY).toISOString().slice(0, 10)) {
    if (!isTradingDate(d)) continue;
    const start = cashAt(closeOf(d));
    const next = nextTradingDate(d);
    let end: number | null;
    if (now >= closeOf(next)) end = cashAt(closeOf(next));
    else {
      // Not past the next close yet: settled only if the balance has already moved.
      const latest = cashAt(now);
      end = latest !== null && start !== null && latest !== start ? latest : null;
    }
    const ofDay = rows.filter((r) => istDate(r.at) === d && r.realised !== null);
    const afterClose = ofDay.filter((r) => r.at >= closeOf(d));
    const pick = afterClose.length ? afterClose : ofDay;
    const realised = pick.length ? pick[pick.length - 1].realised : null;
    const pnl = start !== null && end !== null ? round2(end - start) : null;
    const gap = pnl !== null && realised !== null ? round2(pnl - realised) : null;
    out.push({ date: d, start, end, pnl, realised, unexplained: gap !== null && gap >= UNEXPLAINED_FROM ? gap : null });
  }
  return out.reverse();
}
