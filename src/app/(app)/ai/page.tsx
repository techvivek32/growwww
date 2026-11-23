import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { getAccount, getNav, getConnectionStatus } from "@/lib/api/broker";
import { marketState } from "@/lib/market";
import WaveArt from "@/components/public/WaveArt";
import AutoRefresh from "@/components/AutoRefresh";
import { getDay, getSettings, ordersOfDay } from "@/lib/liveTrading/store";
import { strategyStatus } from "@/lib/liveTrading/memberStatus";
import { istNow } from "@/lib/liveTrading/util";
import { isTradingDate } from "@/lib/market";
import { tradePermission } from "@/lib/trading";
import { houseConfigured } from "@/lib/api/broker";

export const metadata: Metadata = { title: "Home · MNHA Financials" };
export const dynamic = "force-dynamic";

const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

function Row({ n, label, value, note, tone = "ink" }: { n: string; label: string; value: string; note?: string; tone?: "ink" | "up" | "warn" | "muted" }) {
  const cls = tone === "up" ? "text-up" : tone === "warn" ? "text-warn" : tone === "muted" ? "text-ink3" : "text-ink";
  return (
    <li className="grid grid-cols-[2.25rem_1fr] gap-x-4 gap-y-1 border-b border-line py-5 sm:grid-cols-[2.5rem_14rem_1fr]">
      <span className="font-mono text-[11px] text-ink3">{n}</span>
      <span className="text-[12px] font-semibold tracking-[0.1em] text-ink uppercase">{label}</span>
      <span className="col-start-2 sm:col-start-3">
        <span className={`block text-[16px] font-medium ${cls}`}>{value}</span>
        {note && <span className="mt-1 block text-[13.5px] leading-relaxed text-ink3">{note}</span>}
      </span>
    </li>
  );
}

/**
 * The home page. Everything on it is read live: the market session, and for a
 * member their own Groww link and order address. It says plainly which orders
 * can reach the account: the holder's own, MNHA's automatic strategy's (and
 * whether it is sending real orders now), and the admin's.
 */
