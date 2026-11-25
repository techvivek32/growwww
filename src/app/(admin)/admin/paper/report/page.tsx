import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/access";
import { liveSummary, dayToIso, type LivexDay, type LivexLeg, type Sl05Trade } from "@/lib/research";
import PrintButton from "@/components/PrintButton";

export const metadata: Metadata = { title: "Daily report · Paper trading · MNHA Financials" };
export const dynamic = "force-dynamic";

/**
 * One trading day of the paper record as a printable report: every leg with
 * quantity, entry and exit price and time, exit reason, charges and net.
 * "Save as PDF" prints it; the admin chrome is hidden in print. Every figure
 * comes from the research box's stored record — nothing is recomputed here.
 */

const IST = "Asia/Kolkata";
const LONG = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: IST });
const STAMP = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
const TIME = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
const inr2 = (v: number) => `${v < 0 ? "−" : ""}₹${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inr = (v: number) => `${v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
/** Book A fills at the CLOSE of a 5-minute bar: bar 0 closes 09:20, bar b at 09:20 + 5b. */
const barTime = (b: number) => hhmm(9 * 60 + 20 + 5 * b);
const atTime = (s: number | null | undefined) => (s ? TIME.format(new Date(s * 1000)) : "—");
const WHY_A: Record<number, string> = { 0: "15:15 square-off", 1: "stop", 5: "market stop", 6: "covered at 10:15 flip", 7: "closed by admin" };
const LEG_NAME: Record<string, string> = { short: "Short", flip_long: "Flip long", admin_long: "Admin long", admin_short: "Admin short" };

const th = "border-b border-line px-2.5 py-1.5 text-left font-mono text-[10px] tracking-[0.08em] text-ink3 uppercase";
const td = "border-b border-line px-2.5 py-1.5 text-[12px] text-ink";
const num = "tnum text-right";

function statusLine(d: LivexDay): string {
  if (d.status === "no_session") return "Holiday — no session.";
  if (d.skip) return "Skipped — the regime filter kept the book flat today.";
  if (d.status === "settled") return "Settled at 15:15.";
  return "Session in progress — figures below are as stored so far.";
}

export default async function PaperReportPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  await requireAdminPage();
  const { day: dayParam } = await searchParams;
  const state = await liveSummary();

  if (state.kind !== "ok" || !state.data.livex) {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-8">
        <p className="text-[13px] text-ink3">
          {state.kind === "unconfigured" ? "Research box not configured." : state.kind === "error" ? `Research box unreachable: ${state.message}` : state.data.livex_error ?? "No paper record yet."}
        </p>
        <Link href="/admin/paper" className="text-[12.5px] text-ink2 underline-offset-2 hover:underline">← Paper trading</Link>
      </div>
    );
  }

  const r = state.data.livex;
  const book = state.data.book;
  const days = [...r.days_all].sort((a, b) => b.day - a.day);
  const todayDay = r.today?.day ?? null;
  const isoOf = (d: number) => dayToIso(d);
  const chosen = dayParam && days.find((d) => isoOf(d.day) === dayParam) ? days.find((d) => isoOf(d.day) === dayParam)! : days[0];

  if (!chosen) {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-8">
        <p className="text-[13px] text-ink3">No session recorded yet — the first pick is stored at 09:20 on the next trading day.</p>
        <Link href="/admin/paper" className="text-[12.5px] text-ink2 underline-offset-2 hover:underline">← Paper trading</Link>
      </div>
    );
  }

  const legsA: LivexLeg[] = r.trades.filter((t) => t.day === chosen.day).sort((a, b) => a.entry_bar - b.entry_bar || a.exit_bar - b.exit_bar);
  const netA = legsA.reduce((s, t) => s + t.net, 0);
  const costsA = legsA.reduce((s, t) => s + t.costs, 0);
  const iso = isoOf(chosen.day);
  const servedA = r.trades_from == null || chosen.day >= r.trades_from;
  const sl05 = state.data.sl05;
  const servedB = sl05?.trades_from == null || chosen.day >= sl05.trades_from;
  // Closed legs come from the record; the open leg of a running session only exists in sl05.today.
  const closedB: Sl05Trade[] = (sl05?.trades ?? []).filter((t) => t.day === iso);
  const openB: Sl05Trade[] =
    chosen.day === todayDay
      ? (sl05?.today ?? [])
          .filter((t) => !closedB.some((c) => c.leg === t.leg))
          .map((t) => ({ ...t, day: iso, net: t.net ?? 0, open: t.net == null }))
      : [];
  const legsB: (Sl05Trade & { open?: boolean })[] = [...closedB, ...openB];
  const netB = legsB.reduce((s, t) => s + t.net, 0);
  const openLegsB = legsB.filter((t) => t.open).length;
  const monthKey = iso.slice(0, 7);
  const monthPct = r.per_month_pct[monthKey];

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 print:max-w-none print:px-0 print:py-0">
      {/* Print: drop the admin chrome, and force the light palette whatever the on-screen theme —
          browsers do not print backgrounds, so dark-theme text would come out white on white.
          Nothing here may hide the report's own disclaimer. */}
      <style>{`@media print {
  .app-header { display: none !important }
  :root, .dark, :root.dark {
    --c-bg: #fff; --c-surface: #fff; --c-text: #15140f; --c-text-2: #4a463d; --c-text-3: #6e695e;
    --c-border: #d9d2c4; --c-border-strong: #15140f; --c-up: #2c6a47; --c-down: #b23a1c;
    color-scheme: light;
  }
  body { background: #fff }
  table { page-break-inside: auto }
  tr { page-break-inside: avoid }
}
@page { size: A4 landscape; margin: 12mm }`}</style>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/paper" className="text-[12.5px] text-ink2 underline-offset-2 hover:underline">← Paper trading</Link>
        <div className="flex items-center gap-2">
          {/* A plain GET form keeps this page fully server-rendered. */}
          <form action="/admin/paper/report" className="flex items-center gap-2">
            <select name="day" defaultValue={iso} className="border border-line bg-bg px-2 py-1.5 text-[12.5px] text-ink">
              {days.slice(0, 40).map((d) => (
                <option key={d.day} value={isoOf(d.day)}>{isoOf(d.day)}</option>
              ))}
            </select>
            <button type="submit" className="border border-line px-3 py-1.5 text-[12.5px] text-ink hover:border-line2">Open day</button>
          </form>
          <PrintButton />
        </div>
      </div>

      {/* ---------------- the report itself ---------------- */}
      <div className="border border-line p-6 print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-4">
          <div>
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-ink3 uppercase">MNHA Financials · Research</p>
            <h1 className="pub-display mt-1 text-[24px] leading-tight text-ink">Paper trading — daily report</h1>
            <p className="mt-1 text-[13px] text-ink2">{LONG.format(new Date(iso))}</p>
          </div>
          <div className="text-right text-[11.5px] leading-relaxed text-ink3">
            <p className="font-semibold text-ink">SIMULATION — PAPER ONLY</p>
            <p>No order was placed. Real NSE prices via Groww,</p>
            <p>charges and slippage included.</p>
          </div>
        </header>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
          <div>
            <dt className="font-mono text-[10px] tracking-[0.08em] text-ink3 uppercase">Book</dt>
            <dd className="tnum mt-0.5 font-semibold text-ink">{inr(book)}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] tracking-[0.08em] text-ink3 uppercase">Status</dt>
            <dd className="mt-0.5 text-ink">{statusLine(chosen)}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] tracking-[0.08em] text-ink3 uppercase">Decided / settled</dt>
            <dd className="mt-0.5 text-ink">{atTime(chosen.decided_at)} / {atTime(chosen.settled_at)}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] tracking-[0.08em] text-ink3 uppercase">Day net (Book A)</dt>
            <dd className={`tnum mt-0.5 font-semibold ${netA >= 0 ? "text-up" : "text-down"}`}>{legsA.length ? inr2(netA) : "—"}</dd>
          </div>
        </dl>

        <section className="mt-6">
          <h2 className="text-[14px] font-semibold text-ink">Book A — the strategy as tested</h2>
          <p className="mt-0.5 text-[11.5px] text-ink3">One stock shorted at the 09:20 bar close, 0.5% market stop, 10:15 flip on strong mornings, square-off 15:15. Fills at 5-minute bar closes.</p>
          {legsA.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-ink3">
              {chosen.status === "no_session"
                ? "Holiday — no legs."
                : chosen.skip
                  ? "No trade — day skipped."
                  : !servedA
                    ? "Older than the legs served to this dashboard — the record on the research box still holds them."
                    : chosen.status === "settled"
                      ? "No legs stored."
                      : "Legs are stored at the settlement, shortly after 15:15."}
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto print:overflow-visible">
            <table className="w-full border-t border-line">
              <thead>
                <tr>
                  <th className={th}>Leg</th>
                  <th className={th}>Stock</th>
                  <th className={th}>Side</th>
                  <th className={`${th} ${num}`}>Qty</th>
                  <th className={`${th} ${num}`}>Entry ₹</th>
                  <th className={th}>Entry time</th>
                  <th className={`${th} ${num}`}>Exit ₹</th>
                  <th className={th}>Exit time</th>
                  <th className={th}>Exit reason</th>
                  <th className={`${th} ${num}`}>Gross ₹</th>
                  <th className={`${th} ${num}`}>Charges ₹</th>
                  <th className={`${th} ${num}`}>Net ₹</th>
                </tr>
              </thead>
              <tbody>
                {legsA.map((t) => (
                  <tr key={t.leg + t.symbol}>
                    <td className={td}>{LEG_NAME[t.leg] ?? ((t.side ?? -1) < 0 ? "Short" : "Long")}</td>
                    <td className={`${td} font-semibold`}>{t.symbol}</td>
                    <td className={td}>{t.side < 0 ? "SELL → BUY" : "BUY → SELL"}</td>
                    <td className={`${td} ${num}`}>{t.qty}</td>
                    <td className={`${td} ${num}`}>{t.entry.toFixed(2)}</td>
                    <td className={td}>{barTime(t.entry_bar)}</td>
                    <td className={`${td} ${num}`}>{t.exit.toFixed(2)}</td>
                    <td className={td}>{barTime(t.exit_bar)}</td>
                    <td className={td}>{WHY_A[t.why] ?? String(t.why)}</td>
                    <td className={`${td} ${num}`}>{t.gross.toFixed(2)}</td>
                    <td className={`${td} ${num}`}>{t.costs.toFixed(2)}</td>
                    <td className={`${td} ${num} font-semibold ${t.net >= 0 ? "text-up" : "text-down"}`}>{t.net.toFixed(2)}</td>
                  </tr>
                ))}
                <tr>
                  <td className={`${td} font-semibold`} colSpan={10}>Day total</td>
                  <td className={`${td} ${num}`}>{costsA.toFixed(2)}</td>
                  <td className={`${td} ${num} font-semibold ${netA >= 0 ? "text-up" : "text-down"}`}>{netA.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-[14px] font-semibold text-ink">Book B — fixed 0.5% stop</h2>
          <p className="mt-0.5 text-[11.5px] text-ink3">The same picks, every position closed at the live price the moment it is 0.5% against us. Exits at live quotes, not bar closes.</p>
          {legsB.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-ink3">
              {state.data.sl05_error
                ? `Book B could not be read from the research box: ${state.data.sl05_error}`
                : chosen.status === "no_session"
                  ? "Holiday — no legs."
                  : chosen.skip
                    ? "No trade — day skipped."
                    : !servedB
                      ? "Older than the legs served to this dashboard — the record on the research box still holds them."
                      : chosen.status === "settled"
                        ? "No Book B legs stored for this day."
                        : "Book B legs appear as they close; a position may still be open."}
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto print:overflow-visible">
            <table className="w-full border-t border-line">
              <thead>
                <tr>
                  <th className={th}>Leg</th>
                  <th className={th}>Stock</th>
                  <th className={th}>Side</th>
                  <th className={`${th} ${num}`}>Qty</th>
                  <th className={`${th} ${num}`}>Entry ₹</th>
                  <th className={th}>Entry time</th>
                  <th className={`${th} ${num}`}>Exit ₹</th>
                  <th className={th}>Exit time</th>
                  <th className={th}>Exit reason</th>
                  <th className={`${th} ${num}`}>Charges ₹</th>
                  <th className={`${th} ${num}`}>Net ₹</th>
                </tr>
              </thead>
              <tbody>
                {legsB.map((t) => (
                  <tr key={t.leg + t.symbol}>
                    <td className={td}>{LEG_NAME[t.leg] ?? ((t.side ?? -1) < 0 ? "Short" : "Long")}</td>
                    <td className={`${td} font-semibold`}>{t.symbol}</td>
                    <td className={td}>{t.side == null ? "—" : t.side < 0 ? "SELL → BUY" : "BUY → SELL"}</td>
                    <td className={`${td} ${num}`}>{t.qty ?? "—"}</td>
                    <td className={`${td} ${num}`}>{t.entry.toFixed(2)}</td>
                    <td className={td}>{atTime(t.entry_at)}</td>
                    <td className={`${td} ${num}`}>{t.exit?.toFixed(2) ?? "—"}</td>
                    <td className={td}>{atTime(t.exit_at)}</td>
                    <td className={td}>{t.open ? "open" : t.why ?? "—"}</td>
                    <td className={`${td} ${num}`}>{t.costs?.toFixed(2) ?? "—"}</td>
                    <td className={`${td} ${num} font-semibold ${t.open ? "text-ink3" : t.net >= 0 ? "text-up" : "text-down"}`}>
                      {t.open ? "—" : t.net.toFixed(2)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className={`${td} font-semibold`} colSpan={10}>
                    Day total{openLegsB > 0 ? ` (closed legs only — ${openLegsB} still open)` : ""}
                  </td>
                  <td className={`${td} ${num} font-semibold ${netB >= 0 ? "text-up" : "text-down"}`}>{netB.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
        </section>

        <section className="mt-6 grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-3">
          <div>
            <p className="font-mono text-[10px] tracking-[0.08em] text-ink3 uppercase">Record to date (Book A)</p>
            <p className={`tnum mt-0.5 font-semibold ${r.net_rs >= 0 ? "text-up" : "text-down"}`}>{inr(r.net_rs)} · {r.pct_of_book >= 0 ? "+" : "−"}{Math.abs(r.pct_of_book).toFixed(2)}%</p>
          </div>
          <div>
            <p className="font-mono text-[10px] tracking-[0.08em] text-ink3 uppercase">This month ({monthKey})</p>
            <p className="tnum mt-0.5 font-semibold text-ink">{monthPct == null ? "—" : `${monthPct >= 0 ? "+" : "−"}${Math.abs(monthPct).toFixed(2)}%`}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] tracking-[0.08em] text-ink3 uppercase">Report generated</p>
            <p className="mt-0.5 text-ink">{STAMP.format(new Date())} IST</p>
          </div>
        </section>

        <footer className="mt-6 border-t border-line pt-3 text-[10.5px] leading-relaxed text-ink3">
          <p>
            PAPER TRADING RECORD — a simulation run on live NSE prices through Groww&apos;s market-data API. No order was placed with any broker and no money was deployed.
            Figures are net of modelled brokerage, statutory charges and slippage. Past or simulated performance is not a guarantee of future results. This document is
            an internal research record of MNHA Financials, not investment advice and not an offer of any service.
          </p>
        </footer>
      </div>
    </div>
  );
}
