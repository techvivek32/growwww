import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { scalpingReport, type ScalpDay, type ScalpLive, type ScalpSearch, type ScalpStrategy } from "@/lib/research";
import { Card, CardHead, Pill, StatTile } from "@/components/ui";

export const metadata: Metadata = { title: "Scalping · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

const inr = (v: number) => `${v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
const th = "px-3 py-2 text-left font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase";
const td = "px-3 py-2 text-[12.5px] text-ink";
const tone = (v: number) => (v > 0 ? "text-up" : v < 0 ? "text-down" : "text-ink3");

/**
 * The scalping research program: a separate search over short-hold 5-minute
 * rules, kept apart from the paper books. The 100 shown were chosen on the
 * selection window only; the "test" and "paper" columns are what they did
 * afterwards.
 */
export default async function ScalpingPage() {
  await requireAdminPage();
  const state = await scalpingReport();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">Admin · Research</p>
        <h1 className="pub-display mt-1 text-[28px] leading-tight text-ink">Scalping</h1>
        <p className="mt-1 max-w-[72ch] text-[13px] leading-snug text-ink3">
          A separate program from the paper books: 1,00,000 short-hold rules on 5-minute bars (breakouts, VWAP crosses, momentum bursts and their fades; holds of 5–60 minutes; stops 0.2–1%; targets 0.2–1.5%), each with the full ₹5 lakh per trade and Groww intraday costs. The 100 below were chosen on 2024-01 → 2026-04 only; what they did from May 2026 on, and in daily paper trading, is reported beside that.
        </p>
      </div>
      {state.kind !== "ok" && (
        <Card><CardHead title={state.kind === "unconfigured" ? "Not connected" : "Research box unreachable"} sub={state.kind === "error" ? state.message : "Set RESEARCH_API_URL and RESEARCH_API_TOKEN."} /></Card>
      )}
      {state.kind === "ok" && state.data.status && <Card><CardHead title="No search yet" sub={state.data.status} /></Card>}
      {state.kind === "ok" && state.data.live && <LiveBook live={state.data.live} />}
      {state.kind === "ok" && state.data.search && <Body top={state.data.top ?? []} search={state.data.search} daily={state.data.daily ?? []} />}
    </div>
  );
}

const istTime = (t: number) => new Date(t * 1000).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** The admin's live scalp book: paper positions taken today under the 11:00–11:15 / ₹1,000-trail rule. */
function LiveBook({ live }: { live: ScalpLive }) {
  const t = live.today;
  const s = t?.summary;
  const rules = live.rules ?? [];
  const covered = rules.reduce((n, r) => n + r.ranks.length, 0);
  return (
    <Card pad={false}>
      <div className="p-4 sm:p-5 pb-0 sm:pb-0">
        <CardHead
          title="Live scalp book (paper)"
          sub={`Entries only at the ${live.window ?? "11:05, 11:10, 11:15 bar closes"}; one position per rule, ₹5 lakh each, the most liquid stock firing. Exit when ₹${(live.trail_rs ?? 1000).toLocaleString("en-IN")} below the position's best point (a fresh position stops at a ₹${(live.trail_rs ?? 1000).toLocaleString("en-IN")} loss; a winner gives back at most that), or at 15:15. ${rules.length} distinct rules from the ${covered} strategies that were positive on 20 Nov. Starts 10:58 IST every session; no orders are placed.`}
          right={t ? <Pill tone={t.status === "done" ? "neutral" : "up"}>{t.status}{t.updated_at ? ` · ${istTime(t.updated_at)}` : ""}</Pill> : <Pill tone="neutral">next session 10:58</Pill>}
        />
      </div>
      {live.error && <p className="px-5 pb-4 text-[12.5px] text-down">{live.error}</p>}
      {s && (
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-5 lg:grid-cols-5">
          <StatTile label="Today, total" value={inr(s.total_rs ?? 0)} tone={(s.total_rs ?? 0) >= 0 ? "up" : "down"} sub={`${t?.day ?? ""}`} />
          <StatTile label="Realised" value={inr(s.realised_rs ?? 0)} tone={(s.realised_rs ?? 0) >= 0 ? "up" : "down"} sub={`${s.closed ?? 0} closed`} />
          <StatTile label="Unrealised" value={inr(s.unrealised_rs ?? 0)} tone={(s.unrealised_rs ?? 0) >= 0 ? "up" : "down"} sub={`${s.open ?? 0} open`} />
          <StatTile label="No signal" value={String(s.no_signal ?? 0)} sub="rules that did not fire in the window" />
          <StatTile label="Rules" value={String(rules.length)} sub={`${covered} strategies covered`} />
        </div>
      )}
      {t && (
        <div className="overflow-x-auto">
          <table className="w-full border-t border-line">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Rule</th><th className={th}>Signal</th><th className={th}>Stock</th><th className={`${th} text-right`}>Entry</th><th className={`${th} text-right`}>Qty</th>
                <th className={`${th} text-right`}>LTP / exit</th><th className={`${th} text-right`}>P&amp;L</th><th className={`${th} text-right`}>Peak</th><th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {t.positions.map((p) => {
                const pnl = p.status === "closed" ? (p.net_rs ?? 0) : (p.pnl_rs ?? 0);
                return (
                  <tr key={p.rule} className="border-b border-line last:border-0">
                    <td className={`${td} tnum`}>{p.rule} <span className="text-ink3">(#{p.ranks.join(", #")})</span></td>
                    <td className={td}><span className={`font-semibold ${p.side === "long" ? "text-up" : "text-down"}`}>{p.side === "long" ? "BUY" : "SELL"}</span> {p.signal.replace(/_/g, " ")} <span className="text-ink3">· {p.universe.replace(" by turnover", "")}</span></td>
                    <td className={`${td} font-semibold`}>{p.symbol ?? "—"}{p.entry_bar ? <span className="font-normal text-ink3"> {p.entry_bar}</span> : null}</td>
                    <td className={`${td} tnum text-right`}>{p.entry ? `₹${p.entry.toLocaleString("en-IN")}` : "—"}</td>
                    <td className={`${td} tnum text-right`}>{p.qty ?? "—"}</td>
                    <td className={`${td} tnum text-right`}>{p.status === "closed" ? `₹${(p.exit ?? 0).toLocaleString("en-IN")}` : p.ltp ? `₹${p.ltp.toLocaleString("en-IN")}` : "—"}</td>
                    <td className={`${td} tnum text-right font-semibold ${p.symbol ? tone(pnl) : "text-ink3"}`}>{p.symbol ? inr(pnl) : "—"}</td>
                    <td className={`${td} tnum text-right text-ink2`}>{p.symbol ? inr(p.peak_rs ?? 0) : "—"}</td>
                    <td className={`${td} text-ink2`}>{p.status === "closed" ? p.why : p.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(live.days ?? []).length > 0 && (
        <div className="border-t border-line">
          <table className="w-full">
            <thead><tr className="border-b border-line"><th className={th}>Day</th><th className={`${th} text-right`}>Net</th><th className={`${th} text-right`}>Closed</th><th className={`${th} text-right`}>No signal</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {[...(live.days ?? [])].reverse().map((d) => (
                <tr key={d.day} className="border-b border-line last:border-0">
                  <td className={td}>{d.day}</td>
                  <td className={`${td} tnum text-right font-semibold ${tone(d.total_rs ?? 0)}`}>{inr(d.total_rs ?? 0)}</td>
                  <td className={`${td} tnum text-right`}>{d.closed ?? 0}</td>
                  <td className={`${td} tnum text-right`}>{d.no_signal ?? 0}</td>
                  <td className={`${td} text-ink2`}>{d.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Body({ top, search, daily }: { top: ScalpStrategy[]; search: ScalpSearch; daily: ScalpDay[] }) {
  const paperDays = daily.length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Strategies searched" value={search.strategies.toLocaleString("en-IN")} sub={search.panel} />
        <StatTile label="Profitable in selection" value={`${search.profitable_in_selection_pct}%`} sub={`${search.profitable_in_selection.toLocaleString("en-IN")} of ${search.strategies.toLocaleString("en-IN")}`} tone={search.profitable_in_selection_pct > 50 ? "up" : "down"} />
        <StatTile label="Median strategy" value={pct(search.selection_per_month_pct_quantiles["0.5"] ?? 0)} sub="per month, selection window" tone={(search.selection_per_month_pct_quantiles["0.5"] ?? 0) >= 0 ? "up" : "down"} />
        <StatTile label="Top 100 in the test months" value={pct(search.test_summary.top100_mean_per_month_pct_test)} sub={`${Math.round(search.test_summary.top100_share_positive_in_test * 100)}% positive after selection`} tone={search.test_summary.top100_mean_per_month_pct_test >= 0 ? "up" : "down"} />
        <StatTile label="Paper days" value={String(paperDays)} sub={paperDays ? `latest ${daily[paperDays - 1].day}: avg ${inr(daily[paperDays - 1].mean_net_rs)}` : "from the next session"} />
      </div>

      {daily.length > 0 && (
        <Card pad={false}>
          <div className="p-4 sm:p-5 pb-0 sm:pb-0"><CardHead title="Daily paper results of the 100" sub="Each session, the 100 strategies run on that day's bars. Average net, how many were positive, best and worst." /></div>
          <table className="w-full border-t border-line">
            <thead><tr className="border-b border-line"><th className={th}>Day</th><th className={`${th} text-right`}>Avg net of 100</th><th className={`${th} text-right`}>Positive</th><th className={`${th} text-right`}>Best</th><th className={`${th} text-right`}>Worst</th></tr></thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.day} className="border-b border-line last:border-0">
                  <td className={td}>{d.day}</td>
                  <td className={`${td} tnum text-right font-semibold ${tone(d.mean_net_rs)}`}>{inr(d.mean_net_rs)}</td>
                  <td className={`${td} tnum text-right`}>{d.positive} / 100</td>
                  <td className={`${td} tnum text-right text-up`}>#{d.best.rank} {inr(d.best.net_rs)}</td>
                  <td className={`${td} tnum text-right text-down`}>#{d.worst.rank} {inr(d.worst.net_rs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card pad={false}>
        <div className="p-4 sm:p-5 pb-0 sm:pb-0">
          <CardHead title="The 100 chosen strategies" sub="Ranked by Sharpe on the selection window (2024-01 → 2026-04, ≥100 trading days, positive net). 'Test' is 2026-05 onward, untouched by the choice. 'Paper' is live daily results." right={<Pill tone="neutral">₹5 lakh per trade</Pill>} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-t border-line">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>#</th><th className={th}>Rule</th><th className={th}>Universe · window</th><th className={`${th} text-right`}>Stop / target / hold</th>
                <th className={`${th} text-right`}>Selection /mo</th><th className={`${th} text-right`}>Win days</th><th className={`${th} text-right`}>Test /mo</th><th className={`${th} text-right`}>Test net</th><th className={`${th} text-right`}>Paper</th>
              </tr>
            </thead>
            <tbody>
              {top.map((s) => (
                <tr key={s.rank} className="border-b border-line last:border-0">
                  <td className={`${td} tnum`}>{s.rank}</td>
                  <td className={td}><span className={`font-semibold ${s.side === "long" ? "text-up" : "text-down"}`}>{s.side === "long" ? "BUY" : "SELL"}</span> {s.signal.replace(/_/g, " ")} <span className="text-ink3">· {s.trades_per_day}/day</span></td>
                  <td className={`${td} text-ink2`}>{s.universe} · {s.window}</td>
                  <td className={`${td} tnum text-right text-ink2`}>{s.stop_pct}% / {s.target_pct}% / {s.max_hold_min}m</td>
                  <td className={`${td} tnum text-right font-semibold ${tone(s.selection_2024_01_to_2026_04.per_month_pct)}`}>{pct(s.selection_2024_01_to_2026_04.per_month_pct)}</td>
                  <td className={`${td} tnum text-right`}>{Math.round(s.selection_2024_01_to_2026_04.day_win_rate * 100)}%</td>
                  <td className={`${td} tnum text-right font-semibold ${tone(s.test_2026_05_on.per_month_pct)}`}>{pct(s.test_2026_05_on.per_month_pct)}</td>
                  <td className={`${td} tnum text-right ${tone(s.test_2026_05_on.net_rs)}`}>{inr(s.test_2026_05_on.net_rs)}</td>
                  <td className={`${td} tnum text-right ${s.paper && s.paper.days ? tone(s.paper.net_rs) : "text-ink3"}`}>{s.paper && s.paper.days ? `${inr(s.paper.net_rs)} (${s.paper.positive_days}/${s.paper.days})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