export default async function HomePage() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  const isOwner = uid === OWNER_ID;

  const t = istNow();
  const trading = isTradingDate(t.date);
  const [account, nav, conn, live, perm, today, todays] = await Promise.all([
    getAccount(),
    getNav(),
    getConnectionStatus(),
    getSettings().catch(() => null),
    tradePermission(uid).catch(() => null),
    trading ? getDay(t.day, t.date).catch(() => null) : Promise.resolve(null),
    trading ? ordersOfDay(t.day).catch(() => []) : Promise.resolve([]),
  ]);
  const orderIp = conn.orderIp;
  const ms = marketState();
  const connected = account.balance !== null;
  const whoSends = isOwner
    ? "Your own orders go to Groww only when you confirm them."
    : "Your own orders go to Groww only when you confirm them; MNHA's admin can also send orders to your account.";
  const keptOut = live ? live.excluded.includes(uid) : false;
  const baseRs = live?.base ?? 500_000;
  const base = `₹${baseRs.toLocaleString("en-IN")}`;
  // This account's own standing, not just the switch: an account without a usable order
  // address, or with less than the base free, takes no part even while the strategy is on.
  const free = account.balance !== null ? Math.max(0, account.balance - (account.usedMargin ?? 0)) : null;
  // Once today's accounts are fixed (the day's first strategy order) and until the 15:15 close
  // (15:32 at the latest), what this account actually got today decides — not a fresh look at cash
  // or the switch: the strategy's margin lowers free cash, and what the day opened is closed in the
  // mode it began in, whatever the switch says now.
  // The whole tree moved to lib/liveTrading/memberStatus.ts so the phone can
  // say the same sentence about the same account. Two copies of it would
  // eventually disagree with each other about someone else's open positions.
  const strategy = strategyStatus({
    uid,
    today,
    todays,
    live,
    minute: t.minute,
    keptOut,
    isOwner,
    houseReady: houseConfigured(),
    addressAllowed: Boolean(perm?.allowed),
    hasCredentials: conn.credentials,
    free,
    baseRs,
    baseLabel: base,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <AutoRefresh seconds={60} />

      {/* hero */}
      <section className="relative overflow-hidden border border-line">
        <div className="absolute inset-0">
          <WaveArt variant="band" uid="ai-hero" />
        </div>
        <div className="relative p-5 sm:p-10">
          <div className="max-w-[34rem] bg-surface p-7 sm:p-10">
            <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] text-ink3 uppercase">
              <span className={`h-2 w-2 rounded-full ${ms.isLive ? "live-dot bg-up" : "bg-ink3"}`} />
              {ms.label} · {ms.clock}
            </p>
            <h1 className="pub-display mt-5 text-[clamp(2.6rem,6vw,4.2rem)] leading-[0.98] text-ink">
              Your desk, <em>{ms.isLive ? "live." : "ready."}</em>
            </h1>
            <p className="mt-5 text-[15.5px] leading-relaxed text-ink2">
              {connected
                ? "Your own Groww account on one calm desk: holdings, positions, orders and live option chains."
                : "Your desk shows your own Groww account as soon as it can be read. This page refreshes itself."}
            </p>
            <p className="mt-4 border-l-2 border-mark pl-3.5 text-[13.5px] leading-relaxed text-ink2">
              <strong className="text-ink">MNHA&apos;s automatic intraday strategy</strong> trades connected accounts whose Groww key
              has MNHA&apos;s order address and that have the base amount free, as your agreement describes; every order shows in your
              notifications. {whoSends}
            </p>
          </div>
        </div>
      </section>

      {/* live status */}
      <section className="mt-10">
        <h2 className="pub-display text-[28px] leading-tight text-ink">Status</h2>
        <ul className="mt-4 border-t border-ink/80">
          <Row n="01" label="Market" value={ms.label} note={`${ms.date} · ${ms.clock} · NSE session 09:15–15:30 IST`} tone={ms.isLive ? "up" : "muted"} />
          {!isOwner && (
            <Row
              n="02"
              label="Your Groww"
              value={connected ? "Connected" : "Not reachable right now"}
              note={
                connected
                  ? `${account.ucc ? `Client ••••${account.ucc.slice(-4)} · ` : ""}Account value ${nav ? `${inr(nav.nav)} (cash + holdings)` : "—"}`
                  : "We could not read your account just now. Your money is unaffected — it stays with Groww."
              }
              tone={connected ? "up" : "warn"}
            />
          )}
          {!isOwner && (
            <Row
              n="03"
              label="Order address"
              value={orderIp ?? "Not assigned yet"}
              note={
                orderIp
                  ? "Reserved for your account; register it on your Groww key. Groww accepts API orders only from the address registered on the key, so yours are always sent from it — and one address serves one account, so it is never shared."
                  : "No address is reserved for your account yet, so the exchange would refuse an order. Reconnect Groww from Settings and we will give you one."
              }
              tone={orderIp ? "up" : "warn"}
            />
          )}
          <Row
            n={isOwner ? "02" : "04"}
            label="Orders"
            value={strategy.value}
            note={`On a trading day the strategy may short one F&O stock at about 09:20 and buy one at about 10:15, closing both by about 15:15 — intraday only, ${base} a trade, in accounts with at least that much free. ${whoSends} Every result is yours.`}
            tone={strategy.tone}
          />
        </ul>
      </section>

      {/* where to look */}
      <section className="mt-10 grid gap-px border border-line bg-line sm:grid-cols-3">
        {(
          [
            ["/portfolio/holdings", "Portfolio", "Your holdings and their live value."],
            ["/fno/chain", "Option chain", "Live strikes, premiums and open interest."],
            ["/indices", "Indices", "NIFTY, BANK NIFTY, SENSEX and more, live."],
          ] as const
        ).map(([href, title, body]) => (
          <Link key={href} href={href} className="group bg-surface p-6 transition-colors hover:bg-surfaceh">
            <span className="pub-display block text-[24px] leading-tight text-ink">
              {title} <span className="pub-arrow text-[18px]">→</span>
            </span>
            <span className="mt-2 block text-[13.5px] leading-relaxed text-ink3">{body}</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
