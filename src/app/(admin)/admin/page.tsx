import type { Metadata } from "next";
import type { ReactNode } from "react";
import { OWNER_ID } from "@/lib/auth";
import { requireAdminPage } from "@/lib/access";
import { listUsers } from "@/lib/users";
import { listKyc } from "@/lib/kyc";
import { listConsents, AGREEMENT_VERSION, type ConsentRecord } from "@/lib/consent";
import { listMembers, listInvoices, accrual, type Membership, type InvoiceStatus } from "@/lib/membership";
import { listOrders, orderStatsByUser, type LedgerStatus } from "@/lib/ledger";
import { registeredIp } from "@/lib/api/groww";
import { engineStatus } from "@/lib/signals/engine";
import { PageHead, Card, CardHead, Pill } from "@/components/ui";
import { adminOpenAccount, adminDisconnectBroker, adminDeleteUser, adminKycDecision, adminScheduleKycCall, adminMarkInvoice, adminAddEgress, adminRemoveEgress } from "./actions";
import { recentAdminAccess } from "@/lib/adminAccess";
import SettleForm from "./SettleForm";
import { listEgress } from "@/lib/egressStore";
import { houseIp } from "@/lib/api/egress";
import { adminEmail, ownerEmail } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;
const IST = "Asia/Kolkata";
const withinDays = (ts: number, days: number) => Date.now() - ts < days * DAY;
const DATE_TIME = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: IST });
const DAY_MON = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: IST });
const DAY_MON_YR = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "2-digit", timeZone: IST });
const LOG_TIME = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: IST });
const IST_DAY_KEY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: IST });
const fmtDate = (ms: number) => DATE_TIME.format(new Date(ms));
const fmtDay = (ms: number) => DAY_MON.format(new Date(ms));
const fmtDayYr = (ms: number) => DAY_MON_YR.format(new Date(ms));
const istDay = (ms: number) => IST_DAY_KEY.format(new Date(ms));
const istToday = () => istDay(Date.now());
const isPast = (ts: number) => Date.now() >= ts;
function ago(ts: number | null): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
/** "in 3d" / "in 5h" for a future timestamp. */
function until(ts: number): string {
  const s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  if (s < 3600) return `in ${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86400)}d`;
}
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
/** Fee amounts keep paise — a ₹0.40 fee must not read as ₹0. */
const inr2 = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const maskUcc = (ucc: string) => `••••${ucc.slice(-4)}`;
const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
const pctOf = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : null);

const LOG_TONE: Record<LedgerStatus, "up" | "down" | "neutral"> = { placed: "up", rejected: "down", cancelled: "neutral", unknown: "neutral" };
const INV_TONE: Record<InvoiceStatus, "warn" | "up" | "neutral"> = { due: "warn", paid: "up", waived: "neutral" };
const KYC_TONE = { approved: "up", rejected: "down", submitted: "warn", none: "neutral" } as const;

const eyebrow = "font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase";
const input = "h-9 border border-line2 bg-surface px-2.5 font-sans text-[12.5px] tracking-normal text-ink normal-case outline-none placeholder:text-ink3 focus:border-ink";
const btnLine = "h-8 border border-line2 px-2.5 text-[12px] font-medium text-ink2 transition-colors hover:bg-surfaceh hover:text-ink";

/** A row of figures on one hairline grid — the cells share their borders. */
function Figs({ cols, children }: { cols: string; children: ReactNode }) {
  return <div className={`grid gap-px border border-line bg-line ${cols}`}>{children}</div>;
}

/** One cell of a Figs grid. */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-4">
      <p className={eyebrow}>{label}</p>
      <p className="tnum mt-2 text-[22px] leading-none font-semibold tracking-[-0.01em] text-ink">{value}</p>
      {sub && <p className="mt-1.5 text-[11.5px] leading-snug text-ink3">{sub}</p>}
    </div>
  );
}

