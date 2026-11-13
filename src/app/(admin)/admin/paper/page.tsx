import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/access";
import { liveSummary, dayToIso, type LiveSummary, type LivexDay, type LivexLeg } from "@/lib/research";
import { Card, CardHead, Pill, StatTile } from "@/components/ui";

export const metadata: Metadata = { title: "Paper trading · MNHA Financials" };
export const dynamic = "force-dynamic";

const IST = "Asia/Kolkata";
const DAY_MON = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: IST });
const TIME = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
const inr = (v: number) => `${v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
const pct = (v: number, d = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;
const fmtDay = (day: number) => DAY_MON.format(new Date(dayToIso(day)));
const fmtTime = (s: number | null) => (s ? TIME.format(new Date(s * 1000)) : "—");
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
export default async function PaperPage() {
  await requireAdminPage();
  const state = await liveSummary();

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
        <Link href="/admin" className="text-[12.5px] text-ink2 underline-offset-2 hover:underline">
          ← Admin
        </Link>
      </div>

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
      {state.kind === "ok" && <Body data={state.data} />}
    </div>
  );
}

function Body({ data }: { data: LiveSummary }) {
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
  const months = Object.entries(r.per_month_pct).sort(([a], [b]) => (a < b ? 1 : -1));
  const days = [...r.days_all].sort((a, b) => b.day - a.day);
  const netByDay = new Map<number, number>();
  for (const t of r.trades) netByDay.set(t.day, (netByDay.get(t.day) ?? 0) + t.net);
  const legsByDay = new Map<number, LivexLeg[]>();
  for (const t of r.trades) legsByDay.set(t.day, [...(legsByDay.get(t.day) ?? []), t]);
  const settled = days.filter((d) => d.status === "settled").length;
  const tone = r.net_rs > 0 ? "up" : r.net_rs < 0 ? "down" : "neutral";

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Net so far" value={inr(r.net_rs)} sub={`${pct(r.pct_of_book)} of ₹${(book / 1e5).toFixed(0)} lakh`} tone={tone} />
        <StatTile label="Sessions" value={String(settled)} sub={`${r.skip_days} skipped · ${r.flip_days} flipped`} />
        <StatTile label="Winning days" value={r.day_win_rate == null ? "—" : `${Math.round(r.day_win_rate * 100)}%`} />
        <StatTile label="Worst day" value={r.worst_day_rs == null ? "—" : inr(r.worst_day_rs)} tone={r.worst_day_rs && r.worst_day_rs < 0 ? "down" : "neutral"} />
        <StatTile label="Largest fall" value={r.max_fall_rs == null ? "—" : inr(-(r.max_fall_rs ?? 0))} sub="from the running peak" />
      </div>

      <Card>
        <CardHead
          title="Today"
          sub={today ? `${fmtDay(today.day)} · decided ${fmtTime(today.decided_at)}${today.settled_at ? ` · settled ${fmtTime(today.settled_at)}` : ""}` : "No decision stored yet today."}
          right={today ? <Pill tone={statusOf(today).tone}>{statusOf(today).text}</Pill> : undefined}
        />
        {today && !today.skip && today.status !== "no_session" && (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className={eyebrow}>Short</dt>
              <dd className="mt-1 text-[15px] font-semibold text-ink">{today.pick ?? "—"}</dd>
            </div>
            <div>
              <dt className={eyebrow}>09:20 price</dt>
              <dd className="tnum mt-1 text-[15px] text-ink">{today.pick_px?.toFixed(2) ?? "—"}</dd>
            </div>
            <div>
              <dt className={eyebrow}>10:15 flip</dt>
              <dd className="mt-1 text-[15px] text-ink">{today.flip ? `long ${today.flip_symbol} @ ${today.flip_px?.toFixed(2)}` : today.status === "decided" ? "pending" : "no flip"}</dd>
            </div>
            <div>
              <dt className={eyebrow}>Day result</dt>
              <dd className={`tnum mt-1 text-[15px] font-semibold ${(netByDay.get(today.day) ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                {today.status === "settled" ? inr(netByDay.get(today.day) ?? 0) : "after 15:15"}
              </dd>
            </div>
          </dl>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card pad={false}>
          <div className="p-4 sm:p-5 pb-0 sm:pb-0">
            <CardHead title="By month" sub="Net on the ₹5 lakh book, not compounded." />
          </div>
          <table className="w-full border-t border-line">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Month</th>
                <th className={`${th} text-right`}>Return</th>
                <th className={`${th} text-right`}>₹</th>
              </tr>
            </thead>
            <tbody>
              {months.length === 0 && (
                <tr>
                  <td className={`${td} text-ink3`} colSpan={3}>No settled session yet.</td>
                </tr>
              )}
              {months.map(([m, p]) => (
                <tr key={m} className="border-b border-line last:border-0">
                  <td className={td}>{m}</td>
                  <td className={`${td} tnum text-right font-semibold ${p >= 0 ? "text-up" : "text-down"}`}>{pct(p)}</td>
                  <td className={`${td} tnum text-right`}>{inr((p / 100) * book)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card pad={false}>
          <div className="p-4 sm:p-5 pb-0 sm:pb-0">
            <CardHead title="Day by day" sub="Every session: the pick, what happened, and the net result." />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-t border-line">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Day</th>
                  <th className={th}>Status</th>
                  <th className={th}>Short</th>
                  <th className={th}>Exit</th>
                  <th className={th}>Flip long</th>
                  <th className={`${th} text-right`}>Net</th>
                </tr>
              </thead>
              <tbody>
                {days.length === 0 && (
                  <tr>
                    <td className={`${td} text-ink3`} colSpan={6}>Nothing yet.</td>
                  </tr>
                )}
                {days.slice(0, 60).map((d) => {
                  const legs = legsByDay.get(d.day) ?? [];
                  const s = legs.find((l) => l.leg === "short");
                  const f = legs.find((l) => l.leg === "flip_long");
                  const net = netByDay.get(d.day);
                  const st = statusOf(d);
                  return (
                    <tr key={d.day} className="border-b border-line last:border-0">
                      <td className={td}>{fmtDay(d.day)}</td>
                      <td className={td}>
                        <Pill tone={st.tone}>{st.text}</Pill>
                      </td>
                      <td className={td}>{d.skip || d.status === "no_session" ? "—" : `${d.pick} @ ${d.pick_px?.toFixed(2)}`}</td>
                      <td className={`${td} text-ink2`}>{s ? `${s.exit.toFixed(2)} · ${WHY[s.why] ?? s.why}` : "—"}</td>
                      <td className={td}>{f ? `${f.symbol} ${f.entry.toFixed(2)} → ${f.exit.toFixed(2)}` : d.flip ? `${d.flip_symbol}` : "—"}</td>
                      <td className={`${td} tnum text-right font-semibold ${net == null ? "text-ink3" : net >= 0 ? "text-up" : "text-down"}`}>
                        {net == null ? (d.skip ? "0" : "—") : inr(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
