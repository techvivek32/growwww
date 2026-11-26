import "server-only";

/**
 * The research box's read-only API (research/mnha_research/api.py), with a
 * bearer token: /live, the paper-trading record of the intraday strategy, and
 * /live/today, the day's decisions the live executor trades. No order can be
 * placed through it, and nothing here writes to the box.
 */

export interface LivexLeg {
  day: number;
  leg: "short" | "flip_long" | "admin_long" | "admin_short";
  symbol: string;
  side: number;
  qty: number;
  entry: number;
  exit: number;
  entry_bar: number;
  exit_bar: number;
  why: number;
  gross: number;
  costs: number;
  net: number;
}

export interface LivexDay {
  day: number;
  status: string;
  skip: number | null;
  pick: string | null;
  pick_px: number | null;
  pick_ltp: number | null;
  flip: number | null;
  flip_symbol: string | null;
  flip_px: number | null;
  decided_at: number | null;
  settled_at: number | null;
  flags?: string | null;
}

/** The open paper position marked at Groww's live prices, written every 30 seconds by the session loop. */
export interface LivexMark {
  day: number;
  at: number;
  minute: number;
  phase: string;
  pick: string | null;
  pick_entry: number | null;
  pick_ltp: number | null;
  pick_qty: number | null;
  pick_pnl: number | null;
  mkt_move: number | null;
  flip_symbol: string | null;
  flip_entry: number | null;
  flip_ltp: number | null;
  flip_qty: number | null;
  flip_pnl: number | null;
  running_net: number | null;
  n_quotes: number;
  /** Book A's legs at this mark (from 26 Nov): realised ones at their cover price, open ones at the live price */
  legs?: LiveLeg[] | null;
}

export interface LiveLeg {
  leg: "short" | "flip_long" | "admin_long" | "admin_short";
  label: string;
  symbol: string;
  side: number;
  entry: number;
  qty: number;
  exit: number | null;
  closed: boolean;
  how: string | null;
  ltp: number | null;
  pnl: number | null;
}

export interface LivexReport {
  mark: LivexMark | null;
  marks_today: { minute: number; running_net: number | null; mkt_move: number | null; pick_ltp: number | null }[];
  /** today's recorded events (market stop, flip cover, the admin's hand) */
  events_today?: { kind: string; at: number; bar: number | null; value: number | null }[];
  sessions: Record<string, number>;
  skip_days: number;
  flip_days: number;
  /** sessions where the admin covered or reversed the short by hand (not counted as flips) */
  admin_days?: number;
  net_rs: number;
  pct_of_book: number;
  per_month_pct: Record<string, number>;
  day_win_rate: number | null;
  worst_day_rs: number | null;
  max_fall_rs: number | null;
  today: LivexDay | null;
  trades: LivexLeg[];
  /** Earliest IST day whose legs are in `trades` — older days exist in the record but are not served. */
  trades_from?: number | null;
  days_all: LivexDay[];
}

/** Book B: the same picks with a fixed 0.5% stop on every position, exits at the live price. */
export interface Sl05Trade {
  day: string;
  leg: string;
  symbol: string;
  side?: number;
  qty?: number;
  entry: number;
  entry_at?: number | null;
  exit: number | null;
  exit_at?: number | null;
  why: string | null;
  costs?: number | null;
  net: number;
}

export interface Sl05Report {
  days: number;
  /** Earliest IST day whose legs are in `trades` — older days exist in the record but are not served. */
  trades_from?: number | null;
  net_rs?: number;
  pct_of_book?: number;
  per_month_pct?: Record<string, number>;
  stopped_out_share?: number;
  worst_day_rs?: number;
  trades?: Sl05Trade[];
  today?: { leg: string; symbol: string; side: number; qty: number; entry: number; entry_at: number; exit: number | null; exit_at: number | null; why: string | null; costs?: number | null; net: number | null }[];
}

/** A manual paper trade the admin asked for, outside the tested rule; marked at the live price while open. */
export interface ManualTrade {
  day: string;
  book: string;
  side: "short" | "long";
  symbol: string;
  entry_time: string;
  ltp_at_entry: number;
  entry: number;
  qty: number;
  notional: number;
  stop: number;
  stop_rule: string;
  status: "open" | "closed";
  ltp?: number;
  running_pnl?: number;
  exit?: number;
  exit_time?: string;
  why?: string;
  gross?: number;
  costs?: number;
  net?: number;
}

