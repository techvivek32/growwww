import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAdminPage } from "@/lib/access";
import { Card, PageHead, Pill } from "@/components/ui";
import AutoRefresh from "@/components/AutoRefresh";
import { liveToday } from "@/lib/research";
import { checkAccounts, type AccountCheck } from "@/lib/liveTrading/accounts";
import { ACTION_LABEL, getDay, getSettings, ordersOfDay, type LiveOrder } from "@/lib/liveTrading/store";
import { executorStatus } from "@/lib/liveTrading/executor";
import { clock, istMinuteOfEpoch, istNow } from "@/lib/liveTrading/util";
import { isTradingDate } from "@/lib/market";
import { listUsers } from "@/lib/users";
import { OWNER_ID } from "@/lib/auth";
import { liveCancelOrder, liveExclude, liveRefresh } from "./actions";
import { BaseForm, LivePositions, ActiveModeForm, ModeForm, OrderFlow, type AccountOption } from "./LiveForms";

export const metadata: Metadata = { title: "Live trading · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

const IST = "Asia/Kolkata";
const HM = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
const HMS = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: IST });
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const n = (v: number) => v.toLocaleString("en-IN");
const eyebrow = "font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase";
const btnLine = "h-8 border border-line2 px-2.5 text-[12px] font-medium text-ink2 transition-colors hover:bg-surfaceh hover:text-ink";

type Tone = "up" | "down" | "warn" | "neutral";

function Section({ title, sub, right, children }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="pub-display text-[22px] leading-tight text-ink">{title}</h2>
          {sub && <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink3">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </Card>
  );
}

/** A tool kept folded away until it is needed. */
function Fold({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <Card pad={false}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 hover:bg-surfaceh">
          <span className="min-w-0">
            <span className="pub-display block text-[20px] leading-tight text-ink">{title}</span>
            <span className="mt-0.5 block text-[12.5px] text-ink3">{sub}</span>
          </span>
          <span className="shrink-0 text-[18px] text-ink3 transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="border-t border-line px-5 py-4">{children}</div>
      </details>
    </Card>
  );
}

const GROUPS: { key: AccountCheck["group"]; title: string; sub: (base: string) => string }[] = [
  { key: "eligible", title: "Trading", sub: () => "Get every automatic trade." },
  { key: "low", title: "Low balance", sub: (base) => `Less than ${base} free — no automatic trades until topped up.` },
  { key: "blocked", title: "Not ready", sub: () => "Something is missing (shown)." },
  { key: "reading", title: "Checking", sub: () => "Groww has not answered yet." },
  { key: "excluded", title: "Kept out", sub: () => "Kept out by you. Manual orders and exits still reach them." },
];

