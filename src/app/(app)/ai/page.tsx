import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { getAccount, getNav, getConnectionStatus } from "@/lib/api/broker";
import { engineStatus } from "@/lib/signals/engine";
import { STRATEGIES } from "@/lib/signals/strategies";
import { marketState } from "@/lib/market";
import WaveArt from "@/components/public/WaveArt";
import AutoRefresh from "@/components/AutoRefresh";

export const metadata: Metadata = { title: "MNHA AI · MNHA Financials" };
export const dynamic = "force-dynamic";

const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const nowMs = () => Date.now();

function ago(ts: number | null, now: number): string {
  if (!ts) return "not yet";
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

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
 * The member home. Everything on it is read live: the engine's real status,
 * the market session, the member's own Groww link. It states plainly what the
 * AI does today — it studies the market — and that it places no orders on the
 * member's account until automatic trading actually exists and is switched on.
 */
export default async function AiPage() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  const isOwner = uid === OWNER_ID;

  const [account, nav, conn] = await Promise.all([getAccount(), getNav(), getConnectionStatus()]);
  const orderIp = conn.orderIp;
  const engine = engineStatus();
  const ms = marketState();
  const now = nowMs();
  const running = engine.running;
  // "Live" only while the market is open — the engine scans in session.
  const working = running && ms.isLive;
  const connected = account.balance !== null;

  return (
    <div className="mx-auto max-w-5xl">
      <AutoRefresh seconds={60} />

      {/* status hero */}
      <section className="relative overflow-hidden border border-line">
        <div className="absolute inset-0">
          <WaveArt variant="band" uid="ai-hero" />
        </div>
        <div className="relative p-5 sm:p-10">
          <div className="max-w-[34rem] bg-surface p-7 sm:p-10">
            <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] text-ink3 uppercase">
              <span className={`h-2 w-2 rounded-full ${working ? "live-dot bg-up" : "bg-ink3"}`} />
              {working ? "Live" : running ? "Idle" : "Not running"} · {ms.label}
            </p>
            <h1 className="pub-display mt-5 text-[clamp(2.6rem,6vw,4.2rem)] leading-[0.98] text-ink">
              MNHA AI is <em>{working ? "running." : running ? "idle." : "not running."}</em>
            </h1>
            <p className="mt-5 text-[15.5px] leading-relaxed text-ink2">
              {working
                ? `It is studying the NSE right now with ${STRATEGIES.length} rule-based strategies, re-scoring each one on its live outcomes. Last scan ${ago(engine.lastScan, now)}.`
                : running
                  ? `The market is closed, so it is waiting for the next session. It studies the NSE with ${STRATEGIES.length} rule-based strategies during market hours. Last scan ${ago(engine.lastScan, now)}.`
                  : "The engine is not running on our server right now. This page refreshes itself."}
            </p>
            <p className="mt-4 border-l-2 border-mark pl-3.5 text-[13.5px] leading-relaxed text-ink2">
              MNHA AI places <strong className="text-ink">no orders</strong> on your account. Your Groww account is
              shown here read-only.
            </p>
          </div>
        </div>
      </section>

      {/* live status */}
      <section className="mt-10">
        <h2 className="pub-display text-[28px] leading-tight text-ink">Status</h2>
        <ul className="mt-4 border-t border-ink/80">
          <Row
            n="01"
            label="Engine"
            value={working ? (engine.scanning ? "Running · scanning now" : "Running") : running ? "Idle · market closed" : "Not running"}
            note={`Last scan ${ago(engine.lastScan, now)} · strategies re-scored ${ago(engine.lastBacktest, now)}.`}
            tone={working ? "up" : "muted"}
          />
          <Row n="02" label="Market" value={ms.label} note={`${ms.date} · ${ms.clock} · NSE session 09:15–15:30 IST`} tone={ms.isLive ? "up" : "muted"} />
          {!isOwner && (
            <Row
              n="03"
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
              n="04"
              label="Order address"
              value={orderIp ?? "Not assigned yet"}
              note={
                orderIp
                  ? "Reserved for your account and registered on your Groww key. The exchange requires orders to arrive from this address, so yours are always sent from it — and one address serves one account, so it is never shared."
                  : "No address is reserved for your account yet, so the exchange would refuse an order. Reconnect Groww from Settings and we will give you one."
              }
              tone={orderIp ? "up" : "warn"}
            />
          )}
          <Row
            n={isOwner ? "03" : "05"}
            label="Orders"
            value="None placed by MNHA"
            note="MNHA places no orders on your account. Anything you trade, you trade in your Groww app."
            tone="muted"
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
