import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/access";
import { dayLogs, type DayLog, type LogDayIndex } from "@/lib/research";
import { Card, CardHead, Pill } from "@/components/ui";
import ManualExit from "../ManualExit";

export const metadata: Metadata = { title: "Day logs · Paper trading · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

const inr = (v: number | null | undefined) => (v == null ? "—" : `${v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`);
const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
const th = "px-3 py-2 text-left font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase";
const td = "px-3 py-2 text-[12.5px] text-ink";
const tone = (v: number | null | undefined) => (v == null ? "text-ink3" : v > 0 ? "text-up" : v < 0 ? "text-down" : "text-ink3");
const DAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const PER_PAGE = 10;

const LEG_NAME: Record<string, string> = { short: "Short (09:20 pick)", flip_long: "Flip long (10:15)", admin_long: "Admin long (reversal)", admin_short: "Admin short (re-opened)" };
const EVENT_NAME: Record<string, string> = {
  mstop: "Market stop fired", mstop_check: "Market stop check (last)", admin_reverse: "Admin: short covered by hand", admin_close_long: "Admin: long sold by hand",
  admin_reshort: "Admin: short re-opened by hand", admin_close_reshort: "Admin: re-opened short covered by hand", flip: "10:15 flip decision",
};

/**
 * One trading day per page, everything the research box recorded for it, in
 * plain words: what Book A decided and why, what it did, what Book B did, what
 * the active and manual books did, and the running marks through the day.
 */
export default async function LogsPage({ searchParams }: { searchParams: Promise<{ day?: string; page?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const state = await dayLogs(sp.day);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">Admin · Research · Paper trading</p>
        <h1 className="pub-display mt-1 text-[28px] leading-tight text-ink">Day logs</h1>
        <p className="mt-1 max-w-[72ch] text-[13px] leading-snug text-ink3">
          Every trading day, one page at a time: Book A&apos;s 09:20 decision and the reasons, every leg with entry, exit, time and why it exited, Book B&apos;s legs, the active and manual paper trades, the admin&apos;s hand, and the running marks through the day. Read straight off the research box; nothing is recomputed here.
        </p>
      </div>
      {state.kind !== "ok" && (
        <Card><CardHead title={state.kind === "unconfigured" ? "Not connected" : "Research box unreachable"} sub={state.kind === "error" ? state.message : "Set RESEARCH_API_URL and RESEARCH_API_TOKEN."} /></Card>
      )}
      {state.kind === "ok" && <Body days={state.days} log={state.log} page={Math.max(1, Number(sp.page ?? 1) || 1)} />}
    </div>
  );
}

function Body({ days, log, page }: { days: LogDayIndex[]; log: DayLog | null; page: number }) {
  const pages = Math.max(1, Math.ceil(days.length / PER_PAGE));
  const cur = Math.min(page, pages);
  const slice = days.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);
  const i = log ? days.findIndex((d) => d.day === log.day) : -1;
  const newer = i > 0 ? days[i - 1] : null;
  const older = i >= 0 && i < days.length - 1 ? days[i + 1] : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <Card pad={false} className="self-start">
        <div className="p-4 pb-2"><CardHead title="Days" sub={`${days.length} sessions · page ${cur} of ${pages}`} /></div>
        <ul className="border-t border-line">
          {slice.map((d) => (
            <li key={d.day} className={`border-b border-line last:border-0 ${log?.day === d.day ? "bg-paper2" : ""}`}>
              <Link href={`/admin/paper/logs?day=${d.day}&page=${cur}`} className="flex items-center justify-between px-4 py-2 text-[12.5px] hover:bg-paper2">
                <span><span className="font-semibold text-ink">{d.day}</span> <span className="text-ink3">{d.weekday}</span></span>
                <span className={`tnum ${tone(d.book_a_net)}`}>{d.skip ? "skip" : d.status === "settled" ? inr(d.book_a_net) : (d.status ?? "—")}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[12px]">
          {cur > 1 ? <Link className="font-semibold text-ink hover:underline" href={`/admin/paper/logs?page=${cur - 1}${log ? `&day=${log.day}` : ""}`}>← Newer</Link> : <span className="text-ink3">← Newer</span>}
          <span className="text-ink3">{cur} / {pages}</span>
          {cur < pages ? <Link className="font-semibold text-ink hover:underline" href={`/admin/paper/logs?page=${cur + 1}${log ? `&day=${log.day}` : ""}`}>Older →</Link> : <span className="text-ink3">Older →</span>}
        </div>
      </Card>

      {log ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="pub-display text-[22px] text-ink">{DAY.format(new Date(log.day))}</h2>
            <div className="flex gap-3 text-[12.5px]">
              {older ? <Link className="font-semibold text-ink hover:underline" href={`/admin/paper/logs?day=${older.day}&page=${cur}`}>← {older.day}</Link> : <span className="text-ink3">← older</span>}
              {newer ? <Link className="font-semibold text-ink hover:underline" href={`/admin/paper/logs?day=${newer.day}&page=${cur}`}>{newer.day} →</Link> : <span className="text-ink3">newer →</span>}
            </div>
          </div>
          <BookA log={log} />
          <Events log={log} />
          <BookB log={log} />
          <Trades log={log} />
          <Marks log={log} />
        </div>
      ) : (
        <Card><CardHead title="Nothing recorded yet" sub="The first session will appear here." /></Card>
      )}
    </div>
  );
}

function BookA({ log }: { log: DayLog }) {
  const a = log.book_a;
  const adminRev = log.events.find((e) => e.kind === "admin_reverse");
  if (!a) return <Card><CardHead title="Book A" sub="No decision recorded for this day (the session did not run, or it was a holiday)." /></Card>;
  const flags = a.flags as { n_gap_top20?: boolean; breadth_top20?: boolean; monday?: boolean; skip?: boolean };
  const why = [flags.n_gap_top20 ? "NIFTY gap in the top 20%" : null, flags.breadth_top20 ? "first-bar breadth in the top 20%" : null, flags.monday ? "Monday" : null].filter(Boolean);
  return (
    <Card pad={false}>
      <div className="p-4 sm:p-5 pb-0 sm:pb-0">
        <CardHead
          title="Book A (the tested rule)"
          sub={a.skip
            ? `Skipped: two or more of the regime flags were set (${why.join(", ") || "flags"}), so no trade was taken.`
            : `09:20 decision at ${a.decided_at ?? "—"}: SHORT ${a.pick ?? "—"} at ₹${a.pick_px?.toFixed(2) ?? "—"} (the lowest score among ${a.n_rows ?? "—"} names; ${why.length ? `regime flags set: ${why.join(", ")}` : "no regime flags"}). 10:15 flip: ${adminRev ? `superseded by the admin, who ${String(adminRev.info.mode ?? "reverse") === "cover" ? "covered the short" : "reversed the short into a long"} at ${adminRev.time ?? "—"} (₹${adminRev.value?.toFixed(2) ?? "—"})` : a.flip == null ? "not yet decided" : a.flip ? `YES → ${a.flip_symbol ?? "—"} at ₹${a.flip_px?.toFixed(2) ?? "—"}${a.flip_at ? ` (${a.flip_at})` : ""}` : "no (the average stock was not strong enough)"}. ${a.settled_at ? `Settled at ${a.settled_at}.` : "Not settled yet."}`}
          right={<Pill tone={a.net == null ? "neutral" : a.net >= 0 ? "up" : "down"}>{a.status}{a.net != null ? ` · ${inr(a.net)}` : ""}</Pill>}
        />
        {a.info && <p className="mt-2 text-[12px] text-ink3">{a.info}</p>}
      </div>
      {a.legs.length > 0 && (
        <table className="mt-3 w-full border-t border-line">
          <thead><tr className="border-b border-line"><th className={th}>Leg</th><th className={th}>Trade</th><th className={`${th} text-right`}>Entry</th><th className={`${th} text-right`}>Exit</th><th className={th}>Exit reason</th><th className={`${th} text-right`}>Gross</th><th className={`${th} text-right`}>Charges</th><th className={`${th} text-right`}>Net</th></tr></thead>
          <tbody>
            {a.legs.map((l) => (
              <tr key={`${l.leg}-${l.symbol}`} className="border-b border-line last:border-0">
                <td className={td}>{LEG_NAME[l.leg] ?? l.leg}</td>
                <td className={td}><span className={`font-semibold ${l.side < 0 ? "text-down" : "text-up"}`}>{l.side < 0 ? "SELL" : "BUY"}</span> {l.qty} {l.symbol}</td>
                <td className={`${td} tnum text-right`}>₹{l.entry.toFixed(2)} <span className="text-ink3">{l.entry_time}</span></td>
                <td className={`${td} tnum text-right`}>₹{l.exit.toFixed(2)} <span className="text-ink3">{l.exit_time}</span></td>
                <td className={`${td} text-ink2`}>{l.exit_reason === "time" ? "15:15 square-off" : l.exit_reason}</td>
                <td className={`${td} tnum text-right`}>{inr(l.gross)}</td>
                <td className={`${td} tnum text-right text-ink3`}>{inr(-l.costs)}</td>
                <td className={`${td} tnum text-right font-semibold ${tone(l.net)}`}>{inr(l.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Events({ log }: { log: DayLog }) {
  if (!log.events.length) return null;
  return (
    <Card pad={false}>
      <div className="p-4 sm:p-5 pb-0 sm:pb-0"><CardHead title="What happened, in order" sub="Every event the session recorded: the market-stop checks, the flip, the admin's hand." /></div>
      <table className="mt-3 w-full border-t border-line">
        <thead><tr className="border-b border-line"><th className={th}>Time</th><th className={th}>Event</th><th className={`${th} text-right`}>Bar</th><th className={`${th} text-right`}>Value</th><th className={th}>Details</th></tr></thead>
        <tbody>
          {log.events.map((e) => (
            <tr key={e.kind} className="border-b border-line last:border-0">
              <td className={`${td} tnum`}>{e.time ?? "—"}</td>
              <td className={`${td} font-semibold`}>{EVENT_NAME[e.kind] ?? e.kind}</td>
              <td className={`${td} tnum text-right text-ink3`}>{e.bar_time ?? "—"}</td>
              <td className={`${td} tnum text-right`}>{e.value == null ? "—" : e.kind.startsWith("mstop") ? pct(e.value * 100) : `₹${e.value.toLocaleString("en-IN")}`}</td>
              <td className={`${td} text-ink3`}>{Object.entries(e.info).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function BookB({ log }: { log: DayLog }) {
  if (!log.book_b.length) return null;
  const net = log.book_b.reduce((s, l) => s + (l.net ?? 0), 0);
  return (
    <Card pad={false}>
      <div className="p-4 sm:p-5 pb-0 sm:pb-0"><CardHead title="Book B (same picks, fixed 0.5% stop)" sub="Each leg closed at the live price the moment it was 0.5% against, otherwise like Book A." right={<Pill tone={net >= 0 ? "up" : "down"}>{inr(net)}</Pill>} /></div>
      <table className="mt-3 w-full border-t border-line">
        <thead><tr className="border-b border-line"><th className={th}>Leg</th><th className={th}>Trade</th><th className={`${th} text-right`}>Entry</th><th className={`${th} text-right`}>Exit</th><th className={th}>Why</th><th className={`${th} text-right`}>Charges</th><th className={`${th} text-right`}>Net</th></tr></thead>
        <tbody>
          {log.book_b.map((l) => (
            <tr key={`${l.book}-${l.leg}`} className="border-b border-line last:border-0">
              <td className={td}>{l.leg}</td>
              <td className={td}><span className={`font-semibold ${l.side < 0 ? "text-down" : "text-up"}`}>{l.side < 0 ? "SELL" : "BUY"}</span> {l.qty} {l.symbol}</td>
              <td className={`${td} tnum text-right`}>₹{l.entry.toFixed(2)} <span className="text-ink3">{l.entry_time}</span></td>
              <td className={`${td} tnum text-right`}>{l.exit == null ? "open" : `₹${l.exit.toFixed(2)}`} <span className="text-ink3">{l.exit_time ?? ""}</span></td>
              <td className={`${td} text-ink2`}>{l.why ?? "—"}</td>
              <td className={`${td} tnum text-right text-ink3`}>{l.costs == null ? "—" : inr(-l.costs)}</td>
              <td className={`${td} tnum text-right font-semibold ${tone(l.net)}`}>{inr(l.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Trades({ log }: { log: DayLog }) {
  if (!log.trades.length) return null;
  const sum = (book: "active" | "manual") => log.trades.filter((m) => (m.book === "active" ? "active" : "manual") === book).reduce((s, m) => s + (m.net ?? 0), 0);
  const aNet = sum("active");
  const mNet = sum("manual");
  const nA = log.trades.filter((m) => m.book === "active").length;
  const nM = log.trades.length - nA;
  return (
    <Card pad={false}>
      <div className="p-4 sm:p-5 pb-0 sm:pb-0"><CardHead title="Active (auto) & manual (admin) trades" sub="Active (auto): the all-day scan book; the program found and entered these itself (the Why column says who closed each one). Manual (admin): trades the admin asked for. Not part of Book A or Book B." right={<span className="flex flex-wrap justify-end gap-2">{nA > 0 && <Pill tone={aNet >= 0 ? "up" : "down"}>active {inr(aNet)}</Pill>}{nM > 0 && <Pill tone={mNet >= 0 ? "up" : "down"}>manual {inr(mNet)}</Pill>}</span>} /></div>
      <table className="mt-3 w-full border-t border-line">
        <thead><tr className="border-b border-line"><th className={th}>Book</th><th className={th}>Trade</th><th className={`${th} text-right`}>Entry</th><th className={`${th} text-right`}>Exit</th><th className={th}>Why</th><th className={th}>Reason for entry</th><th className={`${th} text-right`}>Net</th></tr></thead>
        <tbody>
          {log.trades.map((m) => (
            <tr key={`${m.symbol}-${m.entry_time}`} className="border-b border-line last:border-0 align-top">
              <td className={`${td} font-mono text-[10.5px] uppercase text-ink3`}>{m.book === "active" ? "active · auto" : "manual · admin"}</td>
              <td className={td}><span className={`font-semibold ${m.side === "short" ? "text-down" : "text-up"}`}>{m.side === "short" ? "SELL" : "BUY"}</span> {m.qty} {m.symbol}</td>
              <td className={`${td} tnum text-right`}>₹{m.entry.toFixed(2)} <span className="text-ink3">{m.entry_time.slice(0, 5)}</span></td>
              <td className={`${td} tnum text-right`}>{m.status === "closed" ? `₹${m.exit?.toFixed(2)}` : "open"} <span className="text-ink3">{m.exit_time?.slice(0, 5) ?? ""}</span></td>
              <td className={`${td} text-ink2`}>{m.why ?? (m.status === "open" ? "open" : "—")}</td>
              <td className={`${td} max-w-[34ch] text-[11.5px] text-ink3`}>{(m as { note?: string }).note ?? "—"}</td>
              <td className={`${td} tnum text-right font-semibold ${tone(m.net)}`}>{m.status === "closed" ? inr(m.net) : <ManualExit symbol={m.symbol} entryTime={m.entry_time} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Marks({ log }: { log: DayLog }) {
  if (!log.marks.length) return null;
  return (
    <Card pad={false}>
      <div className="p-4 sm:p-5 pb-0 sm:pb-0"><CardHead title="Running marks through the day (Book A)" sub="The live price, the running P&L and the average stock's move since 09:20 (the market stop watches +0.5%), as recorded during the session. Before charges." /></div>
      <div className="max-h-[420px] overflow-auto">
        <table className="mt-3 w-full border-t border-line">
          <thead className="sticky top-0 bg-paper"><tr className="border-b border-line"><th className={th}>Time</th><th className={th}>Phase</th><th className={`${th} text-right`}>Pick LTP</th><th className={`${th} text-right`}>Short P&L</th><th className={`${th} text-right`}>Market since 09:20</th><th className={`${th} text-right`}>Flip LTP</th><th className={`${th} text-right`}>Flip P&L</th><th className={`${th} text-right`}>Running</th></tr></thead>
          <tbody>
            {log.marks.map((m) => (
              <tr key={m.minute} className="border-b border-line last:border-0">
                <td className={`${td} tnum`}>{m.time}</td>
                <td className={`${td} text-ink3`}>{m.phase}</td>
                <td className={`${td} tnum text-right`}>{m.pick_ltp?.toFixed(2) ?? "—"}</td>
                <td className={`${td} tnum text-right ${tone(m.pick_pnl)}`}>{inr(m.pick_pnl)}</td>
                <td className={`${td} tnum text-right`}>{m.mkt_move == null ? "—" : pct(m.mkt_move * 100)}</td>
                <td className={`${td} tnum text-right`}>{m.flip_ltp?.toFixed(2) ?? "—"}</td>
                <td className={`${td} tnum text-right ${tone(m.flip_pnl)}`}>{inr(m.flip_pnl)}</td>
                <td className={`${td} tnum text-right font-semibold ${tone(m.running_net)}`}>{inr(m.running_net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
