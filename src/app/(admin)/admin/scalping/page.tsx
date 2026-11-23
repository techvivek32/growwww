import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { scalpingReport, type ScalpDay, type ScalpFast, type ScalpLive, type ScalpLivePosition, type ScalpNse, type ScalpSearch, type ScalpStrategy } from "@/lib/research";
import AutoRefresh from "./AutoRefresh";
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
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="pub-display text-[28px] leading-tight text-ink">Scalping</h1>
          <AutoRefresh every={5000} />
        </div>
        <p className="mt-1 max-w-[72ch] text-[13px] leading-snug text-ink3">
          A separate program from the paper books: 1,00,000 short-hold rules on 5-minute bars (breakouts, VWAP crosses, momentum bursts and their fades; holds of 5–60 minutes; stops 0.2–1%; targets 0.2–1.5%), each with the full ₹5 lakh per trade and Groww intraday costs. The 100 below were chosen on 2024-01 → 2026-04 only; what they did from May 2026 on, and in daily paper trading, is reported beside that.
        </p>
      </div>
      {state.kind !== "ok" && (
        <Card><CardHead title={state.kind === "unconfigured" ? "Not connected" : "Research box unreachable"} sub={state.kind === "error" ? state.message : "Set RESEARCH_API_URL and RESEARCH_API_TOKEN."} /></Card>
      )}
      {state.kind === "ok" && state.data.status && <Card><CardHead title="No search yet" sub={state.data.status} /></Card>}
      {state.kind === "ok" && state.data.nse && <NseBook nse={state.data.nse} />}
      {state.kind === "ok" && state.data.fast && <FastBook fast={state.data.fast} />}
      {state.kind === "ok" && state.data.live && <LiveBook live={state.data.live} />}
      {state.kind === "ok" && state.data.search && <Body top={state.data.top ?? []} search={state.data.search} daily={state.data.daily ?? []} />}
    </div>
  );
}

