import "server-only";

/** The IST clock the strategy runs on, matching the research box (day numbers since 1970-01-01 in IST). */
export interface IstNow {
  ms: number;
  day: number;
  /** YYYY-MM-DD */
  date: string;
  /** Minutes since IST midnight, with the seconds as a fraction. */
  minute: number;
}

const IST_S = 19_800;

export function istNow(ms: number = Date.now()): IstNow {
  const s = ms / 1000 + IST_S;
  const day = Math.floor(s / 86_400);
  return { ms, day, date: new Date(day * 86_400_000).toISOString().slice(0, 10), minute: (s - day * 86_400) / 60 };
}

/** IST minute-of-day of an epoch time in SECONDS (the research box's timestamps). */
export function istMinuteOfEpoch(epochS: number): number {
  const s = epochS + IST_S;
  return (s - Math.floor(s / 86_400) * 86_400) / 60;
}

/** hh:mm[:ss] as minutes since midnight. */
export const hm = (h: number, m: number, s = 0): number => h * 60 + m + s / 60;

/** "09:20" for a minute-of-day. */
export function clock(minute: number): string {
  const m = Math.floor(minute);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run `run` over `items`, at most `size` at a time, keeping the order of the results. */
export async function pool<T, R>(items: T[], size: number, run: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await run(items[i], i);
      }
    }),
  );
  return out;
}

/*
 * One account at a time. Every live-trading order goes through this lock for
 * its account, so the executor and an admin action can never both read the
 * same position and both close it — that would turn a close into a reversal.
 * Process-wide (globalThis): the boot hook and the pages are separate bundles.
 */
const g = globalThis as { __mnhaLiveLocks?: Map<string, Promise<unknown>> };
g.__mnhaLiveLocks ??= new Map();

export function withAccountLock<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const locks = g.__mnhaLiveLocks!;
  const prev = locks.get(accountId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  locks.set(accountId, tail);
  void tail.then(() => {
    if (locks.get(accountId) === tail) locks.delete(accountId);
  });
  return run;
}

export const inr = (v: number): string => `₹${Math.round(v).toLocaleString("en-IN")}`;
