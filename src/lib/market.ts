/**
 * NSE session clock. Everything is Asia/Kolkata — there are no extended
 * hours on NSE, so there is deliberately no pre/after-market concept here
 * beyond the 9:00-9:15 pre-open call auction.
 */

export type SessionPhase = "closed" | "holiday" | "pre-open" | "open" | "post";

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

/**
 * NSE trading holidays that fall on weekdays (equity, equity derivatives and
 * SLB), from the exchange's published calendar. The calendar moves every year
 * (Holi, Diwali and the rest), so each year is added when NSE publishes it,
 * usually in mid-December, and a date is never guessed: an invented holiday
 * would be worse than an occasional "open" on a real one. The admin console
 * warns when the current year (or, from 15 December, the next) has no dates.
 */
const HOLIDAYS = new Set([
  "2026-01-15", // Maharashtra municipal elections (an unscheduled closure)
  "2026-01-26", // Republic Day
  "2026-03-03", // Holi
  "2026-03-26", // Shri Ram Navami
  "2026-03-31", // Shri Mahavir Jayanti
  "2026-04-03", // Good Friday
  "2026-04-14", // Dr. Baba Saheb Ambedkar Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-05-28", // Bakri Id
  "2026-06-26", // Muharram
  "2026-09-14", // Ganesh Chaturthi
  "2026-10-02", // Mahatma Gandhi Jayanti
  "2026-10-20", // Dussehra
  "2026-11-10", // Diwali Balipratipada
  "2026-11-24", // Prakash Gurpurb Sri Guru Nanak Dev
  "2026-12-25", // Christmas
]);

function istDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
}

/** 09:17–09:23 IST: the research server's paper books fetch the 09:15 bars for
 *  hundreds of symbols on the house Groww key from 09:20, so the website's bulk
 *  reads sit it out (from 09:17, so one started earlier is done by then). */
export function inOpeningBurst(now: Date = new Date()): boolean {
  const p = istParts(now);
  const mins = p.hour * 60 + p.minute;
  return mins >= 9 * 60 + 17 && mins < 9 * 60 + 23;
}

/** For the admin console: the holiday list needs the exchange's next calendar —
 *  the current year has no dates, or (from 15 December) the next year has none. */
export function holidayListNotice(now: Date = new Date()): string | null {
  const today = istDate(now); // YYYY-MM-DD
  const year = Number(today.slice(0, 4));
  const listed = (y: number) => Array.from(HOLIDAYS).some((d) => d.startsWith(`${y}-`));
  if (!listed(year)) {
    return `The NSE holiday list has no dates for ${year}. Add the exchange's ${year} trading holidays to src/lib/market.ts, or the site shows the market open on them.`;
  }
  if (today.slice(5) >= "12-15" && !listed(year + 1)) {
    return `NSE publishes its ${year + 1} trading holidays in December. Add them to src/lib/market.ts before 1 January.`;
  }
  return null;
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

  const holiday = HOLIDAYS.has(istDate(now));
  if (holiday && !weekend) {
    phase = "holiday";
    label = "Market holiday";
  }

  if (!weekend && !holiday) {
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
    isLive: phase === "open",
  };
}
