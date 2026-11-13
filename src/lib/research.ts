import "server-only";

/**
 * The research box's read-only API (research/mnha_research/api.py). Only its
 * /live summary is reachable from here, with a bearer token; it holds the
 * paper-trading record of the intraday strategy. No order can be placed
 * through it, and nothing here writes to the box.
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

/** The open paper position marked at Groww's live prices, written every 5 minutes during the session. */
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
  days_all: LivexDay[];
}

/** Book B: the same picks with a fixed 0.5% stop on every position, exits at the live price. */
export interface Sl05Trade {
  day: string;
  leg: string;
  symbol: string;
  entry: number;
  exit: number | null;
  why: string | null;
  net: number;
}

export interface Sl05Report {
  days: number;
  net_rs?: number;
  pct_of_book?: number;
  per_month_pct?: Record<string, number>;
  stopped_out_share?: number;
  worst_day_rs?: number;
  trades?: Sl05Trade[];
  today?: { leg: string; symbol: string; side: number; qty: number; entry: number; entry_at: number; exit: number | null; exit_at: number | null; why: string | null; net: number | null }[];
}

export interface LiveSummary {
  as_of: number;
  book: number;
  livex: LivexReport | null;
  livex_error?: string;
  sl05?: Sl05Report;
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

/** IST day number (days since 1970-01-01 in IST) → ISO date. */
export function dayToIso(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}