export default async function LiveTradingPage({ searchParams }: { searchParams: Promise<{ erase?: string }> }) {
  await requireAdminPage();
  const now = istNow();
  const settings = await getSettings();
  const [day, orders, today, checks, users, sp] = await Promise.all([
    getDay(now.day, now.date),
    ordersOfDay(now.day),
    liveToday(),
    // A page never waits long on Groww: past 4 s the last reading stands in (see checkAccounts).
    checkAccounts(settings, { maxAgeMs: 60_000, budgetMs: 4_000 }).catch(() => [] as AccountCheck[]),
    listUsers(),
    searchParams,
  ]);
  const exec = executorStatus();
  // Notes name accounts only by id ({{acct:<id>}}), never by email: named here, when shown.
  const labels = new Map<string, string>([[OWNER_ID, "House account"], ...users.map((u) => [u.id, u.email] as [string, string])]);
  const named = (text: string) => text.replace(/\{\{acct:([^}]+)\}\}/g, (_m, id: string) => labels.get(id) ?? "an erased account");
  const options: AccountOption[] = checks.map((c) => ({ id: c.id, label: c.label, group: c.group, free: c.funds?.free ?? null }));
  const tradingDay = isTradingDate(now.date);
  const tradingOff = process.env.TRADING_ENABLED === "false";
  const unsure = orders.filter((o) => o.state === "unknown" || o.state === "sending");
  const on = settings.mode === "live";
  const base = inr(day.base ?? settings.base);
  const eligible = checks.filter((c) => c.group === "eligible").length;
  const alerts = day.notes.filter((x) => x.tone === "error" || x.tone === "warn");

  const problems: { text: string; tone: "down" | "warn" }[] = [];
  if (sp.erase === "held") problems.push({ tone: "down", text: "That account was NOT deleted: MNHA has a position or order open in it today. Close it with Exit below, or delete it after 15:35." });
  if (tradingOff) problems.push({ tone: "down", text: "Orders are switched off on this server (TRADING_ENABLED=false): nothing real can be sent." });
  if (!exec.started) problems.push({ tone: "down", text: "Automatic trading is not running on the server — restart the website." });
  if (exec.stalled) problems.push({ tone: "down", text: `Automatic trading is stuck (last run ${exec.lastTickAt ? HMS.format(new Date(exec.lastTickAt)) : "never"}) — restart the website, then check orders and positions.` });
  if (exec.research && !exec.research.ok) problems.push({ tone: "warn", text: `The research engine did not answer at ${HMS.format(new Date(exec.research.at))}: steps wait for it (the 15:15 close does not).` });
  if (unsure.length) problems.push({ tone: "warn", text: `${unsure.length} order${unsure.length === 1 ? "" : "s"} being checked with Groww — nothing is sent twice.` });
  if (problems.length && exec.lastError) problems.push({ tone: "warn", text: `Last error: ${exec.lastError}` });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <AutoRefresh seconds={20} />
      <PageHead
        title="Live trading"
        sub={`The paper strategy's trades, placed for real in every account with at least ${inr(settings.base)} free.`}
        right={<Pill tone={on ? "up" : "neutral"}>{on ? "ON" : "OFF"}</Pill>}
      />

      {problems.length > 0 && (
        <Card>
          <ul className="space-y-1.5 text-[13px]">
            {problems.map((p, i) => (
              <li key={i} className={p.tone === "down" ? "text-down" : "text-warn"}>
                {p.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 1. The switch and the size */}
      <Card>
        <div className="space-y-4">
          <ModeForm on={on} />
          <ActiveModeForm on={(settings.activeMode ?? "off") === "live"} />
          <BaseForm base={settings.base} />
        </div>
      </Card>

      {/* 2. Today */}
      <Section
        title="Today"
        sub={tradingDay ? `${now.date} · ${day.accounts ? `${day.accounts.length} account${day.accounts.length === 1 ? "" : "s"} trading` : `${eligible} account${eligible === 1 ? "" : "s"} ready`} · ${base} each` : `${now.date} · market closed`}
      >
        <ol className="divide-y divide-line">
          <Step
            time="09:20"
            title="Sell (short)"
            done={day.done.entry}
            value={
              !tradingDay
                ? "Market closed"
                : today?.skip
                  ? "Skip day — no trade today"
                  : day.done.entry
                    ? day.legs.short
                      ? `Sold ${n(day.legs.short.qty)} ${day.legs.short.symbol}`
                      : "No trade (see alerts)"
                    : today?.pick
                      ? `${today.pick} — sending…`
                      : "Waiting for 09:20"
            }
          />
          <Step
            time="Stop"
            title="If the market rises 0.5%, buy back"
            done={day.done.stop}
            value={
              day.done.stop
                ? day.signals.mstop
                  ? day.signals.mstop.failsafe
                    ? `Bought back for safety at ${clock(istMinuteOfEpoch(day.signals.mstop.at))} (the stop check went quiet)`
                    : `Hit ${clock(istMinuteOfEpoch(day.signals.mstop.at))} — bought back`
                  : "Done"
                : day.signals.mstop || today?.mstop
                  ? "Hit — buying back…"
                  : day.legs.short
                    ? "Not hit"
                    : "—"
            }
          />
          <Step
            time="10:15"
            title="Flip"
            done={day.done.flip}
            value={
              day.done.flip
                ? day.legs.long
                  ? `Bought ${n(day.legs.long.qty)} ${day.legs.long.symbol}`
                  : today?.flip && !today.flip.do
                    ? "No flip — the short is held"
                    : "No flip buy (see alerts)"
                : today?.flip
                  ? today.flip.do
                    ? `Buying ${today.flip.symbol ?? ""}…`
                    : "No flip"
                  : "Waiting for 10:15"
            }
          />
          <Step time="15:15" title="Close everything" done={day.done.close} value={day.done.close ? "Closed" : "Waiting for 15:15"} />
        </ol>
        {alerts.length > 0 && (
          <ul className="space-y-1 border-t border-line px-5 py-3 text-[12.5px]">
            {[...alerts].reverse().map((x, i) => (
              <li key={i} className="flex gap-3">
                <span className="tnum shrink-0 text-ink3">{HM.format(new Date(x.at))}</span>
                <span className={x.tone === "error" ? "text-down" : "text-warn"}>{named(x.text)}</span>
              </li>
            ))}
          </ul>
        )}
        {day.notes.length > 0 && (
          <details className="border-t border-line px-5 py-3">
            <summary className="cursor-pointer text-[12.5px] text-ink3 hover:text-ink">Full log ({day.notes.length})</summary>
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-[12.5px]">
              {[...day.notes].reverse().map((x, i) => (
                <li key={i} className="flex gap-3">
                  <span className="tnum shrink-0 text-ink3">{HMS.format(new Date(x.at))}</span>
                  <span className={x.tone === "error" ? "text-down" : x.tone === "warn" ? "text-warn" : "text-ink2"}>{named(x.text)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      {/* 3. Open positions, live */}
      <Section title="Open positions" sub="Every account, read from Groww every 2 seconds.">
        <div className="px-5 py-4">
          <LivePositions />
        </div>
      </Section>

      {/* 4. Accounts */}
      <Section
        title="Accounts"
        right={
          <form action={liveRefresh}>
            <button type="submit" className={btnLine}>
              Refresh
            </button>
          </form>
        }
      >
        {checks.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-ink3">No account has Groww connected.</p>
        ) : (
          GROUPS.map((grp) => {
            const rows = checks.filter((c) => c.group === grp.key);
            if (!rows.length) return null;
            return (
              <div key={grp.key} className="border-b border-line last:border-0">
                <p className="px-5 pt-3.5 text-[13px] font-semibold text-ink">
                  {grp.title} <span className="tnum font-mono text-[12px] text-ink3">({rows.length})</span>
                  <span className="ml-2 text-[12px] font-normal text-ink3">{grp.sub(inr(settings.base))}</span>
                </p>
                <ul>
                  {rows.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-2.5 text-[12.5px] last:border-0">
                      <span className="min-w-0 flex-1 truncate text-ink">{c.label}</span>
                      <span className="tnum text-ink2">{c.funds ? `${inr(c.funds.free)} free` : "cash —"}</span>
                      {c.reason && grp.key !== "low" && grp.key !== "excluded" && <span className="basis-full text-ink3 sm:basis-auto">{c.reason}</span>}
                      <form action={liveExclude}>
                        <input type="hidden" name="accountId" value={c.id} />
                        <input type="hidden" name="exclude" value={c.excluded ? "0" : "1"} />
                        <button type="submit" className={btnLine}>
                          {c.excluded ? "Take back in" : "Keep out"}
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </Section>

      {/* 5. Today's orders */}
      <Section title="Today's orders">
        <OrdersTable orders={orders} labels={labels} />
      </Section>

      {/* 6. A manual order, folded away */}
      <Fold title="Send an order" sub="Buy or sell one share in all or chosen accounts — preview first, then send.">
        <OrderFlow accounts={options} base={settings.base} />
      </Fold>
    </div>
  );
}

function Step({ time, title, value, done }: { time: string; title: string; value: string; done: number | null | undefined }) {
  return (
    <li className="flex items-center gap-4 px-5 py-3">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] ${done ? "bg-upsoft text-up" : "border border-line2 text-ink3"}`}>{done ? "✓" : ""}</span>
      <span className="tnum w-12 shrink-0 font-mono text-[12px] text-ink3">{time}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] text-ink">{title}</span>
        <span className={`block text-[12.5px] ${done ? "text-ink2" : "text-ink3"}`}>
          {value}
          {done ? ` · ${HM.format(new Date(done))}` : ""}
        </span>
      </span>
    </li>
  );
}

/** What happened to an order, in plain words. */
function statusOf(o: LiveOrder): { text: string; tone: Tone } {
  const filled = o.filled ?? 0;
  const st = (o.status ?? "").toUpperCase();
  switch (o.state) {
    case "placed":
      if (!o.final) return { text: filled > 0 ? `Filling ${n(filled)}/${n(o.qty)}` : "Working", tone: "warn" };
      if (filled >= o.qty) return { text: "Filled", tone: "up" };
      if (filled > 0) return { text: `Part filled ${n(filled)}/${n(o.qty)}`, tone: "warn" };
      if (st.includes("REJECT") || st.includes("FAIL")) return { text: "Rejected", tone: "down" };
      if (st.includes("CANCEL")) return { text: "Cancelled", tone: "neutral" };
      return { text: "Not filled", tone: "neutral" };
    case "rejected":
      return { text: "Rejected", tone: "down" };
    case "refused":
      return { text: "Not sent", tone: "down" };
    case "not-sent":
      return { text: "Did not reach Groww", tone: "neutral" };
    case "unknown":
    case "sending":
      return { text: "Checking with Groww", tone: "warn" };
    default:
      return { text: "Practice (not sent)", tone: "neutral" };
  }
}

function OrdersTable({ orders, labels }: { orders: LiveOrder[]; labels: Map<string, string> }) {
  if (!orders.length) return <p className="px-5 py-6 text-center text-[13px] text-ink3">No orders today.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className={`border-b border-line ${eyebrow}`}>
            <th className="px-4 py-3 font-medium">Time</th>
            <th className="px-4 py-3 font-medium">Account</th>
            <th className="px-4 py-3 font-medium">Order</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Price ₹</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {[...orders].reverse().map((o) => {
            const s = statusOf(o);
            const why = o.state === "rejected" || o.state === "refused" || s.tone === "down" ? o.message : null;
            return (
              <tr key={o.id} className="border-b border-line align-top last:border-0">
                <td className="tnum px-4 py-2.5 text-[12px] whitespace-nowrap text-ink2">{HM.format(new Date(o.at))}</td>
                <td className="max-w-[200px] truncate px-4 py-2.5 text-[12px] text-ink" title={labels.get(o.accountId) ?? o.accountId}>
                  {labels.get(o.accountId) ?? o.accountId}
                </td>
                <td className="px-4 py-2.5 text-[12.5px]">
                  <span className="tnum whitespace-nowrap">
                    <span className={o.side === "BUY" ? "font-semibold text-up" : "font-semibold text-down"}>{o.side}</span> {n(o.qty)} {o.symbol}
                  </span>
                  <span className="block text-[11px] text-ink3">
                    {o.source === "admin" ? "by you" : ACTION_LABEL[o.action]}
                    {o.type === "LIMIT" && o.price != null ? ` · limit ₹${o.price}` : ""}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <Pill tone={s.tone}>{s.text}</Pill>
                  {why && <span className="mt-1 block max-w-[260px] text-[11px] text-ink3">{why}</span>}
                </td>
                <td className="tnum px-4 py-2.5 text-right text-[12px] text-ink2">{o.avg != null ? o.avg.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  {o.mode === "live" && o.state === "placed" && !o.final && o.orderId ? (
                    <form action={liveCancelOrder}>
                      <input type="hidden" name="id" value={o.id} />
                      <button type="submit" className={btnLine} title="Ask Groww to cancel what is left of this order">
                        Cancel
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
