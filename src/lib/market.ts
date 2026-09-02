/**
 * NSE session clock. Everything is Asia/Kolkata — there are no extended
 * hours on NSE, so there is deliberately no pre/after-market concept here
 * beyond the 9:00-9:15 pre-open call auction.
 */

export type SessionPhase = "closed" | "pre-open" | "open" | "post";

export interface MarketState {
  phase: SessionPhase;
  label: string;
  /** IST wall clock, already formatted. */
  clock: string;
  /** e.g. "Wed, 2 Sep" */
  date: string;
  isLive: boolean;
}

const IST = "Asia/Kolkata";

function istParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    weekday: p.weekday as string,
    day: p.day as string,
    month: p.month as string,
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: p.second as string,
  };
}

export function marketState(now: Date = new Date()): MarketState {
  const p = istParts(now);
  const mins = p.hour * 60 + p.minute;
  const weekend = p.weekday === "Sat" || p.weekday === "Sun";

  const PRE_OPEN = 9 * 60;        // 09:00
  const OPEN = 9 * 60 + 15;       // 09:15
  const CLOSE = 15 * 60 + 30;     // 15:30

  let phase: SessionPhase = "closed";
  let label = "Market closed";

  if (!weekend) {
    if (mins >= PRE_OPEN && mins < OPEN) {
      phase = "pre-open";
      label = "Pre-open";
    } else if (mins >= OPEN && mins < CLOSE) {
      phase = "open";
      label = "Market open";
    } else if (mins >= CLOSE && mins < CLOSE + 60) {
      phase = "post";
      label = "Post-close";
    }
  }

  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");

  return {
    phase,
    label,
    clock: `${hh}:${mm}:${p.second} IST`,
    date: `${p.weekday}, ${p.day} ${p.month}`,
    isLive: phase === "open" || phase === "pre-open",
  };
}
