import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAdminPage } from "@/lib/access";
import { Card, PageHead, Pill } from "@/components/ui";
import AutoRefresh from "@/components/AutoRefresh";
import { liveToday } from "@/lib/research";
import { checkAccounts, type AccountCheck } from "@/lib/liveTrading/accounts";
import { ACTION_LABEL, getDay, getSettings, ordersOfDay, recentChanges, type LiveOrder } from "@/lib/liveTrading/store";
import { executorStatus } from "@/lib/liveTrading/executor";
import { clock, istMinuteOfEpoch, istNow } from "@/lib/liveTrading/util";
import { isTradingDate } from "@/lib/market";
import { listUsers } from "@/lib/users";
import { OWNER_ID } from "@/lib/auth";
import { liveCancelOrder, liveExclude, liveRefresh } from "./actions";
import { BaseForm, ExitFlow, ModeForm, OrderFlow, type AccountOption } from "./LiveForms";

export const metadata: Metadata = { title: "Live trading · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

const IST = "Asia/Kolkata";
const TIME = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: IST });
const DATE_TIME = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const eyebrow = "font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase";
const btnLine = "h-8 border border-line2 px-2.5 text-[12px] font-medium text-ink2 transition-colors hover:bg-surfaceh hover:text-ink";

function CardTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="pub-display text-[22px] leading-tight text-ink">{title}</h2>
        {sub && <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

const STATE_TONE: Record<string, "up" | "down" | "warn" | "neutral" | "violet"> = {
  placed: "up",
  rejected: "down",
  refused: "down",
  "not-sent": "neutral",
  unknown: "warn",
  sending: "warn",
  shadow: "violet",
};

const GROUPS: { key: AccountCheck["group"]; title: string; sub: string }[] = [
  { key: "eligible", title: "Eligible", sub: "Take every automatic strategy order." },
  { key: "low", title: "Low balance", sub: "Free money below the base value: no automatic orders until it is topped up." },
  { key: "blocked", title: "Cannot trade", sub: "Something is missing; the reason is shown." },
  { key: "reading", title: "Being read", sub: "Groww has not answered for these yet; they appear in their group on the next refresh." },
  { key: "excluded", title: "Kept out", sub: "Kept out of the automatic strategy by you. Manual orders and exits still reach them." },
];

export default async function LiveTradingPage({ searchParams }: { searchParams: Promise<{ erase?: string }> }) {
  await requireAdminPage();
  const now = istNow();
  const settings = await getSettings();
  const [day, orders, changes, today, checks, users, sp] = await Promise.all([
    getDay(now.day, now.date),
    ordersOfDay(now.day),
    recentChanges(25),
    liveToday(),
    // A page never waits long on Groww: past 4 s the last reading stands in (see checkAccounts).
    checkAccounts(settings, { maxAgeMs: 60_000, budgetMs: 4_000 }).catch(() => [] as AccountCheck[]),
    listUsers(),
    searchParams,
  ]);
  const exec = executorStatus();
  // Every account by id — notes and the change log name accounts only by id ({{acct:<id>}}), never by email.
  const labels = new Map<string, string>([[OWNER_ID, "House account"], ...users.map((u) => [u.id, u.email] as [string, string])]);
  const named = (text: string) => text.replace(/\{\{acct:([^}]+)\}\}/g, (_m, id: string) => labels.get(id) ?? "an erased account");
  const options: AccountOption[] = checks.map((c) => ({ id: c.id, label: c.label, group: c.group, free: c.funds?.free ?? null }));
  const suggestions = [day.legs.short?.symbol, day.legs.long?.symbol, today?.pick, today?.flip?.symbol].filter((s, i, a): s is string => Boolean(s) && a.indexOf(s) === i);
  const tradingDay = isTradingDate(now.date);
  const tradingOff = process.env.TRADING_ENABLED === "false";
  const unsure = orders.filter((o) => o.state === "unknown" || o.state === "sending");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AutoRefresh seconds={20} />
      <PageHead
        title="Live trading"
        sub="Book A of the paper-trading engine, traded in real Groww accounts — every connected account with the base value free. Plus orders and exits for many accounts at once."
        right={<Pill tone={settings.mode === "live" ? "up" : "neutral"}>{settings.mode === "live" ? "ON · real orders" : "OFF"}</Pill>}
      />

      {(sp.erase === "held" || tradingOff || !exec.started || exec.stalled || unsure.length > 0 || (exec.research && !exec.research.ok)) && (
        <Card>
          <ul className="space-y-1.5 text-[13px]">
            {sp.erase === "held" && (
              <li className="text-down">
                That account was NOT deleted: MNHA has (or could not confirm it no longer has) a position or an order open in it today. Close it with Exit below, or delete it after 15:35 IST.
              </li>
            )}
            {tradingOff && <li className="text-down">Order placement is switched off on this server (TRADING_ENABLED=false): every real order is refused before it is sent.</li>}
            {!exec.started && <li className="text-down">The live executor is not running in this server process — restart the website.</li>}
            {exec.stalled && (
              <li className="text-down">
                The live executor is stuck (last finished pass {exec.lastTickAt ? TIME.format(new Date(exec.lastTickAt)) : "never"}) — restart the website, then check the orders and positions.
              </li>
            )}
            {exec.research && !exec.research.ok && <li className="text-warn">The research engine could not be read at {TIME.format(new Date(exec.research.at))}: automatic steps wait for it (the 15:15 close does not).</li>}
            {unsure.length > 0 && <li className="text-warn">{unsure.length} order{unsure.length === 1 ? "" : "s"} of unknown outcome — being looked up in Groww by reference; nothing is re-sent.</li>}
            {exec.lastError && <li className="text-warn">Last executor error: {exec.lastError}</li>}
          </ul>
        </Card>
      )}

      <Card pad={false}>
        <CardTitle
          title="Automatic trading"
          sub="One switch. OFF opens nothing new — but a position the strategy already opened that day is still protected and closed (market stop, 10:15 cover, fail-safe, 15:15), never left without its stop. To close everything at once, use Exit below."
        />
        <div className="space-y-5 px-5 py-4">
          <ModeForm on={settings.mode === "live"} />
          <BaseForm base={settings.base} />
          <p className="text-[12px] leading-relaxed text-ink3">
            Every trade is the base value ÷ the live price, rounded down (with a 0.3% cushion), the same quantity in every account. An account takes part only with at least the base value free (cash minus margin in use) when the day&apos;s accounts are fixed at 09:20.
          </p>
        </div>
      </Card>

      <Card pad={false}>
        <CardTitle
          title={`Today · ${now.date}`}
          sub={tradingDay ? "The research engine decides; this site trades it. Times are IST." : "Not a trading day."}
        />
        <div className="grid gap-px border-b border-line bg-line sm:grid-cols-4">
          <Fact label="09:20 pick" value={today?.status ? (today.skip ? "Skip day" : (today.pick ?? "—")) : "Not decided"} sub={today?.decided_at ? `decided ${clock(istMinuteOfEpoch(today.decided_at))}${today.late ? " (late)" : ""}` : undefined} />
          <Fact
            label="Market stop"
            value={
              day.signals.mstop?.failsafe
                ? `Fail-safe ${clock(istMinuteOfEpoch(day.signals.mstop.at))}`
                : today?.mstop
                  ? `Hit ${clock(istMinuteOfEpoch(today.mstop.at))}`
                  : "Not hit"
            }
            sub={
              today?.mstop_check
                ? `watcher checked ${clock(istMinuteOfEpoch(today.mstop_check.at))}${today.mstop_check.move != null ? ` · average ${today.mstop_check.move >= 0 ? "+" : ""}${(today.mstop_check.move * 100).toFixed(2)}%` : ""}`
                : "stops at average stock +0.5% since 09:20"
            }
          />
          <Fact label="10:15 flip" value={today?.flip ? (today.flip.do ? `Buy ${today.flip.symbol}` : "No flip") : "Not yet"} sub={today?.flip ? `decided ${clock(istMinuteOfEpoch(today.flip.at))}` : undefined} />
          <Fact label="Day's accounts" value={day.accounts ? String(day.accounts.length) : "Not fixed"} sub={day.mode ? `${day.mode} · base ${inr(day.base ?? settings.base)}` : undefined} />
        </div>
        <div className="grid gap-px border-b border-line bg-line sm:grid-cols-5">
          {(["entry", "stop", "flipCover", "flip", "close"] as const).map((k) => (
            <Fact
              key={k}
              label={{ entry: "Entry", stop: "Stop", flipCover: "Flip cover", flip: "Flip buy", close: "15:15 close" }[k]}
              value={day.done[k] ? `Done ${TIME.format(new Date(day.done[k]!))}` : "Pending"}
            />
          ))}
        </div>
        {day.notes.length === 0 ? (
          <p className="px-5 py-4 text-[12.5px] text-ink3">Nothing yet today.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto px-5 py-4 text-[12.5px]">
            {[...day.notes].reverse().map((n, i) => (
              <li key={i} className="flex gap-3">
                <span className="tnum shrink-0 text-ink3">{TIME.format(new Date(n.at))}</span>
                <span className={n.tone === "error" ? "text-down" : n.tone === "warn" ? "text-warn" : "text-ink2"}>{named(n.text)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card pad={false}>
        <CardTitle
          title="Accounts"
          sub={`Every account with Groww connected. Eligible: orders can be sent from its address, the agreement is signed, and at least ${inr(settings.base)} is free. Cash is read from Groww (kept a minute).`}
          right={
            <form action={liveRefresh}>
              <button type="submit" className={btnLine}>
                Read again
              </button>
            </form>
          }
        />
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
                  <span className="ml-2 text-[12px] font-normal text-ink3">{grp.sub}</span>
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.id} className="border-b border-line last:border-0">
                          <td className="max-w-[260px] truncate px-5 py-2.5 text-ink">{c.label}</td>
                          <td className="tnum px-3 py-2.5 whitespace-nowrap text-ink2">
                            {c.funds ? `${inr(c.funds.free)} free` : "cash —"}
                            {c.funds && c.funds.used > 0 ? <span className="text-ink3"> ({inr(c.funds.cash)} cash, {inr(c.funds.used)} in use)</span> : null}
                          </td>
                          <td className="px-3 py-2.5 text-ink3">{c.owner ? "house account" : c.agreement ? `agreement ${c.agreement.split(" ")[0]}` : "—"}</td>
                          <td className="px-3 py-2.5 text-ink3">{c.reason ?? ""}</td>
                          <td className="px-5 py-2.5 text-right">
                            <form action={liveExclude}>
                              <input type="hidden" name="accountId" value={c.id} />
                              <input type="hidden" name="exclude" value={c.excluded ? "0" : "1"} />
                              <button type="submit" className={btnLine}>
                                {c.excluded ? "Take back in" : "Keep out"}
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </Card>

      <Card pad={false}>
        <CardTitle title="Today's orders" sub="Every order live trading sent or simulated today, automatic and yours. An order of unknown outcome is looked up in Groww by its reference, never sent twice." />
        <OrdersTable orders={orders} labels={labels} />
      </Card>

      <Card pad={false}>
        <CardTitle title="Order to many accounts" sub="NSE cash. Preview first: the quantity is worked out from the amount and the live price (or the limit price), the same in every ticked account. Real orders, whatever the mode." />
        <div className="px-5 py-4">
          <OrderFlow accounts={options} base={settings.base} />
        </div>
      </Card>

      <Card pad={false}>
        <CardTitle
          title="Positions and exit"
          sub="Reads each ticked account's open positions from Groww (cash and F&O). Closing sends the opposite market order for the exact open quantity, with the same product. Shares sold from holdings, and anything Groww reports unclearly, are left alone. A position the strategy holds counts as closed for it."
        />
        <div className="px-5 py-4">
          <ExitFlow accounts={options} suggestions={suggestions} />
        </div>
      </Card>

      <Card pad={false}>
        <CardTitle title="Changes" sub="Every change to live trading's settings, with the admin's IP." />
        {changes.length === 0 ? (
          <p className="px-5 py-4 text-[12.5px] text-ink3">No changes yet. Automatic trading starts OFF, with a base value of ₹5,00,000.</p>
        ) : (
          <ul className="space-y-1 px-5 py-4 text-[12.5px]">
            {changes.map((c, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="tnum text-ink3">{DATE_TIME.format(new Date(c.at))}</span>
                <span className="text-ink">{named(c.what)}</span>
                <span className="font-mono text-[11px] text-ink3">{c.ip}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 bg-surface px-5 py-3.5">
      <p className={eyebrow}>{label}</p>
      <p className="mt-1.5 truncate text-[15px] font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] text-ink3">{sub}</p>}
    </div>
  );
}

function OrdersTable({ orders, labels }: { orders: LiveOrder[]; labels: Map<string, string> }) {
  if (!orders.length) return <p className="px-5 py-6 text-center text-[13px] text-ink3">No orders today.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] border-collapse text-left">
        <thead>
          <tr className={`border-b border-line ${eyebrow}`}>
            <th className="px-4 py-3 font-medium">Time</th>
            <th className="px-4 py-3 font-medium">Step</th>
            <th className="px-4 py-3 font-medium">Account</th>
            <th className="px-4 py-3 font-medium">Order</th>
            <th className="px-4 py-3 font-medium">State</th>
            <th className="px-4 py-3 text-right font-medium">Filled</th>
            <th className="px-4 py-3 text-right font-medium">Avg ₹</th>
            <th className="px-4 py-3 font-medium">Groww</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {[...orders].reverse().map((o) => (
            <tr key={o.id} className="border-b border-line last:border-0">
              <td className="tnum px-4 py-2.5 text-[12px] whitespace-nowrap text-ink2">{TIME.format(new Date(o.at))}</td>
              <td className="px-4 py-2.5 text-[12px] whitespace-nowrap text-ink2">
                {ACTION_LABEL[o.action]}
                {o.source === "admin" && <span className="ml-1.5 text-[11px] font-semibold text-warn">admin</span>}
              </td>
              <td className="max-w-[200px] truncate px-4 py-2.5 text-[12px] text-ink" title={labels.get(o.accountId) ?? o.accountId}>
                {labels.get(o.accountId) ?? o.accountId}
              </td>
              <td className="tnum px-4 py-2.5 text-[12.5px] whitespace-nowrap">
                <span className={o.side === "BUY" ? "font-semibold text-up" : "font-semibold text-down"}>{o.side}</span> {o.qty.toLocaleString("en-IN")} {o.symbol}
                <span className="ml-1 text-[10.5px] text-ink3">
                  {o.product} {o.type === "LIMIT" && o.price != null ? `@ ${o.price}` : "MKT"}
                </span>
              </td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <Pill tone={STATE_TONE[o.state] ?? "neutral"}>{o.state}</Pill>
                {o.status && o.state !== "shadow" && <span className="ml-1.5 text-[11px] text-ink3">{o.status.toLowerCase()}</span>}
              </td>
              <td className="tnum px-4 py-2.5 text-right text-[12px] text-ink2">{o.filled ?? "—"}</td>
              <td className="tnum px-4 py-2.5 text-right text-[12px] text-ink2">{o.avg != null ? o.avg.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</td>
              <td className="max-w-[260px] truncate px-4 py-2.5 text-[11.5px] text-ink3" title={o.message ?? undefined}>
                {o.orderId ? <span className="font-mono">{o.orderId} </span> : null}
                {o.message ?? ""}
              </td>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
