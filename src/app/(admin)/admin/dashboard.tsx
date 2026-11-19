import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardHead, Pill, StatTile } from "@/components/ui";
import { AGREEMENT_VERSION, INVITE_TO_SIGN, isAcceptedVersion } from "@/lib/consent";
import { holidayListNotice } from "@/lib/market";
import type { LiveSummary } from "@/lib/research";
import type { AdminData } from "./sections";

/**
 * The admin dashboard: what needs attention today, the headline numbers, the
 * onboarding funnel, money, the live paper book, and the
 * latest activity. Every tile links to the page that owns it.
 */

const IST = "Asia/Kolkata";
const DAY = 24 * 3600 * 1000;
const LONG_DATE = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: IST });
const LOG_TIME = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const inr2 = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
const eyebrow = "font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase";
const isPast = (ts: number) => Date.now() >= ts;
type Tone = "warn" | "down" | "neutral";
function startOfToday(): number {
  const t = new Date();
  t.setUTCHours(0, 0, 0, 0);
  return t.getTime();
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function More({ href, children = "Open" }: { href: string; children?: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink2 hover:text-ink">
      {children} <Arrow />
    </Link>
  );
}

/* ------------------------------------------------------------ header */
export function Hero({ d }: { d: AdminData }) {
  const dueCount = d.countInv("due");
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div>
        <p className={eyebrow}>{LONG_DATE.format(new Date())} · IST</p>
        <h1 className="pub-display mt-1 text-[36px] leading-[1.02] text-ink sm:text-[44px]">Dashboard</h1>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink3">
          The platform&apos;s own books. Groww stays the source of truth for fills and money; a dash means not recorded.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {d.pendingKyc > 0 && (
          <Link href="/admin/kyc" className="inline-flex h-9 items-center gap-2 rounded-lg bg-warnsoft px-3 text-[12.5px] font-semibold text-warn">
            {d.pendingKyc} KYC to review <Arrow />
          </Link>
        )}
        {dueCount > 0 && (
          <Link href="/admin/fees" className="inline-flex h-9 items-center gap-2 rounded-lg bg-downsoft px-3 text-[12.5px] font-semibold text-down">
            {dueCount} invoice{dueCount > 1 ? "s" : ""} due <Arrow />
          </Link>
        )}
        <Pill tone="violet">Admin</Pill>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ key figures */
export function KeyStats({ d }: { d: AdminData }) {
  const placedToday = d.countStatus(d.ordersToday, "placed");
  const rejectedToday = d.countStatus(d.ordersToday, "rejected");
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile label="Users" value={String(d.users.length)} sub={`${d.last7} new in 7 days`} />
      <StatTile label="Groww connected" value={String(d.connected)} sub={`${d.users.length - d.connected} not yet`} />
      <StatTile label="KYC in review" value={String(d.pendingKyc)} sub={`${d.kyc.length} submitted`} tone={d.pendingKyc > 0 ? "down" : "neutral"} />
      <StatTile label="Active members" value={String(d.activeMembers.length)} sub="performance-fee" />
      <StatTile label="Orders today" value={String(placedToday)} sub={rejectedToday ? `${rejectedToday} rejected` : "none rejected"} tone={rejectedToday > 0 ? "down" : "neutral"} />
      <StatTile label="Fees outstanding" value={inr(d.sumFee("due"))} sub={`${inr(d.sumFee("paid"))} collected`} tone={d.sumFee("due") > 0 ? "down" : "neutral"} />
    </div>
  );
}

/* ------------------------------------------------------------ attention */
export function Attention({ d }: { d: AdminData }) {
  const noAddress = d.users.filter((u) => u.hasBroker && !u.brokerStaticIp);
  const ended = d.activeMembers.filter((m) => isPast(m.periodEndsAt));
  const onOld = d.users.filter((u) => !d.signedNow.has(u.id) && d.signedOld.has(u.id));
  // An earlier version that still counts blocks nothing: 3.3 signers are only invited to sign the
  // new one, and 3.4 signers need nothing. A version that no longer counts must be signed again.
  const mustResign = onOld.filter((u) => !isAcceptedVersion(d.signedOld.get(u.id)?.agreementVersion ?? ""));
  const invited = onOld.filter((u) => INVITE_TO_SIGN.includes(d.signedOld.get(u.id)?.agreementVersion ?? "")).length;
  const holidayNote = holidayListNotice();
  const all: { n: number; text: string; href: string; tone: Tone }[] = [
    { n: d.pendingKyc, text: "identity verification waiting for review", href: "/admin/kyc", tone: "warn" },
    { n: d.countInv("due"), text: `fee invoice${d.countInv("due") === 1 ? "" : "s"} due, ${inr2(d.sumFee("due"))}`, href: "/admin/fees", tone: "down" },
    { n: ended.length, text: "member period ended, not settled yet", href: "/admin/fees", tone: "warn" },
    { n: noAddress.length, text: "connected account without an order address", href: "/admin/accounts", tone: "down" },
    { n: mustResign.length, text: "signed an agreement version that no longer counts, so must sign again", href: "/admin/consents", tone: "warn" },
    { n: invited, text: `on an earlier agreement that still counts, invited to sign v${AGREEMENT_VERSION}`, href: "/admin/consents", tone: "neutral" },
    { n: d.countStatus(d.ordersToday, "rejected"), text: "order rejected today", href: "/admin/orders", tone: "down" },
  ];
  const items = all.filter((x) => x.n > 0);
  return (
    <Card>
      <CardHead title="Needs attention" sub={items.length || holidayNote ? "Things a person has to act on." : "Nothing waiting on you right now."} />
      {holidayNote && <p role="status" className="mb-2 rounded-md bg-warnsoft px-3 py-2 text-[12.5px] leading-snug text-ink">{holidayNote}</p>}
      {items.length > 0 && (
        <ul className="divide-y divide-line">
          {items.map((it) => (
            <li key={it.text}>
              <Link href={it.href} className="group flex items-center gap-3 py-2.5 text-[13px] text-ink hover:text-ink">
                <span className={`tnum inline-flex min-w-[2rem] justify-center rounded-md px-1.5 py-0.5 font-mono text-[12px] font-semibold ${it.tone === "down" ? "bg-downsoft text-down" : it.tone === "warn" ? "bg-warnsoft text-warn" : "bg-surface2 text-ink2"}`}>
                  {it.n}
                </span>
                <span className="flex-1">{it.text}</span>
                <span className="text-ink3 group-hover:text-ink"><Arrow /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ funnel */
export function Funnel({ d }: { d: AdminData }) {
  const total = d.users.length;
  return (
    <Card>
      <CardHead title="Onboarding funnel" sub="Each step counts only people who passed every earlier step." right={<More href="/admin/accounts">Accounts</More>} />
      <ol className="space-y-3">
        {d.funnel.map((f, i) => {
          const p = total > 0 ? Math.round((f.n / total) * 100) : 0;
          return (
            <li key={f.label}>
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="text-ink">
                  <span className="mr-2 font-mono text-[10.5px] text-ink3">{i + 1}</span>
                  {f.label}
                </span>
                <span className="tnum text-ink2">
                  <span className="font-semibold text-ink">{f.n}</span> <span className="text-ink3">· {p}%</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface2" aria-hidden="true">
                <div className="h-full rounded-full bg-mark" style={{ width: `${p}%` }} />
              </div>
              {f.hint && <p className="mt-1 truncate text-[11px] text-ink3">{f.hint}</p>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ------------------------------------------------------------ money */
export function Money({ d }: { d: AdminData }) {
  const rows: { label: string; v: number; n: number; tone?: "up" | "down" }[] = [
    { label: "Billed", v: d.sumFee(), n: d.invoices.length },
    { label: "Collected", v: d.sumFee("paid"), n: d.countInv("paid"), tone: "up" },
    { label: "Outstanding", v: d.sumFee("due"), n: d.countInv("due"), tone: d.sumFee("due") > 0 ? "down" : undefined },
    { label: "Waived / no fee", v: d.sumFee("waived"), n: d.countInv("waived") },
  ];
  return (
    <Card>
      <CardHead title="Performance fees" sub="Fee only on profit above each member's previous peak." right={<More href="/admin/fees">Ledger</More>} />
      <dl className="divide-y divide-line">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between py-2.5">
            <dt className="text-[13px] text-ink2">
              {r.label} <span className="font-mono text-[10.5px] text-ink3">({r.n})</span>
            </dt>
            <dd className={`tnum text-[14px] font-semibold ${r.tone === "up" ? "text-up" : r.tone === "down" ? "text-down" : "text-ink"}`}>{inr2(r.v)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 text-center">
        {(["placed", "rejected", "cancelled"] as const).map((s) => (
          <div key={s}>
            <p className={eyebrow}>{s} all-time</p>
            <p className="tnum mt-1 text-[15px] font-semibold text-ink">{d.countStatus(d.orders, s)}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ paper book */
export function PaperSnapshot({ live }: { live: { kind: "ok"; data: LiveSummary } | { kind: "unconfigured" } | { kind: "error"; message: string } }) {
  const r = live.kind === "ok" ? live.data.livex : null;
  const t = r?.today ?? null;
  const mark = r?.mark ?? null;
  const net = r?.net_rs ?? 0;
  return (
    <Card className="border-sideaccent/30">
      <CardHead
        title="Paper trading"
        sub={live.kind === "ok" ? "The intraday rule on live Groww data, no orders. After charges." : live.kind === "unconfigured" ? "Research box not connected." : `Research box unreachable: ${live.message}`}
        right={<More href="/admin/paper">Live view</More>}
      />
      {r && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className={eyebrow}>Net so far</p>
            <p className={`tnum mt-1 text-[20px] font-semibold ${net >= 0 ? "text-up" : "text-down"}`}>{inr(net)}</p>
            <p className="text-[11.5px] text-ink3">{pct(r.pct_of_book)} of ₹5 lakh · {Object.keys(r.sessions).length ? `${r.sessions.settled ?? 0} settled` : "—"}</p>
          </div>
          <div>
            <p className={eyebrow}>Today</p>
            <p className="mt-1 text-[15px] font-semibold text-ink">{t ? (t.skip ? "Skipped (regime)" : t.pick ? `Short ${t.pick}` : "—") : "No decision yet"}</p>
            <p className="text-[11.5px] text-ink3">{t?.flip && t.flip_symbol ? `flipped long ${t.flip_symbol}` : t?.status === "settled" ? "settled" : t ? "open" : "picks at 09:20"}</p>
          </div>
          <div>
            <p className={eyebrow}>Running P&L</p>
            <p className={`tnum mt-1 text-[15px] font-semibold ${(mark?.running_net ?? 0) >= 0 ? "text-up" : "text-down"}`}>{mark ? inr(mark.running_net ?? 0) : "—"}</p>
            <p className="text-[11.5px] text-ink3">{mark ? `marked ${String(Math.floor(mark.minute / 60)).padStart(2, "0")}:${String(mark.minute % 60).padStart(2, "0")} IST` : "during the session"}</p>
          </div>
          <div>
            <p className={eyebrow}>Winning days</p>
            <p className="tnum mt-1 text-[15px] font-semibold text-ink">{r.day_win_rate == null ? "—" : `${Math.round(r.day_win_rate * 100)}%`}</p>
            <p className="text-[11.5px] text-ink3">worst day {r.worst_day_rs == null ? "—" : inr(r.worst_day_rs)}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ activity */
export function RecentOrders({ d }: { d: AdminData }) {
  const rows = d.orders.slice(0, 8);
  const tone = { placed: "up", rejected: "down", cancelled: "neutral", unknown: "neutral" } as const;
  return (
    <Card pad={false}>
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <CardHead title="Latest orders" sub="Sent through MNHA; fills live at Groww." right={<More href="/admin/orders">All orders</More>} />
      </div>
      {rows.length === 0 ? (
        <p className="px-5 pb-6 text-[13px] text-ink3">No orders recorded yet.</p>
      ) : (
        <table className="w-full border-t border-line">
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-line last:border-0">
                <td className="tnum px-4 py-2 text-[11.5px] whitespace-nowrap text-ink3 sm:px-5">{LOG_TIME.format(new Date(o.at))}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <Pill tone={tone[o.status]}>{o.status}</Pill>
                  {o.by === "admin" && <span className="ml-1.5 text-[11px] font-semibold text-warn">by admin</span>}
                </td>
                <td className="tnum px-2 py-2 text-[12.5px] whitespace-nowrap">
                  {o.status === "cancelled" ? <span className="text-ink2">Cancel</span> : (
                    <>
                      <span className={o.side === "BUY" ? "font-semibold text-up" : o.side === "SELL" ? "font-semibold text-down" : "text-ink2"}>{o.side || "—"}</span>{" "}
                      <span className="text-ink">{o.qty} {o.symbol || "—"}</span>
                    </>
                  )}
                </td>
                <td className="max-w-[160px] truncate px-2 py-2 text-[12px] text-ink2 sm:px-5" title={d.who(o.userId)}>{d.who(o.userId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function RecentAccess({ d }: { d: AdminData }) {
  const rows = d.access.slice(0, 6);
  return (
    <Card pad={false}>
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <CardHead title="Admin access" sub="Client accounts opened from this console, and what the admin did inside them." right={<More href="/admin/access">Full log</More>} />
      </div>
      {rows.length === 0 ? (
        <p className="px-5 pb-6 text-[13px] text-ink3">No client account opened yet.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px] sm:px-5">
              <span className="min-w-0 truncate text-ink">{d.emailFor.get(e.userId) ?? <span className="text-ink3">deleted account</span>}</span>
              <span className="shrink-0 text-ink2">
                {e.kind === "open" ? "opened" : e.kind === "close" ? "closed" : (
                  <span className="text-warn">{e.kind === "connect-broker" ? "connected Groww" : e.kind === "order" ? "sent an order" : "sent a cancellation"}</span>
                )}
              </span>
              <span className="tnum shrink-0 text-[11.5px] text-ink3">{LOG_TIME.format(new Date(e.at))}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The last seven days of sign-ups as a tiny bar strip. */
export function Signups({ d }: { d: AdminData }) {
  const start = startOfToday();
  const days = Array.from({ length: 14 }, (_, i) => {
    const s = start - (13 - i) * DAY;
    return { s, n: d.users.filter((u) => u.createdAt >= s && u.createdAt < s + DAY).length };
  });
  const max = Math.max(1, ...days.map((x) => x.n));
  return (
    <Card>
      <CardHead title="Sign-ups, last 14 days" sub={`${days.reduce((t, x) => t + x.n, 0)} new accounts`} />
      <div className="flex h-16 items-end gap-1" aria-hidden="true">
        {days.map((x) => (
          <div key={x.s} className="flex-1 rounded-t bg-brand/80" style={{ height: `${Math.max(6, (x.n / max) * 100)}%`, opacity: x.n ? 1 : 0.25 }} title={`${new Date(x.s).toDateString()}: ${x.n}`} />
        ))}
      </div>
    </Card>
  );
}
