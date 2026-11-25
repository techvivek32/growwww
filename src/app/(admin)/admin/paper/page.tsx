import type { Metadata } from "next";
import LiveTicks from "./LiveTicks";
import Link from "next/link";
import { requireAdminPage } from "@/lib/access";
import { liveSummary, dayToIso, type LiveSummary, type LivexDay, type LivexLeg, type LivexMark, type LivexReport, type ManualTrade } from "@/lib/research";
import { Card, CardHead, Pill, StatTile } from "@/components/ui";

export const metadata: Metadata = { title: "Paper trading · MNHA Financials" };
export const dynamic = "force-dynamic";

const IST = "Asia/Kolkata";
const DAY_MON = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: IST });
const inr = (v: number) => `${v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
const pct = (v: number, d = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;
const fmtDay = (day: number) => DAY_MON.format(new Date(dayToIso(day)));
const WHY: Record<number, string> = { 0: "15:15 square-off", 5: "market stop", 6: "covered at 10:15 flip" };
const eyebrow = "font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase";
const th = "px-3 py-2 text-left font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase";
const td = "px-3 py-2 text-[12.5px] text-ink";

function statusOf(d: LivexDay): { text: string; tone: "up" | "down" | "warn" | "neutral" } {
  if (d.status === "no_session") return { text: "holiday", tone: "neutral" };
  if (d.skip) return { text: "skipped (regime)", tone: "neutral" };
  if (d.status === "decided") return { text: "short open", tone: "warn" };
  if (d.status === "flipped") return { text: d.flip ? "flipped long" : "holding short", tone: "warn" };
  return { text: "settled", tone: "up" };
}

/**
 * Live PAPER trading of the intraday strategy, read from the research box. No
 * order is ever sent: every figure here is what the rule would have earned on a
 * ₹5 lakh book at real market prices, after Groww charges and slippage.
 */
const PER_PAGE = 10;

export default async function PaperPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdminPage();
  const state = await liveSummary();
  const page = Math.max(1, Number((await searchParams).page ?? 1) || 1);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className={eyebrow}>Admin · Research</p>
          <h1 className="pub-display mt-1 text-[28px] leading-tight text-ink">Paper trading</h1>
          <p className="mt-1 max-w-[70ch] text-[13px] leading-snug text-ink3">
            The 2026 intraday rule, run every trading day on live Groww data with no orders: one stock shorted at 09:20 (full ₹5 lakh), a 0.5% market stop, a 10:15 flip into the top gainer on strong mornings, square-off at 15:15. Figures are after brokerage, charges and slippage.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <Link href="/admin/paper/report" className="text-[12.5px] font-semibold text-ink underline-offset-2 hover:underline">
            Daily report (PDF) →
          </Link>
          <Link href="/admin" className="text-[12.5px] text-ink2 underline-offset-2 hover:underline">
            ← Admin
          </Link>
        </div>
      </div>
      <LiveTicks every={1000} pageEvery={10000} />

      {state.kind === "unconfigured" && (
        <Card>
          <CardHead title="Not connected" sub="Set RESEARCH_API_URL and RESEARCH_API_TOKEN in the Vercel project to read the research box." />
        </Card>
      )}
      {state.kind === "error" && (
        <Card>
          <CardHead title="Research box unreachable" sub={state.message} />
        </Card>
      )}
      {state.kind === "ok" && <Body data={state.data} page={page} />}
    </div>
  );
}

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
/** Book A fills at the CLOSE of a 5-minute bar: bar 0 closes 09:20, bar b at 09:20 + 5b. */

/** The open paper position at the latest live mark, and the day's running P&L so far. */
function LiveNow({ mark, marks, settled, skip }: { mark: LivexMark | null; marks: LivexReport["marks_today"]; settled: boolean; skip: boolean }) {
  // Only while a trade is live. Once the day is settled (or skipped, or before 09:20) the card is empty: the
  // finished day lives in Day logs, and the next session's log starts with its own 09:20 decision.
  if (settled || skip || !mark) {
    return (
      <Card className="border-brand/40">
        <CardHead
          title="Live now"
          sub={settled
            ? "No trade available. Today's trades are settled; the next trade is taken at 09:20 on the next trading day, and its log starts here then."
            : skip
              ? "No trade available. Today was skipped by the regime filter; the next trade is taken at 09:20 on the next trading day."
              : "No trade available yet. The day's log starts here with the 09:20 decision and runs to the 15:15 square-off."}
          right={<Pill tone="neutral">no trade available</Pill>}
        />
      </Card>
    );
  }
  const running = mark.running_net ?? 0;
  const mkt = mark.mkt_move ?? 0;
  const stopDist = 0.005 - mkt; // the market stop covers the short once the average stock is up 0.5% since 09:20
  const shortOpen = mark.pick_pnl != null;
  return (
    <Card className="border-brand/40">
      <CardHead
        title="Live now"
        sub={`Marked at ${hhmm(mark.minute)} IST from Groww live prices (${mark.n_quotes} quotes). Before charges; the official result comes from the 15:15 settlement. Below: today's log from 09:20, every 30 seconds.`}
        right={<Pill tone={running >= 0 ? "up" : "down"}>{inr(running)} running</Pill>}
      />
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className={eyebrow}>{shortOpen ? "Short (open)" : "Short (covered)"}</dt>
          <dd className="mt-1 text-[15px] font-semibold text-ink">{mark.pick ?? "—"}</dd>
          <dd className="tnum text-[12px] text-ink3">entry {mark.pick_entry?.toFixed(2) ?? "—"} · now {mark.pick_ltp?.toFixed(2) ?? "—"} · {mark.pick_qty ?? "—"} sh</dd>
        </div>
        <div>
          <dt className={eyebrow}>Short P&L</dt>
          <dd className={`tnum mt-1 text-[15px] font-semibold ${(mark.pick_pnl ?? 0) >= 0 ? "text-up" : "text-down"}`}>{mark.pick_pnl == null ? "—" : inr(mark.pick_pnl)}</dd>
        </div>
        <div>
          <dt className={eyebrow}>Market since 09:20</dt>
          <dd className={`tnum mt-1 text-[15px] font-semibold ${mkt >= 0.005 ? "text-down" : "text-ink"}`}>{pct(mkt * 100)}</dd>
          <dd className="text-[12px] text-ink3">{mkt >= 0.005 ? "market stop level reached" : `stop at +0.50% (${pct(stopDist * 100)} away)`}</dd>
        </div>
        <div>
          <dt className={eyebrow}>Flip long</dt>
          <dd className="mt-1 text-[15px] font-semibold text-ink">{mark.flip_symbol ?? (mark.minute < 10 * 60 + 15 ? "check at 10:15" : "none today")}</dd>
          {mark.flip_symbol && (
            <dd className={`tnum text-[12px] ${(mark.flip_pnl ?? 0) >= 0 ? "text-up" : "text-down"}`}>
              {mark.flip_entry?.toFixed(2)} → {mark.flip_ltp?.toFixed(2)} · {mark.flip_pnl == null ? "—" : inr(mark.flip_pnl)}
            </dd>
          )}
        </div>
      </dl>
      {marks.length > 0 && (
        <div className="mt-4 max-h-[460px] overflow-auto rounded-md border border-line">
          <table className="w-full">
            <thead>
              <tr className="sticky top-0 border-b border-line bg-surface">
                <th className={th}>Time</th>
                <th className={`${th} text-right`}>Running P&L</th>
                <th className={`${th} text-right`}>Market since 09:20</th>
                <th className={`${th} text-right`}>Short LTP</th>
              </tr>
            </thead>
            <tbody>
              {[...marks].reverse().map((m) => (
                <tr key={m.minute} className="border-b border-line last:border-0">
                  <td className={td}>{hhmm(m.minute)}</td>
                  <td className={`${td} tnum text-right ${(m.running_net ?? 0) >= 0 ? "text-up" : "text-down"}`}>{m.running_net == null ? "—" : inr(m.running_net)}</td>
                  <td className={`${td} tnum text-right`}>{m.mkt_move == null ? "—" : pct(m.mkt_move * 100)}</td>
                  <td className={`${td} tnum text-right`}>{m.pick_ltp?.toFixed(2) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Body({ data, page }: { data: LiveSummary; page: number }) {
  const r = data.livex;
  const book = data.book;
  if (!r) {
    return (
      <Card>
        <CardHead title="No paper sessions yet" sub={data.livex_error ?? "The first pick is stored at 09:20 on the next trading day."} />
      </Card>
    );
  }
  const today = r.today;
  const days = [...r.days_all].sort((a, b) => b.day - a.day);
  const netByDay = new Map<number, number>();
  for (const t of r.trades) netByDay.set(t.day, (netByDay.get(t.day) ?? 0) + t.net);
  const legsByDay = new Map<number, LivexLeg[]>();
  for (const t of r.trades) legsByDay.set(t.day, [...(legsByDay.get(t.day) ?? []), t]);
  const manualByDay = new Map<string, ManualTrade[]>();
  for (const m of data.manual ?? []) manualByDay.set(m.day, [...(manualByDay.get(m.day) ?? []), m]);
  // days with only active/manual trades (no Book A record) still get a row
  for (const iso of manualByDay.keys()) {
    const n = Math.round((new Date(iso).getTime() - Date.UTC(1970, 0, 1)) / 86_400_000);
    if (!days.some((d) => d.day === n)) days.push({ day: n, status: "no_session", skip: 0, pick: null, pick_px: null, pick_ltp: null, flip: null, flip_symbol: null, flip_px: null, decided_at: null, settled_at: null });
  }
  days.sort((a, b) => b.day - a.day);
  const settled = days.filter((d) => d.status === "settled").length;
  const pages = Math.max(1, Math.ceil(days.length / PER_PAGE));
  const cur = Math.min(page, pages);
  const tone = r.net_rs > 0 ? "up" : r.net_rs < 0 ? "down" : "neutral";
  const ab = data.all_books;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {ab ? (
          <>
            <StatTile label="Net so far · all books" value={inr(ab.net_rs)} sub={`Book A ${inr(ab.book_a_rs)} · Active (auto) ${inr(ab.active_rs ?? 0)} · Manual (admin) ${inr(ab.manual_rs ?? 0)}${ab.today_open_day ? " · today's closed trades included" : ""}`} tone={ab.net_rs > 0 ? "up" : ab.net_rs < 0 ? "down" : "neutral"} />
            <StatTile label="Sessions" value={String(ab.sessions)} sub={`finished · ${r.skip_days} skipped · ${r.flip_days} flipped · ${ab.active_trades ?? 0} active (auto) · ${ab.manual_trades ?? 0} manual (admin) trades${ab.open_trades ? ` · ${ab.open_trades} open` : ""}`} />
            <StatTile label="Winning days" value={ab.win_rate == null ? "—" : `${Math.round(ab.win_rate * 100)}%`} sub="all books together" />
            <StatTile label="Worst day" value={ab.worst_day_rs == null ? "—" : inr(ab.worst_day_rs)} tone={ab.worst_day_rs != null && ab.worst_day_rs < 0 ? "down" : "neutral"} sub="all books together" />
            <StatTile label="Largest fall" value={ab.max_fall_rs == null ? "—" : inr(-ab.max_fall_rs)} sub="from the running peak, all books" />
          </>
        ) : (
          <>
            <StatTile label="Net so far" value={inr(r.net_rs)} sub={`${pct(r.pct_of_book)} of ₹${(book / 1e5).toFixed(0)} lakh`} tone={tone} />
            <StatTile label="Sessions" value={String(settled)} sub={`${r.skip_days} skipped · ${r.flip_days} flipped`} />
            <StatTile label="Winning days" value={r.day_win_rate == null ? "—" : `${Math.round(r.day_win_rate * 100)}%`} />
            <StatTile label="Worst day" value={r.worst_day_rs == null ? "—" : inr(r.worst_day_rs)} tone={r.worst_day_rs && r.worst_day_rs < 0 ? "down" : "neutral"} />
            <StatTile label="Largest fall" value={r.max_fall_rs == null ? "—" : inr(-(r.max_fall_rs ?? 0))} sub="from the running peak" />
          </>
        )}
      </div>

      {(data.manual_error || data.all_books_error) && (
        <p className="text-[12px] text-warn">Active and manual trades could not be read on this refresh ({data.manual_error ?? data.all_books_error}); the tiles show Book A only until the next refresh.</p>
      )}
      <LiveNow mark={r.mark ?? null} marks={r.marks_today ?? []} settled={today?.status === "settled"} skip={Boolean(today?.skip)} />

      <Card pad={false}>
        <div className="p-4 sm:p-5 pb-0 sm:pb-0">
          <CardHead title="Day by day" sub="Every session, newest first. Book A: the tested rule. Active (auto): the all-day scan book, trades the program took itself. Manual (admin): trades the admin asked for. Click a date for that day's full report." right={<span className="text-[12px] text-ink3">page {cur} of {pages}</span>} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-t border-line">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Day</th>
                <th className={th}>Status</th>
                <th className={th}>Book A</th>
                <th className={`${th} text-right`}>Book A net</th>
                <th className={th}>Active (auto)</th>
                <th className={`${th} text-right`}>Active net</th>
                <th className={th}>Manual (admin)</th>
                <th className={`${th} text-right`}>Manual net</th>
                <th className={`${th} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {days.length === 0 && (
                <tr>
                  <td className={`${td} text-ink3`} colSpan={9}>Nothing yet.</td>
                </tr>
              )}
              {days.slice((cur - 1) * PER_PAGE, cur * PER_PAGE).map((d) => {
                const legs = legsByDay.get(d.day) ?? [];
                const net = netByDay.get(d.day);
                const st = statusOf(d);
                const iso = dayToIso(d.day);
                const all = manualByDay.get(iso) ?? [];
                const act = all.filter((m) => m.book === "active");
                const man = all.filter((m) => m.book !== "active");
                const closedNet = (xs: ManualTrade[]) => xs.filter((m) => m.status === "closed").reduce((a, m) => a + (m.net ?? 0), 0);
                const aNet = closedNet(act);
                const mNet = closedNet(man);
                const total = (net ?? 0) + aNet + mNet;
                const list = (xs: ManualTrade[]) =>
                  xs.length === 0 ? "—" : xs.map((m) => `${m.side === "short" ? "SELL" : "BUY"} ${m.symbol} ${m.status === "closed" ? `${m.entry.toFixed(2)} → ${m.exit?.toFixed(2)}` : "(open)"}`).join(" · ");
                const netCell = (xs: ManualTrade[], v: number) => (
                  <td className={`${td} tnum text-right font-semibold ${xs.length === 0 ? "text-ink3" : v >= 0 ? "text-up" : "text-down"}`}>{xs.length === 0 ? "—" : inr(v)}</td>
                );
                const bookA = d.skip
                  ? "skipped (regime)"
                  : d.status === "no_session"
                    ? "no session"
                    : legs.length
                      ? legs.map((l) => `${l.side < 0 ? "SELL" : "BUY"} ${l.symbol} ${l.entry.toFixed(2)} → ${l.exit.toFixed(2)} (${WHY[l.why] ?? l.why})`).join(" · ")
                      : d.pick
                        ? `SELL ${d.pick} @ ${d.pick_px?.toFixed(2)} (open)`
                        : "—";
                return (
                  <tr key={d.day} className="border-b border-line last:border-0 align-top">
                    <td className={td}>
                      <Link href={`/admin/paper/logs?day=${iso}`} className="font-semibold text-ink underline-offset-2 hover:underline">{fmtDay(d.day)}</Link>
                    </td>
                    <td className={td}>
                      <Pill tone={st.tone}>{st.text}</Pill>
                    </td>
                    <td className={`${td} max-w-[40ch] text-ink2`}>{bookA}</td>
                    <td className={`${td} tnum text-right font-semibold ${net == null ? "text-ink3" : net >= 0 ? "text-up" : "text-down"}`}>
                      {net == null ? (d.skip ? "0" : "—") : inr(net)}
                    </td>
                    <td className={`${td} max-w-[36ch] text-ink2`}>{list(act)}</td>
                    {netCell(act, aNet)}
                    <td className={`${td} max-w-[30ch] text-ink2`}>{list(man)}</td>
                    {netCell(man, mNet)}
                    <td className={`${td} tnum text-right font-semibold ${total >= 0 ? "text-up" : "text-down"}`}>{inr(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[12px] sm:px-5">
          {cur > 1 ? <Link className="font-semibold text-ink underline-offset-2 hover:underline" href={`/admin/paper?page=${cur - 1}`}>← Newer</Link> : <span className="text-ink3">← Newer</span>}
          <span className="text-ink3">{days.length} days · {PER_PAGE} per page</span>
          {cur < pages ? <Link className="font-semibold text-ink underline-offset-2 hover:underline" href={`/admin/paper?page=${cur + 1}`}>Older →</Link> : <span className="text-ink3">Older →</span>}
        </div>
      </Card>
    </>
  );
}
