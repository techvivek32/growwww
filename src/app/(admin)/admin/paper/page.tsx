import type { Metadata } from "next";
import ManualExit from "./ManualExit";
import LiveTicks from "./LiveTicks";
import Link from "next/link";
import { requireAdminPage } from "@/lib/access";
import { liveSummary, dayToIso, type LiveSummary, type LivexDay, type LivexLeg, type LivexMark, type LivexReport } from "@/lib/research";
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
      {state.kind === "ok" && <Body data={state.data} />}
    </div>
  );
}

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
/** Book A fills at the CLOSE of a 5-minute bar: bar 0 closes 09:20, bar b at 09:20 + 5b. */
const barTime = (b: number) => hhmm(9 * 60 + 20 + 5 * b);

/** The open paper position at the latest live mark, and the day's running P&L so far. */
function LiveNow({ mark, marks }: { mark: LivexMark; marks: LivexReport["marks_today"] }) {
  const running = mark.running_net ?? 0;
  const mkt = mark.mkt_move ?? 0;
  const stopDist = 0.005 - mkt; // the market stop covers the short once the average stock is up 0.5% since 09:20
  const shortOpen = mark.pick_pnl != null;
  return (
    <Card className="border-brand/40">
      <CardHead
        title="Live now"
        sub={`Marked at ${hhmm(mark.minute)} IST from Groww live prices (${mark.n_quotes} quotes). Before charges; the official result comes from the 15:15 settlement.`}
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
      {marks.length > 1 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Time</th>
                <th className={`${th} text-right`}>Running P&L</th>
                <th className={`${th} text-right`}>Market since 09:20</th>
                <th className={`${th} text-right`}>Short LTP</th>
              </tr>
            </thead>
            <tbody>
              {[...marks].reverse().slice(0, 12).map((m) => (
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

      {r.mark && today && today.status !== "settled" && <LiveNow mark={r.mark} marks={r.marks_today} />}

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

      {data.manual && data.manual.length > 0 && (
        <Card className="border-warn/40">
          <CardHead
            title="Active & manual paper trades"
            sub="Active: the all-day scan-and-rotate book (one position at a time, trailing 0.8% stop, exits on a VWAP cross or when the market turns, at most 4 trades a day; the admin's idea, not backtested). Manual: trades the admin asked for by hand. Paper only; marked at the live price while open; Exit closes one at the live price. Not part of Book A or Book B."
            right={<Pill tone="warn">manual</Pill>}
          />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Day</th><th className={th}>Trade</th><th className={`${th} text-right`}>Entry</th><th className={`${th} text-right`}>Stop</th>
                  <th className={`${th} text-right`}>Now / Exit</th><th className={th}>Status</th><th className={`${th} text-right`}>P&L</th><th className={th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.manual.map((m) => {
                  const pnl = m.status === "closed" ? (m.net ?? 0) : (m.running_pnl ?? 0);
                  return (
                    <tr key={`${m.day}-${m.symbol}-${m.entry_time}`} className="border-b border-line last:border-0">
                      <td className={td}>{m.day}</td>
                      <td className={td}><span className="font-mono text-[10px] tracking-[0.06em] text-ink3 uppercase">{m.book === "active" ? "active" : "manual"}</span> <span className={`font-semibold ${m.side === "short" ? "text-down" : "text-up"}`}>{m.side === "short" ? "SELL" : "BUY"}</span> {m.qty} {m.symbol}</td>
                      <td className={`${td} tnum text-right`}>{m.entry.toFixed(2)} <span className="text-ink3">{m.entry_time.slice(0, 5)}</span></td>
                      <td className={`${td} tnum text-right`}>{m.stop.toFixed(2)}</td>
                      <td className={`${td} tnum text-right`}>{m.status === "closed" ? `${m.exit?.toFixed(2)} ${m.exit_time?.slice(0, 5) ?? ""}` : (m.ltp?.toFixed(2) ?? "—")}</td>
                      <td className={td}><Pill tone={m.status === "closed" ? "neutral" : "warn"}>{m.status === "closed" ? (m.why ?? "closed") : "open"}</Pill></td>
                      <td className={`${td} tnum text-right font-semibold ${pnl >= 0 ? "text-up" : "text-down"}`}>{inr(pnl)}{m.status === "open" ? " (running)" : ""}</td>
                      <td className={td}>{m.status === "open" ? <ManualExit symbol={m.symbol} entryTime={m.entry_time} /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHead
          title="Book B: fixed 0.5% stop"
          sub="The same picks, but every position is closed at the live price the moment it is 0.5% against us; no profit target. Book A above is the strategy as tested."
          right={
            data.sl05 && data.sl05.days > 0 ? (
              <Pill tone={(data.sl05.net_rs ?? 0) >= 0 ? "up" : "down"}>
                {inr(data.sl05.net_rs ?? 0)} · {pct(data.sl05.pct_of_book ?? 0)}
              </Pill>
            ) : undefined
          }
        />
        {data.sl05?.today && data.sl05.today.length > 0 && (
          <ul className="mb-3 space-y-1 text-[12.5px] text-ink">
            {data.sl05.today.map((t) => (
              <li key={t.leg}>
                <span className="font-semibold">{t.side < 0 ? "Short" : "Long"} {t.symbol}</span> · entry {t.entry.toFixed(2)} ({t.qty} sh)
                {t.exit ? ` · exit ${t.exit.toFixed(2)} at ${fmtTime(t.exit_at)} (${t.why}) · ${inr(t.net ?? 0)}` : " · open, stop at " + (t.side < 0 ? (t.entry * 1.005).toFixed(2) : (t.entry * 0.995).toFixed(2))}
              </li>
            ))}
          </ul>
        )}
        {data.sl05 && data.sl05.days > 0 ? (
          <p className="text-[12.5px] text-ink3">
            {data.sl05.days} sessions · {Math.round((data.sl05.stopped_out_share ?? 0) * 100)}% of positions stopped out · worst day {inr(data.sl05.worst_day_rs ?? 0)} ·
            {" "}monthly {Object.entries(data.sl05.per_month_pct ?? {}).map(([m, p]) => `${m} ${pct(p)}`).join(", ") || "—"}
          </p>
        ) : (
          <p className="text-[12.5px] text-ink3">No session yet.</p>
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

      <Card pad={false}>
        <div className="p-4 sm:p-5 pb-0 sm:pb-0">
          <CardHead
            title="Every trade (Book A)"
            sub={`Each leg with quantity, entry and exit price and time, exit reason, charges and net. Fills are 5-minute bar closes; a day's PDF is on the Daily report page.${
              r.trades.length > 80 ? ` Showing the latest 80 of ${r.trades.length} legs served.` : ""
            }`}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-t border-line">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Day</th>
                <th className={th}>Leg</th>
                <th className={th}>Stock</th>
                <th className={`${th} text-right`}>Qty</th>
                <th className={`${th} text-right`}>Entry</th>
                <th className={th}>At</th>
                <th className={`${th} text-right`}>Exit</th>
                <th className={th}>At</th>
                <th className={th}>Reason</th>
                <th className={`${th} text-right`}>Charges</th>
                <th className={`${th} text-right`}>Net</th>
              </tr>
            </thead>
            <tbody>
              {r.trades.length === 0 && (
                <tr>
                  <td className={`${td} text-ink3`} colSpan={11}>No trade yet.</td>
                </tr>
              )}
              {r.trades.slice(0, 80).map((t) => (
                <tr key={`${t.day}-${t.leg}-${t.symbol}`} className="border-b border-line last:border-0">
                  <td className={td}>{fmtDay(t.day)}</td>
                  <td className={td}>{t.leg === "flip_long" ? "Flip long" : "Short"}</td>
                  <td className={`${td} font-semibold`}>{t.symbol}</td>
                  <td className={`${td} tnum text-right`}>{t.qty}</td>
                  <td className={`${td} tnum text-right`}>{t.entry.toFixed(2)}</td>
                  <td className={td}>{barTime(t.entry_bar)}</td>
                  <td className={`${td} tnum text-right`}>{t.exit.toFixed(2)}</td>
                  <td className={td}>{barTime(t.exit_bar)}</td>
                  <td className={`${td} text-ink2`}>{WHY[t.why] ?? t.why}</td>
                  <td className={`${td} tnum text-right`}>{t.costs.toFixed(2)}</td>
                  <td className={`${td} tnum text-right font-semibold ${t.net >= 0 ? "text-up" : "text-down"}`}>{inr(t.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