const istTime = (t: number) => new Date(t * 1000).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** The NSE-context scalp book: the admin's two NSE pages (top gainers/losers, 52-week distance) as the input, four selective rules. */
function NseBook({ nse }: { nse: ScalpNse }) {
  const t = nse.today;
  const s = t?.summary;
  const books = t?.books ?? [];
  const movers = t?.movers ?? [];
  const lastTrades = books.flatMap((b) => (b.trades ?? []).map((x) => ({ ...x, rule: b.rule, name: b.name, side: b.side }))).sort((a, b) => b.exited_at - a.exited_at).slice(0, 20);
  return (
    <Card pad={false}>
      <div className="p-4 sm:p-5 pb-0 sm:pb-0">
        <CardHead
          title="NSE movers scalp book (paper)"
          sub={`Input: NSE's top gainers / losers page (refreshed every minute; liquid names only, ₹5 crore+ traded) with each name's distance from its 52-week high and low, as on NSE's live equity market page. Four selective rules, at most ${nse.max_trades ?? 2} trades a day each, ₹5 lakh a trade, entries 09:30–14:30, squared off 15:15: (1) gainer continuation BUY after a pullback and a new 2-minute high, (2) loser continuation SELL after a bounce and a new 2-minute low, (3) 52-week-high breakout BUY, (4) exhausted gainer fade SELL. Targets 1%, stops 0.5–0.6%, 30–45 minute limits. No orders are placed.`}
          right={t ? <Pill tone={t.status === "done" ? "neutral" : "up"}>{t.status}{t.updated_at ? ` · ${istTime(t.updated_at)}` : ""}</Pill> : <Pill tone="neutral">next session 09:16</Pill>}
        />
      </div>
      {nse.error && <p className="px-5 pb-4 text-[12.5px] text-down">{nse.error}</p>}
      {s && (
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-5 lg:grid-cols-4">
          <StatTile label="Today, all four" value={inr(s.total_rs)} tone={s.total_rs >= 0 ? "up" : "down"} sub={`${t?.day ?? ""} · incl. open`} />
          <StatTile label="Realised" value={inr(s.realised_rs)} tone={s.realised_rs >= 0 ? "up" : "down"} sub={`${s.trades} trades closed`} />
          <StatTile label="Open now" value={String(s.open)} sub="positions across the four rules" />
          <StatTile label="On watch" value={String(t?.watch ?? 0)} sub="NSE gainers + losers, liquid" />
        </div>
      )}
      {books.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-t border-line">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Rule</th><th className={`${th} text-right`}>Trades</th><th className={`${th} text-right`}>Realised</th>
                <th className={th}>Open position</th><th className={`${th} text-right`}>Entry</th><th className={`${th} text-right`}>LTP</th><th className={`${th} text-right`}>P&amp;L</th><th className={th}>Why</th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.rule} className="border-b border-line last:border-0">
                  <td className={td}><span className={`font-semibold ${b.side > 0 ? "text-up" : "text-down"}`}>{b.side > 0 ? "BUY" : "SELL"}</span> {b.name}</td>
                  <td className={`${td} tnum text-right`}>{b.n} / {nse.max_trades ?? 2}{b.n ? <span className="text-ink3"> · {b.wins} won</span> : null}</td>
                  <td className={`${td} tnum text-right font-semibold ${tone(b.net_rs)}`}>{inr(b.net_rs)}</td>
                  <td className={`${td} font-semibold`}>{b.position ? `${b.position.symbol} ${istTime(b.position.entered_at)}` : <span className="font-normal text-ink3">waiting for its turn</span>}</td>
                  <td className={`${td} tnum text-right`}>{b.position ? `₹${b.position.entry.toLocaleString("en-IN")}` : "—"}</td>
                  <td className={`${td} tnum text-right`}>{b.position ? `₹${b.position.ltp.toLocaleString("en-IN")}` : "—"}</td>
                  <td className={`${td} tnum text-right font-semibold ${b.position ? tone(b.position.pnl_rs) : "text-ink3"}`}>{b.position ? inr(b.position.pnl_rs) : "—"}</td>
                  <td className={`${td} text-ink2`}>{b.position ? (b.position as { why_in?: string }).why_in : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lastTrades.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <p className="px-4 pt-3 font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase sm:px-5">Trades today</p>
          <table className="w-full">
            <thead><tr className="border-b border-line"><th className={th}>Time</th><th className={th}>Rule</th><th className={th}>Stock</th><th className={`${th} text-right`}>Entry → exit</th><th className={`${th} text-right`}>Held</th><th className={th}>Exit</th><th className={`${th} text-right`}>Net</th></tr></thead>
            <tbody>
              {lastTrades.map((x, i) => (
                <tr key={`${x.rule}-${x.exited_at}-${i}`} className="border-b border-line last:border-0">
                  <td className={`${td} tnum`}>{istTime(x.entered_at)}</td>
                  <td className={td}><span className={`font-semibold ${x.side > 0 ? "text-up" : "text-down"}`}>{x.side > 0 ? "BUY" : "SELL"}</span> {x.rule}</td>
                  <td className={`${td} font-semibold`}>{x.symbol}</td>
                  <td className={`${td} tnum text-right`}>₹{x.entry.toLocaleString("en-IN")} → ₹{x.exit.toLocaleString("en-IN")}</td>
                  <td className={`${td} tnum text-right`}>{x.secs != null ? `${Math.round(x.secs / 60)}m` : "—"}</td>
                  <td className={`${td} text-ink2`}>{x.why}</td>
                  <td className={`${td} tnum text-right font-semibold ${tone(x.net_rs)}`}>{inr(x.net_rs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {movers.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <p className="px-4 pt-3 font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase sm:px-5">NSE movers on watch (from the two NSE pages)</p>
          <table className="w-full">
            <thead><tr className="border-b border-line"><th className={th}>Stock</th><th className={`${th} text-right`}>Today</th><th className={`${th} text-right`}>LTP</th><th className={`${th} text-right`}>Day high / low</th><th className={`${th} text-right`}>From 52W high</th><th className={`${th} text-right`}>From 52W low</th><th className={`${th} text-right`}>Turnover</th></tr></thead>
            <tbody>
              {movers.slice(0, 24).map((m) => (
                <tr key={m.symbol} className="border-b border-line last:border-0">
                  <td className={`${td} font-semibold`}>{m.symbol} <span className={`font-normal ${m.kind === "gainer" ? "text-up" : "text-down"}`}>{m.kind}</span></td>
                  <td className={`${td} tnum text-right font-semibold ${tone(m.pct)}`}>{pct(m.pct)}</td>
                  <td className={`${td} tnum text-right`}>₹{m.ltp.toLocaleString("en-IN")}</td>
                  <td className={`${td} tnum text-right text-ink2`}>{m.high.toLocaleString("en-IN")} / {m.low.toLocaleString("en-IN")}</td>
                  <td className={`${td} tnum text-right text-ink2`}>{m.near_wkh < 900 ? `${m.near_wkh.toFixed(1)}% below` : "—"}</td>
                  <td className={`${td} tnum text-right text-ink2`}>{m.near_wkl > -900 ? `${Math.abs(m.near_wkl).toFixed(1)}% above` : "—"}</td>
                  <td className={`${td} tnum text-right text-ink2`}>₹{(m.turnover / 1e7).toFixed(1)} Cr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The fast scalp book: tick-level buy-sell-buy-sell on the LTP feed, six rules, each re-entering all day. */
function FastBook({ fast }: { fast: ScalpFast }) {
  const t = fast.today;
  const s = t?.summary;
  const books = t?.books ?? [];
  const lastTrades = books.flatMap((b) => (b.trades ?? []).map((x) => ({ ...x, rule: b.rule, name: b.name, side: b.side }))).sort((a, b) => b.exited_at - a.exited_at).slice(0, 30);
  return (
    <Card pad={false}>
      <div className="p-4 sm:p-5 pb-0 sm:pb-0">
        <CardHead
          title="Fast scalp book (paper, tick level)"
          sub={`Six rules watch the ${fast.universe ?? 100} most liquid names on the price feed every 5 seconds and trade with ₹5 lakh: momentum (go with a 0.25–0.5% move within 1–2 minutes) and fade (go against it), targets 0.3–0.5%, stops 0.2–0.3%, 5–10 minute limits, re-entering all day until 15:15. Groww costs and slippage on every trade (about ₹523 a round trip). No orders are placed.`}
          right={t ? <Pill tone={t.status === "done" ? "neutral" : "up"}>{t.status}{t.updated_at ? ` · ${istTime(t.updated_at)}` : ""}</Pill> : <Pill tone="neutral">next session 09:14</Pill>}
        />
      </div>
      {fast.error && <p className="px-5 pb-4 text-[12.5px] text-down">{fast.error}</p>}
      {s && (
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-5 lg:grid-cols-4">
          <StatTile label="Today, all six" value={inr(s.total_rs)} tone={s.total_rs >= 0 ? "up" : "down"} sub={`${t?.day ?? ""} · incl. open`} />
          <StatTile label="Realised" value={inr(s.realised_rs)} tone={s.realised_rs >= 0 ? "up" : "down"} sub={`${s.trades} trades closed`} />
          <StatTile label="Open now" value={String(s.open)} sub="positions across the six rules" />
          <StatTile label="Cost paid" value={inr(books.reduce((a, b) => a + ((b as { cost_rs?: number }).cost_rs ?? 0), 0))} tone="down" sub="brokerage, taxes, slippage" />
        </div>
      )}
      {books.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-t border-line">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Rule</th><th className={`${th} text-right`}>Trades</th><th className={`${th} text-right`}>Wins</th><th className={`${th} text-right`}>Realised</th>
                <th className={th}>Open position</th><th className={`${th} text-right`}>Entry</th><th className={`${th} text-right`}>LTP</th><th className={`${th} text-right`}>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.rule} className="border-b border-line last:border-0">
                  <td className={td}><span className={`font-semibold ${b.side > 0 ? "text-up" : "text-down"}`}>{b.side > 0 ? "BUY" : "SELL"}</span> {b.name}</td>
                  <td className={`${td} tnum text-right`}>{b.n}</td>
                  <td className={`${td} tnum text-right`}>{b.n ? `${Math.round((b.wins / b.n) * 100)}%` : "—"}</td>
                  <td className={`${td} tnum text-right font-semibold ${tone(b.net_rs)}`}>{inr(b.net_rs)}</td>
                  <td className={`${td} font-semibold`}>{b.position ? `${b.position.symbol} (${b.position.move_pct ?? 0 > 0 ? "+" : ""}${b.position.move_pct ?? 0}% · ${istTime(b.position.entered_at)})` : <span className="font-normal text-ink3">flat</span>}</td>
                  <td className={`${td} tnum text-right`}>{b.position ? `₹${b.position.entry.toLocaleString("en-IN")}` : "—"}</td>
                  <td className={`${td} tnum text-right`}>{b.position ? `₹${b.position.ltp.toLocaleString("en-IN")}` : "—"}</td>
                  <td className={`${td} tnum text-right font-semibold ${b.position ? tone(b.position.pnl_rs) : "text-ink3"}`}>{b.position ? inr(b.position.pnl_rs) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lastTrades.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <p className="px-4 pt-3 font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase sm:px-5">Last trades</p>
          <table className="w-full">
            <thead><tr className="border-b border-line"><th className={th}>Time</th><th className={th}>Rule</th><th className={th}>Stock</th><th className={`${th} text-right`}>Entry → exit</th><th className={`${th} text-right`}>Held</th><th className={th}>Why</th><th className={`${th} text-right`}>Net</th></tr></thead>
            <tbody>
              {lastTrades.map((x, i) => (
                <tr key={`${x.rule}-${x.exited_at}-${i}`} className="border-b border-line last:border-0">
                  <td className={`${td} tnum`}>{istTime(x.entered_at)}</td>
                  <td className={td}><span className={`font-semibold ${x.side > 0 ? "text-up" : "text-down"}`}>{x.side > 0 ? "BUY" : "SELL"}</span> {x.rule}</td>
                  <td className={`${td} font-semibold`}>{x.symbol}</td>
                  <td className={`${td} tnum text-right`}>₹{x.entry.toLocaleString("en-IN")} → ₹{x.exit.toLocaleString("en-IN")}</td>
                  <td className={`${td} tnum text-right`}>{x.secs != null ? `${Math.round(x.secs / 60)}m` : "—"}</td>
                  <td className={`${td} text-ink2`}>{x.why}</td>
                  <td className={`${td} tnum text-right font-semibold ${tone(x.net_rs)}`}>{inr(x.net_rs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(fast.days ?? []).length > 1 && (
        <div className="border-t border-line">
          <table className="w-full">
            <thead><tr className="border-b border-line"><th className={th}>Day</th><th className={`${th} text-right`}>Net, all six</th><th className={`${th} text-right`}>Trades</th><th className={th}>Best rule</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {[...(fast.days ?? [])].reverse().map((d) => {
                const best = [...d.books].sort((a, b) => b.net_rs - a.net_rs)[0];
                return (
                  <tr key={d.day} className="border-b border-line last:border-0">
                    <td className={td}>{d.day}</td>
                    <td className={`${td} tnum text-right font-semibold ${tone(d.total_rs ?? 0)}`}>{inr(d.total_rs ?? 0)}</td>
                    <td className={`${td} tnum text-right`}>{d.trades ?? 0}</td>
                    <td className={`${td} text-ink2`}>{best ? `${best.name} ${inr(best.net_rs)}` : "—"}</td>
                    <td className={`${td} text-ink2`}>{d.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The live scalp book: paper positions taken today by the strategies that were positive in both windows of the search. */
function LiveBook({ live }: { live: ScalpLive }) {
  const t = live.today;
  const s = t?.summary;
  const rules = live.rules ?? [];
  return (
    <Card pad={false}>
      <div className="p-4 sm:p-5 pb-0 sm:pb-0">
        <CardHead
          title="Live scalp book (paper)"
          sub={`${rules.length} strategies from the search that were positive in BOTH the selection window (2024-01 → 2026-04) and the test months (2026-05 →). Each trades its own rule on today's market: its signal, universe, entry window, stop, target and maximum hold; one position per strategy per day, ₹5 lakh each, the most liquid stock firing; squared off by 15:15. Starts 09:18 IST every session; no orders are placed. Expect small numbers: these strategies made 0.3–2%/month in the search, not 10%.`}
          right={t ? <Pill tone={t.status === "done" ? "neutral" : "up"}>{t.status}{t.updated_at ? ` · ${istTime(t.updated_at)}` : ""}</Pill> : <Pill tone="neutral">next session 09:18</Pill>}
        />
      </div>
      {live.error && <p className="px-5 pb-4 text-[12.5px] text-down">{live.error}</p>}
      {s && (
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-5 lg:grid-cols-5">
          <StatTile label="Today, total" value={inr(s.total_rs ?? 0)} tone={(s.total_rs ?? 0) >= 0 ? "up" : "down"} sub={`${t?.day ?? ""}`} />
          <StatTile label="Realised" value={inr(s.realised_rs ?? 0)} tone={(s.realised_rs ?? 0) >= 0 ? "up" : "down"} sub={`${s.closed ?? 0} closed`} />
          <StatTile label="Unrealised" value={inr(s.unrealised_rs ?? 0)} tone={(s.unrealised_rs ?? 0) >= 0 ? "up" : "down"} sub={`${s.open ?? 0} open`} />
          <StatTile label="No signal" value={String(s.no_signal ?? 0)} sub="strategies whose rule did not fire" />
          <StatTile label="Strategies" value={String(t?.rules ?? rules.length)} sub="positive in both windows" />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-t border-line">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>#</th><th className={th}>Rule</th><th className={th}>Window</th><th className={`${th} text-right`}>Stop / target / hold</th><th className={`${th} text-right`}>Search /mo (sel · test)</th>
              <th className={th}>Stock</th><th className={`${th} text-right`}>Entry</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>LTP / exit</th><th className={`${th} text-right`}>P&amp;L</th><th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {(t ? t.positions : rules.map((r): ScalpLivePosition => ({ ...r, status: "waiting", symbol: null }))).map((p) => {
              const pnl = p.status === "closed" ? (p.net_rs ?? 0) : (p.pnl_rs ?? 0);
              return (
                <tr key={p.rule} className="border-b border-line last:border-0">
                  <td className={`${td} tnum`}>{p.rule}{p.rank ? <span className="text-ink3"> (#{p.rank})</span> : null}{p.ranks ? <span className="text-ink3"> (#{p.ranks.join(", #")})</span> : null}</td>
                  <td className={td}><span className={`font-semibold ${p.side === "long" ? "text-up" : "text-down"}`}>{p.side === "long" ? "BUY" : "SELL"}</span> {p.signal.replace(/_/g, " ")} <span className="text-ink3">· {p.universe.replace(" by turnover", "")}</span></td>
                  <td className={`${td} text-ink2`}>{p.window ?? "—"}</td>
                  <td className={`${td} tnum text-right text-ink2`}>{p.stop_pct != null ? `${p.stop_pct}% / ${p.target_pct}% / ${p.max_hold_min}m` : "₹1,000 trail"}</td>
                  <td className={`${td} tnum text-right text-ink2`}>{p.selection_per_month_pct != null ? `${pct(p.selection_per_month_pct)} · ${pct(p.test_per_month_pct ?? 0)}` : "—"}</td>
                  <td className={`${td} font-semibold`}>{p.symbol ?? "—"}{p.entry_bar ? <span className="font-normal text-ink3"> {p.entry_bar}</span> : null}</td>
                  <td className={`${td} tnum text-right`}>{p.entry ? `₹${p.entry.toLocaleString("en-IN")}` : "—"}</td>
                  <td className={`${td} tnum text-right`}>{p.qty ?? "—"}</td>
                  <td className={`${td} tnum text-right`}>{p.status === "closed" ? `₹${(p.exit ?? 0).toLocaleString("en-IN")}` : p.ltp ? `₹${p.ltp.toLocaleString("en-IN")}` : "—"}</td>
                  <td className={`${td} tnum text-right font-semibold ${p.symbol ? tone(pnl) : "text-ink3"}`}>{p.symbol ? inr(pnl) : "—"}</td>
                  <td className={`${td} text-ink2`}>{p.status === "closed" ? p.why : p.status === "open" && p.exit_by ? `open · by ${p.exit_by}` : p.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(live.days ?? []).length > 0 && (
        <div className="border-t border-line">
          <table className="w-full">
            <thead><tr className="border-b border-line"><th className={th}>Day</th><th className={`${th} text-right`}>Net</th><th className={`${th} text-right`}>Closed</th><th className={`${th} text-right`}>No signal</th><th className={th}>Rule set</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {[...(live.days ?? [])].reverse().map((d) => (
                <tr key={d.day} className="border-b border-line last:border-0">
                  <td className={td}>{d.day}</td>
                  <td className={`${td} tnum text-right font-semibold ${tone(d.total_rs ?? 0)}`}>{inr(d.total_rs ?? 0)}</td>
                  <td className={`${td} tnum text-right`}>{d.closed ?? 0}</td>
                  <td className={`${td} tnum text-right`}>{d.no_signal ?? 0}</td>
                  <td className={`${td} text-ink2`}>{(d.version ?? 1) === 1 ? "admin's rule: 52 one-day winners, 11:00–11:15, ₹1,000 trail" : `${d.rules ?? ""} strategies positive in both windows`}</td>
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