/** Every paper book together, by session (Book A's settled days + the closed active and manual trades). */
export interface AllBooks {
  net_rs: number;
  book_a_rs: number;
  /** the automatic all-day scan book (entries are the program's) */
  active_rs: number;
  /** trades the admin asked for by hand */
  manual_rs: number;
  other_rs: number;
  /** finished sessions only (today joins once Book A has settled it) */
  sessions: number;
  /** today has closed active/manual trades but Book A has not settled yet */
  today_open_day?: boolean;
  active_trades: number;
  manual_trades: number;
  other_trades: number;
  open_trades: number;
  win_rate: number | null;
  worst_day_rs: number | null;
  max_fall_rs: number | null;
  days: { day: string; book_a: number; active: number; manual: number; other: number; total: number }[];
}

export interface LiveSummary {
  as_of: number;
  book: number;
  manual?: ManualTrade[];
  all_books?: AllBooks;
  all_books_error?: string;
  manual_error?: string;
  manual_mark_error?: string;
  livex: LivexReport | null;
  livex_error?: string;
  sl05?: Sl05Report;
  sl05_error?: string;
  live: unknown;
}

export type ResearchState =
  | { kind: "ok"; data: LiveSummary }
  | { kind: "unconfigured" }
  | { kind: "error"; message: string };

/** One fetch per page view, uncached: the paper page re-renders every 10 s during the session. */
export async function liveSummary(): Promise<ResearchState> {
  const url = process.env.RESEARCH_API_URL;
  const token = process.env.RESEARCH_API_TOKEN;
  if (!url || !token) return { kind: "unconfigured" };
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/live`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { kind: "error", message: `research box answered ${r.status}` };
    return { kind: "ok", data: (await r.json()) as LiveSummary };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Today's book A decisions as the research box recorded them (its /live/today):
 * the 09:20 pick, the 10:15 flip when it was decided live, and the market stop.
 * The website's live executor trades these in the eligible accounts.
 */
/** One active (auto) book trade, as the research engine recorded it. */
export interface ActiveTrade {
  symbol: string;
  side: "long" | "short";
  status: "open" | "closed";
  /** Epoch seconds. */
  entered_at: number;
  entry: number;
  exited_at: number | null;
  exit: number | null;
  why: string | null;
}

export interface LiveToday {
  as_of: number;
  /** IST day number (days since 1970-01-01 in IST). */
  day: number;
  date: string;
  minute: number;
  /** decided | flipped | settled | no_session, or null before 09:20. */
  status: string | null;
  skip: boolean | null;
  pick: string | null;
  /** The pick's 09:20 close. */
  pick_px: number | null;
  /** Epoch seconds. */
  decided_at: number | null;
  /** Decided after 09:35 (a replay): never traded. */
  late: boolean;
  flip: { at: number; do: boolean; symbol: string | null; px: number | null } | null;
  mstop: { at: number; bar: number | null; move: number | null } | null;
  /** The market-stop watcher's last completed check (its heartbeat): null before the first one. */
  mstop_check: { at: number; bar: number | null; move: number | null } | null;
  /** False when the research engine is a build without the watcher's heartbeat (older than this site). */
  has_watcher: boolean;
  settled_at: number | null;
  last_mark_at: number | null;
  book: number;
  mstop_at: number;
  /** The active (auto) book's trades today, in order (empty on an older research engine). */
  active: ActiveTrade[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Today's decisions, read fresh (never cached). null when the box cannot be read or answers nonsense. */
export async function liveToday(): Promise<LiveToday | null> {
  const url = process.env.RESEARCH_API_URL;
  const token = process.env.RESEARCH_API_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/live/today`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as Record<string, unknown>;
    if (!isNum(j.day) || !isNum(j.as_of) || typeof j.date !== "string") return null;
    const f = j.flip as Record<string, unknown> | null | undefined;
    const m = j.mstop as Record<string, unknown> | null | undefined;
    const c = j.mstop_check as Record<string, unknown> | null | undefined;
    return {
      as_of: j.as_of,
      day: j.day,
      date: j.date,
      minute: numOrNull(j.minute) ?? 0,
      status: strOrNull(j.status),
      skip: typeof j.skip === "boolean" ? j.skip : null,
      pick: strOrNull(j.pick),
      pick_px: numOrNull(j.pick_px),
      decided_at: numOrNull(j.decided_at),
      late: j.late === true,
      flip: f && isNum(f.at) && typeof f.do === "boolean" ? { at: f.at, do: f.do, symbol: strOrNull(f.symbol), px: numOrNull(f.px) } : null,
      mstop: m && isNum(m.at) ? { at: m.at, bar: numOrNull(m.bar), move: numOrNull(m.move) } : null,
      mstop_check: c && isNum(c.at) ? { at: c.at, bar: numOrNull(c.bar), move: numOrNull(c.move) } : null,
      has_watcher: "mstop_check" in j,
      settled_at: numOrNull(j.settled_at),
      last_mark_at: numOrNull(j.last_mark_at),
      book: numOrNull(j.book) ?? 500_000,
      mstop_at: numOrNull(j.mstop_at) ?? 0.005,
      active: Array.isArray(j.active)
        ? (j.active as Record<string, unknown>[])
            .filter((a) => a && typeof a.symbol === "string" && (a.side === "long" || a.side === "short") && (a.status === "open" || a.status === "closed") && isNum(a.entered_at) && isNum(a.entry))
            .map((a) => ({
              symbol: a.symbol as string,
              side: a.side as "long" | "short",
              status: a.status as "open" | "closed",
              entered_at: a.entered_at as number,
              entry: a.entry as number,
              exited_at: numOrNull(a.exited_at),
              exit: numOrNull(a.exit),
              why: strOrNull(a.why),
            }))
        : [],
    };
  } catch {
    return null;
  }
}