/** Card header for a full-bleed table: serif title, the count in mono. */
function CardTitle({ title, count, sub }: { title: string; count?: string; sub?: string }) {
  return (
    <div className="border-b border-line px-5 py-4">
      <h2 className="pub-display text-[22px] leading-tight text-ink">
        {title}
        {count !== undefined && <span className="tnum ml-1.5 font-mono text-[13px] text-ink3">({count})</span>}
      </h2>
      {sub && <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink3">{sub}</p>}
    </div>
  );
}

export default async function AdminPage() {
  // Admin login only. Anyone else who guesses the URL is sent to their own home.
  await requireAdminPage();

  const [users, kyc, consents, members, invoices, orders, orderStats, access, pool] = await Promise.all([
    listUsers(),
    listKyc(),
    listConsents(),
    listMembers(),
    listInvoices(),
    listOrders(undefined, Number.MAX_SAFE_INTEGER),
    orderStatsByUser(),
    recentAdminAccess(20),
    listEgress(),
  ]);
  const house = houseIp();
  // The two sign-in addresses that are not user records — they never appear in
  // the table below, yet a sign-up with either is told the account exists.
  const reserved = [ownerEmail(), adminEmail()].filter(Boolean) as string[];
  const engine = engineStatus();
  const connected = users.filter((u) => u.hasBroker).length;
  const last7 = users.filter((u) => withinDays(u.createdAt, 7)).length;
  const pendingKyc = kyc.filter((k) => k.status === "submitted").length;
  const activeMembers = members.filter((m) => m.status === "active");
  const emailFor = new Map(users.map((u) => [u.id, u.email]));
  const who = (userId: string) => emailFor.get(userId) ?? (userId === OWNER_ID ? "Owner (house account)" : userId);
  const hasBrokerFor = new Map(users.map((u) => [u.id, u.hasBroker]));

  /* ---------------------------------------------------------------- hisab */
  // consents arrive newest first, so the first record seen per user is their latest.
  const signedNow = new Map<string, ConsentRecord>();
  const signedOld = new Map<string, ConsentRecord>();
  for (const c of consents) {
    const into = c.agreementVersion === AGREEMENT_VERSION ? signedNow : signedOld;
    if (!into.has(c.userId)) into.set(c.userId, c);
  }
  const kycFor = new Map(kyc.map((k) => [k.userId, k]));
  const memberFor = new Map<string, Membership>(members.map((m) => [m.userId, m]));
  const billsFor = new Map<string, { due: number; paid: number }>();
  for (const iv of invoices) {
    const b = billsFor.get(iv.userId) ?? { due: 0, paid: 0 };
    if (iv.status === "due") b.due += iv.feeDue;
    if (iv.status === "paid") b.paid += iv.feeDue;
    billsFor.set(iv.userId, b);
  }

  // A true funnel: each step counts only users who also passed every earlier
  // step, so the numbers can never rise from one step to the next.
  const serverIp = registeredIp();
  const fSigned = users.filter((u) => signedNow.has(u.id) || signedOld.has(u.id));
  const fConnected = fSigned.filter((u) => u.hasBroker);
  const fOrdered = fConnected.filter((u) => (orderStats.get(u.id)?.placed ?? 0) > 0);
  const fMembers = fOrdered.filter((u) => memberFor.get(u.id)?.status === "active");
  const ipOk = fConnected.filter((u) => serverIp !== null && u.brokerStaticIp === serverIp).length;
  const funnel = [
    { label: "Signed up", n: users.length },
    { label: "Agreement signed", n: fSigned.length, hint: `${users.filter((u) => signedNow.has(u.id)).length} on v${AGREEMENT_VERSION}` },
    { label: "Groww connected", n: fConnected.length, hint: serverIp ? `${ipOk} confirmed IP ${serverIp}` : "server IP not set" },
    { label: "Placed ≥1 order", n: fOrdered.length },
    { label: "Active members", n: fMembers.length },
  ];

  const sumFee = (s?: InvoiceStatus) => invoices.filter((iv) => !s || iv.status === s).reduce((t, iv) => t + iv.feeDue, 0);
  const countInv = (s: InvoiceStatus) => invoices.filter((iv) => iv.status === s).length;
  const today = istToday();
  const ordersToday = orders.filter((o) => istDay(o.at) === today);
  const countStatus = (list: typeof orders, s: LedgerStatus) => list.filter((o) => o.status === s).length;
  const orderLog = orders.slice(0, 100);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead
        title="Admin"
        sub="Platform overview and user management. Broker keys are encrypted and never shown here."
        right={<Pill tone="violet">Admin</Pill>}
      />

      <Figs cols="mb-10 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Users" value={String(users.length)} />
        <Stat label="Brokers connected" value={String(connected)} sub={`${users.length - connected} pending`} />
        <Stat label="KYC in review" value={String(pendingKyc)} sub={`${kyc.length} submitted`} />
        <Stat label="Active members" value={String(activeMembers.length)} sub="performance-fee" />
        <Stat label="New (7 days)" value={String(last7)} />
        <Stat label="Signal engine" value={engine.running ? "Running" : "Idle"} sub={`scan ${ago(engine.lastScan)}`} />
      </Figs>

      {/* ============================================================ Hisab */}
      <div className="mb-5 border-t border-line pt-6">
        <h2 className="pub-display text-[32px] leading-tight text-ink">
          The <em>hisab</em>
        </h2>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink3">
          The platform&apos;s own books — onboarding, fees billed and orders sent through MNHA. Groww stays the source of
          truth for fills and money; every number here is read from MNHA&apos;s stores, and a dash means not recorded.
        </p>
      </div>

      {/* onboarding funnel */}
      <Card className="mb-4">
        <CardHead title="Onboarding funnel" sub="Each step as a share of all sign-ups" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5 sm:grid-cols-3 lg:grid-cols-5">
          {funnel.map((f) => {
            const p = pctOf(f.n, users.length);
            return (
              <div key={f.label} className="min-w-0">
                <p className={eyebrow}>{f.label}</p>
                <p className="tnum mt-2 text-[22px] leading-none font-semibold text-ink">
                  {f.n}
                  <span className="ml-1.5 font-mono text-[11.5px] font-normal text-ink3">{p === null ? "—" : `${p}%`}</span>
                </p>
                <div className="mt-2.5 h-1 bg-surface2" aria-hidden="true">
                  <div className="h-full bg-mark" style={{ width: `${p ?? 0}%` }} />
                </div>
                {f.hint && <p className="mt-1.5 truncate text-[11px] text-ink3" title={f.hint}>{f.hint}</p>}
              </div>
            );
          })}
        </div>
      </Card>

      {/* money + orders */}
      <Figs cols="mb-4 grid-cols-2 sm:grid-cols-4">
        <Stat label="Fees billed" value={inr2(sumFee())} sub={`${invoices.length} settled period${invoices.length === 1 ? "" : "s"}`} />
        <Stat label="Collected" value={inr2(sumFee("paid"))} sub={`${countInv("paid")} paid`} />
        <Stat label="Outstanding" value={inr2(sumFee("due"))} sub={`${countInv("due")} due`} />
        <Stat label="Waived" value={inr2(sumFee("waived"))} sub={`${countInv("waived")} waived / no fee`} />
      </Figs>
      <Figs cols="mb-6 grid-cols-1 sm:grid-cols-3">
        <Stat label="Orders placed today" value={String(countStatus(ordersToday, "placed"))} sub="IST calendar day" />
        <Stat label="Rejected today" value={String(countStatus(ordersToday, "rejected"))} sub={`${countStatus(ordersToday, "cancelled")} cancellations today`} />
        <Stat
          label="Orders all-time"
          value={String(orders.length)}
          sub={`${countStatus(orders, "placed")} placed · ${countStatus(orders, "rejected")} rejected · ${countStatus(orders, "unknown")} unknown · ${countStatus(orders, "cancelled")} cancel sent`}
        />
      </Figs>

      {/* accounts — one row per user; replaces the old users table, keeps its actions */}
      <Card pad={false} className="mb-6">
        <CardTitle
          title="Order addresses"
          count={String(pool.length + (house ? 1 : 0))}
          sub="An exchange ties one registered address to one Groww account, so each member needs their own. A new sign-up is handed the first address nobody holds; when none is left, the connect page tells them to call us."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Reached by</th>
                <th className="px-4 py-3 font-medium">Held by</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {house && (
                <tr className="border-b border-line">
                  <td className="px-4 py-3 tnum text-[12.5px] text-ink">{house}</td>
                  <td className="px-4 py-3 text-[12px] text-ink2">This server</td>
                  <td className="px-4 py-3 text-[12px]">
                    {users.find((u) => u.brokerStaticIp === house)?.email ?? <span className="text-up">Free</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-[12px] text-ink3">Built in</td>
                </tr>
              )}
              {pool.map((e) => {
                const holder = users.find((u) => u.brokerStaticIp === e.ip);
                return (
                  <tr key={e.ip} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 tnum text-[12.5px] text-ink">{e.ip}</td>
                    <td className="px-4 py-3 text-[12px] text-ink2">
                      {e.proxy ? `Tunnel ${e.proxy}` : "Bound on this server"}
                      {e.note ? <span className="block text-ink3">{e.note}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      {holder ? holder.email : <span className="text-up">Free</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {holder ? (
                        <span className="text-[12px] text-ink3">In use</span>
                      ) : (
                        <form action={adminRemoveEgress}>
                          <input type="hidden" name="ip" value={e.ip} />
                          <button className="border border-line2 px-2.5 py-1 text-[12px] text-ink2 hover:bg-surfaceh">Remove</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <form action={adminAddEgress} className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">Address</span>
            <input name="ip" required placeholder="72.60.30.154" className="h-9 w-44 border border-line2 bg-surface px-2.5 font-mono text-[12.5px] text-ink outline-none focus:border-ink" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">Tunnel (if another host owns it)</span>
            <input name="proxy" placeholder="http://72.60.30.154:8888" className="h-9 w-60 border border-line2 bg-surface px-2.5 font-mono text-[12.5px] text-ink outline-none focus:border-ink" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">Note</span>
            <input name="note" placeholder="where it came from" className="h-9 w-48 border border-line2 bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-ink" />
          </label>
          <button className="h-9 border border-line2 px-4 text-[12.5px] font-semibold text-ink hover:bg-surfaceh">Add address</button>
        </form>
      </Card>

      <Card pad={false} className="mb-6">
        <CardTitle
          title="Accounts"
          count={String(users.length)}
          sub="One row per user. Orders count only what was sent through MNHA since the order ledger started; NAV is the last value seen in the member's own session."
        />
        {reserved.length > 0 && (
          <p className="border-b border-line px-5 py-3 text-[12px] leading-relaxed text-ink3">
            Reserved sign-in addresses, which are not accounts and never appear below:{" "}
            {reserved.map((e, i) => (
              <span key={e}>
                {i > 0 ? " · " : ""}
                <span className="text-ink2">{e}</span>
              </span>
            ))}
            . A sign-up with either is told the account already exists — by design, so the form cannot be used to find out
            who works here.
          </p>
        )}
        {users.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13.5px] text-ink3">No registered users yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Agreement</th>
                  <th className="px-4 py-3 font-medium">KYC</th>
                  <th className="px-4 py-3 font-medium">Groww</th>
                  <th className="px-4 py-3 font-medium">Orders</th>
                  <th className="px-4 py-3 font-medium">Membership</th>
                  <th className="px-4 py-3 text-right font-medium">Bills</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const now = signedNow.get(u.id);
                  const old = signedOld.get(u.id);
                  const k = kycFor.get(u.id);
                  const st = orderStats.get(u.id);
                  const m = memberFor.get(u.id);
                  const a = m && m.status === "active" && m.lastNav != null ? accrual(m, m.lastNav) : null;
                  const bills = billsFor.get(u.id);
                  return (
                    <tr key={u.id} className="border-b border-line last:border-0 align-top">
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-medium text-ink">{u.email}</p>
                        <p className="tnum text-[11px] text-ink3">{u.id}</p>
                      </td>
                      <td className="tnum px-4 py-3 text-[12px] text-ink2">{fmtDayYr(u.createdAt)}</td>
                      <td className="px-4 py-3 text-[12px]">
                        {now ? (
                          <span className="tnum text-up">✓ {fmtDayYr(now.consentedAt)}</span>
                        ) : old ? (
                          <span className="text-warn" title={`Signed v${old.agreementVersion}`}>Old version · {fmtDayYr(old.consentedAt)}</span>
                        ) : (
                          <span className="text-ink3">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        {k ? <Pill tone={KYC_TONE[k.status]}>{k.status === "submitted" ? "in review" : k.status}</Pill> : <span className="text-ink3">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        {u.hasBroker ? (
                          <div className="space-y-0.5">
                            <p className="inline-flex items-center gap-1.5 text-up">
                              <span className="h-1.5 w-1.5 rounded-full bg-up" />
                              <span className="tnum">{u.brokerConnectedAt ? fmtDayYr(u.brokerConnectedAt) : "Connected"}</span>
                            </p>
                            <p className="tnum text-ink2">UCC {u.brokerUcc ? maskUcc(u.brokerUcc) : "—"}</p>
                            {u.brokerStaticIp ? (
                              <p className="tnum text-ink3" title="Orders for this account are sent from this address, which is the one registered on their Groww key">
                                Orders from {u.brokerStaticIp}
                              </p>
                            ) : (
                              <p className="text-warn" title="Without a registered address the exchange refuses orders on this account">
                                No order address — reconnect needed
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink3">Not connected</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        {st ? (
                          <div className="space-y-0.5">
                            <p className="tnum">
                              <span className="text-up">{st.placed}</span>
                              <span className="text-ink3"> / </span>
                              <span className="text-down">{st.rejected}</span>
                              <span className="text-ink3"> / </span>
                              <span className="text-ink2">{st.cancelled}</span>
                              {st.unknown > 0 && (
                                <>
                                  <span className="text-ink3"> / </span>
                                  <span className="text-warn">{st.unknown}?</span>
                                </>
                              )}
                            </p>
                            <p className="text-[11px] text-ink3">placed / rej / cxl{st.unknown > 0 ? " / unknown" : ""} · last {ago(st.lastAt)}</p>
                          </div>
                        ) : (
                          <span className="text-ink3">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        {m ? (
                          <div className="space-y-0.5">
                            <Pill tone={m.status === "active" ? "up" : "neutral"}>{m.status}</Pill>
                            <p className="tnum text-ink2">HWM {inr(m.highWaterMark)}</p>
                            <p className="tnum text-ink2">
                              NAV {m.lastNav != null ? inr(m.lastNav) : "—"}
                              {m.lastNavAt != null && <span className="text-ink3"> · as of {ago(m.lastNavAt)}</span>}
                            </p>
                            <p className="tnum text-ink2">Fee accrued {a ? inr2(a.feeEstimate) : "—"}</p>
                          </div>
                        ) : (
                          <span className="text-ink3">—</span>
                        )}
                      </td>
                      <td className="tnum px-4 py-3 text-right text-[12px]">
                        {bills ? (
                          <div className="space-y-0.5">
                            <p className={bills.due > 0 ? "font-semibold text-warn" : "text-ink2"}>due {inr2(bills.due)}</p>
                            <p className="text-ink2">paid {inr2(bills.paid)}</p>
                          </div>
                        ) : (
                          <span className="text-ink3">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <form action={adminOpenAccount}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button className="h-8 whitespace-nowrap bg-brand px-2.5 text-[12px] font-semibold text-onbrand transition-colors hover:bg-brandh" title="Open this client's MNHA account exactly as they see it (1 hour, logged)">
                              Open account
                            </button>
                          </form>
                          {u.hasBroker && (
                            <form action={adminDisconnectBroker}>
                              <input type="hidden" name="userId" value={u.id} />
                              <button className={btnLine} title="Remove this user's stored broker credentials">
                                Disconnect
                              </button>
                            </form>
                          )}
                          <form action={adminDeleteUser}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button className="h-8 border border-down/50 px-2.5 text-[12px] font-medium text-down transition-colors hover:bg-downsoft" title="Permanently delete this user">
                              Delete
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* admin access log */}
      <Card pad={false} className="mb-6">
        <CardTitle
          title="Admin access to client accounts"
          count={String(access.length)}
          sub="Every time the admin opens or leaves a client's account through “Open account”. A view lasts one hour at most. Client passwords are stored only as a one-way hash, so they are never shown — and never needed to open an account."
        />
        {access.length === 0 ? (
          <p className="px-5 py-6 text-center text-[13px] text-ink3">No client account has been opened from the console yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
                  <th className="px-5 py-3 font-medium">Time (IST)</th>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Event</th>
                  <th className="px-5 py-3 font-medium">Admin IP</th>
                </tr>
              </thead>
              <tbody>
                {access.map((e, i) => (
                  <tr key={`${e.at}-${i}`} className="border-b border-line last:border-0">
                    <td className="tnum px-5 py-2.5 text-[12px] text-ink2">{LOG_TIME.format(new Date(e.at))}</td>
                    <td className="px-5 py-2.5 text-[12.5px] text-ink">{emailFor.get(e.userId) ?? <span className="text-ink3">deleted account</span>}</td>
                    <td className="px-5 py-2.5 text-[12px]">{e.kind === "open" ? <span className="text-ink">Opened</span> : e.kind === "connect-broker" ? <span className="text-warn">Connected Groww for the client</span> : <span className="text-ink2">Back to admin</span>}</td>
                    <td className="tnum px-5 py-2.5 text-[12px] text-ink3">{e.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* fee ledger */}
      <Card pad={false} className="mb-6">
        <CardTitle
          title="Fee ledger"
          count={String(invoices.length)}
          sub="Settled performance periods. Fee only on profit above the member's previous peak — nothing on a loss."
        />
        <div className="space-y-2 border-b border-line px-5 py-4 text-[12px] leading-relaxed text-ink2">
          <p>
            <strong className="text-ink">Settle now</strong> reads the member&apos;s account value live from Groww with their
            own stored key (cash + holdings at LTP; open F&amp;O positions excluded). If that read fails, nothing is settled —
            a typed or stale value is never used. The last-known NAV below is reference only. Fees are collected out of band
            and are never auto-debited from anyone&apos;s account.
          </p>
          <p className="border-l-2 border-warn bg-warnsoft px-3 py-2 text-ink">
            Deposits/withdrawals during the period are not netted out — waive the invoice if the gain came from a deposit.
          </p>
        </div>

        {activeMembers.length > 0 && (
          <ul className="divide-y divide-line border-b border-line">
            {activeMembers.map((m) => {
              const ended = isPast(m.periodEndsAt);
              const a = m.lastNav != null ? accrual(m, m.lastNav) : null;
              return (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 text-[12px]">
                    <p className="text-[13px] font-medium text-ink">{who(m.userId)}</p>
                    <p className="tnum text-ink3">
                      {ended ? <span className="font-semibold text-warn">Period ended {ago(m.periodEndsAt)}</span> : <>Period ends {fmtDay(m.periodEndsAt)} ({until(m.periodEndsAt)})</>}
                      {" · "}HWM {inr(m.highWaterMark)}
                      {" · "}last-known NAV {m.lastNav != null ? inr(m.lastNav) : "—"}
                      {m.lastNavAt != null && ` (as of ${ago(m.lastNavAt)})`}
                      {a && ` · fee at that NAV ${inr2(a.feeEstimate)}`}
                    </p>
                  </div>
                  {hasBrokerFor.get(m.userId) ? (
                    <SettleForm key={m.userId} userId={m.userId} periodEndsAt={m.periodEndsAt} ended={ended} />
                  ) : (
                    <p className="text-[11.5px] text-ink3">Groww not connected — a live NAV read is impossible, so this period cannot be settled.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {invoices.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink3">No settled periods yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 text-right font-medium">HWM before</th>
                  <th className="px-4 py-3 text-right font-medium">End NAV</th>
                  <th className="px-4 py-3 text-right font-medium">Profit above HWM</th>
                  <th className="px-4 py-3 text-right font-medium">Fee %</th>
                  <th className="px-4 py-3 text-right font-medium">Fee due</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((iv) => (
                  <tr key={iv.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-[12.5px] text-ink">{who(iv.userId)}</p>
                      <p className="tnum text-[10.5px] text-ink3">{iv.id}</p>
                    </td>
                    <td className="tnum px-4 py-3 text-[12px] whitespace-nowrap text-ink2">{fmtDay(iv.periodStart)} → {fmtDay(iv.periodEnd)}</td>
                    <td className="tnum px-4 py-3 text-right text-[12px] text-ink2">{inr(iv.hwmBefore)}</td>
                    <td className="tnum px-4 py-3 text-right text-[12px] text-ink2">{inr(iv.endNav)}</td>
                    <td className={`tnum px-4 py-3 text-right text-[12px] ${iv.profitAboveHwm > 0 ? "text-up" : "text-ink3"}`}>{inr(iv.profitAboveHwm)}</td>
                    <td className="tnum px-4 py-3 text-right text-[12px] text-ink2">{iv.feePct}%</td>
                    <td className="tnum px-4 py-3 text-right text-[12.5px] font-semibold text-ink">{inr2(iv.feeDue)}</td>
                    <td className="px-4 py-3 text-[12px]">
                      <Pill tone={INV_TONE[iv.status]}>{iv.status === "waived" && iv.feeDue === 0 ? "no fee" : iv.status}</Pill>
                      {iv.settledAt != null && iv.status !== "due" && <p className="tnum mt-0.5 text-[10.5px] text-ink3">{fmtDay(iv.settledAt)}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {iv.status === "due" ? (
                        <div className="flex items-center justify-end gap-2">
                          <form action={adminMarkInvoice}>
                            <input type="hidden" name="id" value={iv.id} />
                            <input type="hidden" name="status" value="paid" />
                            <button className="h-8 border border-up/50 px-2.5 text-[12px] font-medium text-up transition-colors hover:bg-upsoft" title="Record that this fee was received out of band">
                              Mark paid
                            </button>
                          </form>
                          <form action={adminMarkInvoice}>
                            <input type="hidden" name="id" value={iv.id} />
                            <input type="hidden" name="status" value="waived" />
                            <button className={btnLine} title="Waive this fee (e.g. the gain came from a deposit)">
                              Waive
                            </button>
                          </form>
                        </div>
                      ) : (
                        <p className="text-right text-[11.5px] text-ink3">—</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* order log */}
      <Card pad={false} className="mb-6">
        <CardTitle
          title="Order log"
          count={`latest ${orderLog.length} of ${orders.length}`}
          sub="Every order sent through MNHA, recorded server-side when the order action ran. Fills and money live at Groww."
        />
        {orderLog.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink3">No orders recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
                  <th className="px-4 py-3 font-medium">Time (IST)</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Groww order id</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {orderLog.map((o) => {
                  const kind = [o.type, o.product, o.segment].filter(Boolean).join(" · ");
                  const price = o.price != null
                    ? `₹${o.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                    : o.type === "MARKET" || o.type === "SL_M" ? "MKT" : "—";
                  return (
                    <tr key={o.id} className="border-b border-line last:border-0">
                      <td className="tnum px-4 py-2.5 text-[12px] whitespace-nowrap text-ink2">{LOG_TIME.format(new Date(o.at))}</td>
                      <td className="max-w-[180px] truncate px-4 py-2.5 text-[12px] text-ink" title={who(o.userId)}>{who(o.userId)}</td>
                      <td className="px-4 py-2.5"><Pill tone={LOG_TONE[o.status]}>{o.status}</Pill></td>
                      <td className="tnum px-4 py-2.5 text-[12.5px] whitespace-nowrap">
                        {o.status === "cancelled" ? (
                          <span className="text-ink2">Cancel</span>
                        ) : (
                          <>
                            <span className={o.side === "BUY" ? "font-semibold text-up" : o.side === "SELL" ? "font-semibold text-down" : "text-ink2"}>{o.side || "—"}</span>{" "}
                            <span className="text-ink">{o.qty} {o.symbol || "—"}</span>
                            {o.exchange && <span className="ml-1 text-[10.5px] text-ink3">{o.exchange}</span>}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[11.5px] whitespace-nowrap text-ink2">{kind || "—"}</td>
                      <td className="tnum px-4 py-2.5 text-right text-[12px] text-ink2">{price}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-ink2" title={o.orderId ?? undefined}>{o.orderId ? shortId(o.orderId) : "—"}</td>
                      <td className="max-w-[240px] truncate px-4 py-2.5 text-[11.5px] text-ink3" title={o.message ?? undefined}>{o.message || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="Signal engine" sub="Shared research runs on the house account" />
        <dl className="grid grid-cols-2 gap-4 border-t border-line pt-4 text-[13.5px] sm:grid-cols-4">
          <div><dt className={eyebrow}>Status</dt><dd className="mt-1.5 font-semibold text-ink">{engine.running ? "Running" : "Idle"}</dd></div>
          <div><dt className={eyebrow}>Scanning now</dt><dd className="mt-1.5 font-semibold text-ink">{engine.scanning ? "Yes" : "No"}</dd></div>
          <div><dt className={eyebrow}>Last scan</dt><dd className="tnum mt-1.5 font-semibold text-ink">{ago(engine.lastScan)}</dd></div>
          <div><dt className={eyebrow}>Edge recomputed</dt><dd className="tnum mt-1.5 font-semibold text-ink">{ago(engine.lastBacktest)}</dd></div>
        </dl>
      </Card>

      {/* KYC review */}
      <Card pad={false} className="mt-6">
        <CardTitle
          title="Identity verification"
          count={String(kyc.length)}
          sub="Review the selfie + document, do the live call, then approve or reject. This is MNHA's own check, not a government KYC."
        />
        {kyc.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13.5px] text-ink3">No submissions yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {kyc.map((k) => (
              <li key={k.userId} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-ink">
                      {k.fullName}{" "}
                      <Pill tone={KYC_TONE[k.status]} className="ml-1 align-middle">{k.status === "submitted" ? "in review" : k.status}</Pill>
                    </p>
                    <p className="tnum text-[11.5px] text-ink3">{emailFor.get(k.userId) ?? k.userId} · PAN {k.panMasked} · DOB {k.dob}</p>
                    <p className="text-[11.5px] text-ink3">{k.address}</p>
                  </div>
                  <div className="flex gap-2 text-[12px]">
                    {k.hasSelfie && <a href={`/api/kyc/file?user=${k.userId}&kind=selfie`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center border border-line2 px-2.5 font-medium text-brandtext hover:bg-surfaceh">Selfie</a>}
                    {k.hasDoc && <a href={`/api/kyc/file?user=${k.userId}&kind=doc`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center border border-line2 px-2.5 font-medium text-brandtext hover:bg-surfaceh">Document</a>}
                  </div>
                </div>

                {/* schedule the live call */}
                <form action={adminScheduleKycCall} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="userId" value={k.userId} />
                  <label className={eyebrow}>Call time
                    <input name="callAt" type="datetime-local" className={`mt-1 block ${input}`} />
                  </label>
                  <label className={`flex-1 ${eyebrow}`}>Meeting link
                    <input name="callLink" type="url" placeholder="https://meet.google.com/…" className={`mt-1 block w-full ${input}`} />
                  </label>
                  <button className="h-9 border border-line2 px-3 text-[12px] font-medium text-ink2 transition-colors hover:bg-surfaceh hover:text-ink">Set call</button>
                </form>
                {(k.callAt || k.callLink) && <p className="mt-1 text-[11px] text-ink3">Scheduled{k.callAt ? `: ${fmtDate(k.callAt)}` : ""}{k.callLink ? " · link set" : ""}</p>}

                {/* approve / reject */}
                <form action={adminKycDecision} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="userId" value={k.userId} />
                  <input name="notes" placeholder="Notes (shown to user if rejected)" aria-label="Review notes" className={`flex-1 ${input}`} />
                  <button name="decision" value="approved" className="h-9 bg-brand px-3 text-[12px] font-semibold text-onbrand transition-colors hover:bg-brandh">Approve</button>
                  <button name="decision" value="rejected" className="h-9 border border-down/50 px-3 text-[12px] font-semibold text-down transition-colors hover:bg-downsoft">Reject</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Members */}
      <Card pad={false} className="mt-6">
        <CardTitle
          title="Members"
          count={String(members.length)}
          sub="Performance-fee members. Values are the member's last-known account NAV (their own context) — no guarantee, fee on profit above the high-water mark only."
        />
        {members.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink3">No members yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
                  <th className="px-5 py-3 font-medium">Member</th>
                  <th className="px-5 py-3 text-right font-medium">Start</th>
                  <th className="px-5 py-3 text-right font-medium">Last NAV</th>
                  <th className="px-5 py-3 text-right font-medium">Profit</th>
                  <th className="px-5 py-3 text-right font-medium">Fee est.</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const a = m.lastNav != null ? accrual(m, m.lastNav) : null;
                  return (
                    <tr key={m.userId} className="border-b border-line last:border-0">
                      <td className="px-5 py-3 text-[13px] text-ink">{emailFor.get(m.userId) ?? m.userId}</td>
                      <td className="tnum px-5 py-3 text-right text-[12.5px] text-ink2">{inr(m.startNav)}</td>
                      <td className="tnum px-5 py-3 text-right text-[12.5px] text-ink2">{m.lastNav != null ? inr(m.lastNav) : "—"}</td>
                      <td className={`tnum px-5 py-3 text-right text-[12.5px] ${a && a.profit >= 0 ? "text-up" : "text-down"}`}>{a ? `${a.profit >= 0 ? "+" : ""}${inr(a.profit)}` : "—"}</td>
                      <td className="tnum px-5 py-3 text-right text-[12.5px] text-ink2">{a ? inr(a.feeEstimate) : "—"}</td>
                      <td className="px-5 py-3 text-[12px]"><Pill tone={m.status === "active" ? "up" : "neutral"}>{m.status}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Consent audit */}
      <Card pad={false} className="mt-6">
        <CardTitle
          title="Consent audit"
          count={String(consents.length)}
          sub={`Immutable record of who accepted which agreement version, when, and from where. Current version: ${AGREEMENT_VERSION}.`}
        />
        {consents.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink3">No consent records yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
                  <th className="px-5 py-3 font-medium">Signature</th>
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Lang / Version</th>
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Consents</th>
                  <th className="px-5 py-3 font-medium">Media</th>
                  <th className="px-5 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {consents.map((c, i) => (
                  <tr key={`${c.userId}-${i}`} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 text-[13px] font-medium text-ink">{c.signatureName}</td>
                    <td className="px-5 py-3 text-[11.5px] text-ink3">{emailFor.get(c.userId) ?? c.userId}</td>
                    <td className="px-5 py-3 text-[12px] text-ink2">{c.language?.toUpperCase() ?? "—"} · {c.agreementVersion}</td>
                    <td className="tnum px-5 py-3 text-[12px] text-ink2">{fmtDate(c.consentedAt)}</td>
                    <td className="px-5 py-3 text-[11.5px] whitespace-nowrap text-ink2">
                      {c.consents ? (
                        <>
                          {(["account", "identity", "groww", "risk"] as const).every((k) => c.consents?.[k]) ? "4/4 required" : "required missing"}
                          <span className="text-ink3">
                            {" · "}mkt {(c.current ?? c.consents).marketing ? "on" : "off"} · analytics {(c.current ?? c.consents).analytics ? "on" : "off"}
                            {(c.current ?? c.consents).groww ? "" : " · Groww withdrawn"}
                            {c.changes?.length ? ` · ${c.changes.length} change${c.changes.length > 1 ? "s" : ""}` : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink3">— (pre-v3)</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-[11.5px]">
                      <span className="flex flex-wrap gap-1.5">
                        {c.media?.selfie && <a href={`/api/consent/media?user=${c.userId}&kind=selfie`} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center whitespace-nowrap border border-line2 px-2 font-medium text-brandtext hover:bg-surfaceh">Selfie</a>}
                        {c.media?.selfie && (
                          <span className={`inline-flex h-7 items-center whitespace-nowrap px-1.5 text-[11px] ${c.media.liveness ? "text-up" : "text-ink3"}`} title={c.media.liveness ? "Taken through the on-phone blink check" : "Taken without the blink check (older version, no camera, or skipped)"}>
                            {c.media.liveness ? "✓ blink" : "no blink check"}
                          </span>
                        )}
                        {c.media?.idPhoto && <a href={`/api/consent/media?user=${c.userId}&kind=id`} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center whitespace-nowrap border border-line2 px-2 font-medium text-brandtext hover:bg-surfaceh">PAN / Aadhaar</a>}
                        {c.media?.video && <a href={`/api/consent/media?user=${c.userId}&kind=video`} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center whitespace-nowrap border border-line2 px-2 font-medium text-brandtext hover:bg-surfaceh">Video</a>}
                      </span>
                    </td>
                    <td className="tnum px-5 py-3 text-[11.5px] text-ink3">{c.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-[11.5px] leading-relaxed text-ink3">
        Deleting a user removes their MNHA account, encrypted broker credentials, KYC record + files, consent records,
        their order log, notifications and membership record; membership invoices are kept as billing records. Their money and positions stay with Groww and
        are unaffected. Broker keys are never decrypted or displayed here; KYC files open only through an admin-gated
        route.
      </p>
    </div>
  );
}
