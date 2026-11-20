import "server-only";

/**
 * The research box's read-only API (research/mnha_research/api.py), with a
 * bearer token: /live, the paper-trading record of the intraday strategy, and
 * /live/today, the day's decisions the live executor trades. No order can be
 * placed through it, and nothing here writes to the box.
 */

export interface LivexLeg {
  day: number;
  leg: "short" | "flip_long";
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
}

export interface LivexReport {
  mark: LivexMark | null;
  marks_today: { minute: number; running_net: number | null; mkt_move: number | null; pick_ltp: number | null }[];
  sessions: Record<string, number>;
  skip_days: number;
  flip_days: number;
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

export interface LiveSummary {
  as_of: number;
  book: number;
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

/** One fetch per page view; the box updates three times a trading day, so a minute of caching is plenty. */
export async function liveSummary(): Promise<ResearchState> {
  const url = process.env.RESEARCH_API_URL;
  const token = process.env.RESEARCH_API_TOKEN;
  if (!url || !token) return { kind: "unconfigured" };
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/live`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 60 },
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
    };
  } catch {
    return null;
  }
}

/** IST day number (days since 1970-01-01 in IST) → ISO date. */
export function dayToIso(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}