/** IST day number (days since 1970-01-01 in IST) → ISO date. */
export function dayToIso(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------ day-by-day logs */
export interface LogDayIndex {
  day: string;
  weekday: string;
  status: string | null;
  skip: boolean;
  book_a_net: number | null;
}

export interface LogLeg {
  leg: string;
  symbol: string;
  side: number;
  qty: number;
  entry: number;
  exit: number;
  entry_bar: number;
  exit_bar: number;
  entry_time: string | null;
  exit_time: string | null;
  exit_reason: string;
  gross: number;
  costs: number;
  net: number;
}

export interface LogBookA {
  status: string;
  skip: boolean;
  flags: Record<string, unknown>;
  model_year: number | null;
  n_rows: number | null;
  decided_at: string | null;
  pick: string | null;
  pick_px: number | null;
  flip: boolean | null;
  flip_symbol: string | null;
  flip_px: number | null;
  flip_at: string | null;
  settled_at: string | null;
  info: string | null;
  legs: LogLeg[];
  net: number | null;
}

export interface LogEvent {
  kind: string;
  time: string | null;
  bar: number | null;
  bar_time: string | null;
  value: number | null;
  info: Record<string, unknown>;
}

export interface LogBookBLeg {
  book: string;
  leg: string;
  symbol: string;
  side: number;
  qty: number;
  entry: number;
  entry_time: string | null;
  exit: number | null;
  exit_time: string | null;
  why: string | null;
  gross: number | null;
  costs: number | null;
  net: number | null;
}

export interface LogMark {
  minute: number;
  time: string;
  phase: string;
  pick_ltp: number | null;
  pick_pnl: number | null;
  mkt_move: number | null;
  flip_ltp: number | null;
  flip_pnl: number | null;
  running_net: number | null;
  n_quotes: number | null;
}

export interface DayLog {
  day: string;
  weekday: string;
  book_a: LogBookA | null;
  events: LogEvent[];
  book_b: LogBookBLeg[];
  trades: ManualTrade[];
  marks: LogMark[];
}

export type LogsState = { kind: "ok"; days: LogDayIndex[]; log: DayLog | null } | { kind: "unconfigured" } | { kind: "error"; message: string };

export async function dayLogs(day?: string): Promise<LogsState> {
  const url = process.env.RESEARCH_API_URL;
  const token = process.env.RESEARCH_API_TOKEN;
  if (!url || !token) return { kind: "unconfigured" };
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/live/logs${day ? `?day=${encodeURIComponent(day)}` : ""}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { kind: "error", message: `research box answered ${r.status}` };
    const j = (await r.json()) as { days: LogDayIndex[]; log: DayLog | null };
    return { kind: "ok", days: j.days, log: j.log };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
