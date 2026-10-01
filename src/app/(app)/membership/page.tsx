import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { getNav, getNavStrict } from "@/lib/api/broker";
import {
  getMembership, updateNav, accrual, settlePeriod, settlementNotice, listInvoices,
  DEFAULT_FEE_PCT, DEFAULT_PERIOD_DAYS, SUGGESTED_MIN_CAPITAL, type InvoiceStatus,
} from "@/lib/membership";
import { notify } from "@/lib/notifications";
import { PageHead, Card, CardHead, Pill } from "@/components/ui";
import EnrollButton from "./EnrollButton";
import { leaveAction } from "./actions";

export const metadata: Metadata = { title: "Membership · MNHA Financials" };
export const dynamic = "force-dynamic";

const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const inr2 = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DAY_MON = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
const fmtDay = (ms: number) => DAY_MON.format(new Date(ms));
const isPast = (ts: number) => Date.now() >= ts;
const BILL: Record<InvoiceStatus, { label: string; tone: "warn" | "up" | "neutral" }> = {
  due: { label: "Due", tone: "warn" },
  paid: { label: "Paid", tone: "up" },
  waived: { label: "Waived", tone: "neutral" },
};

export default async function MembershipPage({ searchParams }: { searchParams: Promise<{ leave?: string }> }) {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  if (uid === OWNER_ID) redirect("/admin");
  const { leave: leaveFlag } = await searchParams;

  const [initial, navInfo] = await Promise.all([getMembership(uid), getNav()]);
  let membership = initial;
  const active = membership?.status === "active";
  if (active && membership && navInfo) {
    // Keep the last-known NAV fresh for the admin view (member's own context).
    await updateNav(uid, navInfo.nav);
    // Period over → close it at this live, own-account value. settlePeriod
    // re-checks the end and the exact period inside its queue, so a repeated
    // render can never bill the same period twice.
    // Billing uses a STRICT reading (every holding priced); if that fails the
    // period simply stays open until a complete reading is possible.
    const strict = isPast(membership.periodEndsAt) ? await getNavStrict() : null;
    if (strict && strict.nav > 0) {
      const invoice = await settlePeriod(uid, strict.nav, { periodEndsAt: membership.periodEndsAt });
      if (invoice) {
        await notify(uid, { kind: "account", tone: "neutral", ...settlementNotice(invoice), key: `settle-${invoice.id}` });
        membership = await getMembership(uid);
      }
    }
  }
  const acc = active && membership && navInfo ? accrual(membership, navInfo.nav) : null;
  const bills = await listInvoices(uid);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHead
        title="Membership"
        sub="A performance-fee plan — we earn only when you profit."
        right={active ? <Pill tone="up">Active</Pill> : <Pill tone="neutral">Not enrolled</Pill>}
      />

      {/* the honest terms */}
      <Card className="mb-5 border-warn/40 bg-warnsoft/40">
        <p className="text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">No guarantee. No loss cover.</strong> This is a performance-fee membership,
          not a guaranteed-return scheme (those are prohibited in India). A loss is entirely yours. Your money stays
          in your own Groww account — we take no custody. We charge a fee <strong>only on profit above your previous
          peak</strong> (a high-water mark), so you are never charged twice for the same gains.
        </p>
      </Card>

      {leaveFlag === "retry" && (
        <p role="alert" className="mb-4 rounded-lg border border-down/30 bg-downsoft px-3.5 py-2.5 text-[12.5px] text-down">
          We couldn&apos;t value your whole account from Groww (for example a holding with no NSE price, or Groww not
          answering), so the period could not be closed. Try again shortly; if it keeps failing, contact support.
        </p>
      )}
      {leaveFlag === "reconnect" && (
        <p role="alert" className="mb-4 rounded-lg border border-down/30 bg-downsoft px-3.5 py-2.5 text-[12.5px] text-down">
          Your Groww key isn&apos;t connected, so we can&apos;t read the value needed to close the period.{" "}
          <a href="/connect-broker?reconnect=1" className="font-semibold underline">Re-connect Groww</a>, then leave — or
          contact support.
        </p>
      )}

      {active && membership ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card><p className="text-[11px] text-ink3 uppercase">Start value</p><p className="tnum mt-1 text-[18px] font-semibold text-ink">{inr(membership.startNav)}</p></Card>
            <Card><p className="text-[11px] text-ink3 uppercase">Current value</p><p className="tnum mt-1 text-[18px] font-semibold text-ink">{navInfo ? inr(navInfo.nav) : "—"}</p></Card>
            <Card><p className="text-[11px] text-ink3 uppercase">High-water mark</p><p className="tnum mt-1 text-[18px] font-semibold text-ink">{inr(membership.highWaterMark)}</p></Card>
            <Card><p className="text-[11px] text-ink3 uppercase">Above / below your peak</p><p className={`tnum mt-1 text-[18px] font-semibold ${acc ? (acc.profit >= 0 ? "text-up" : "text-down") : "text-ink3"}`}>{acc ? `${acc.profit >= 0 ? "+" : ""}${inr(acc.profit)}` : "—"}</p></Card>
            <Card><p className="text-[11px] text-ink3 uppercase">Fee ({membership.feePct}%) — est.</p><p className="tnum mt-1 text-[18px] font-semibold text-ink">{acc ? inr(acc.feeEstimate) : "—"}</p><p className="text-[10.5px] text-ink3">only above your peak</p></Card>
            <Card><p className="text-[11px] text-ink3 uppercase">Period ends</p><p className="tnum mt-1 text-[18px] font-semibold text-ink">{fmtDay(membership.periodEndsAt)}</p></Card>
          </div>

          <Card className="mb-5">
            <CardHead title="How your fee is worked out" />
            <p className="text-[13.5px] leading-relaxed text-ink2">
              {acc ? (
                acc.aboveHWM ? (
                  <>
                    You are <strong>{inr(acc.profit)}</strong> above your peak; at this level the estimated fee would be{" "}
                    <strong>{inr(acc.feeEstimate)}</strong> and you would keep <strong>{inr(acc.userKeeps)}</strong>.{" "}
                  </>
                ) : (
                  <>You are below your peak of {inr(membership.highWaterMark)}, so no fee applies right now. </>
                )
              ) : (
                <>Your live account value is unavailable right now. </>
              )}
              The fee is an estimate; it is not deducted from your account and there is no auto-charge — settlement is
              handled separately. Your capital and trades remain fully your own.
            </p>
          </Card>

          <p className="mb-3 text-[12.5px] leading-relaxed text-ink3">
            Leaving closes the current period at a live reading: a fee applies to any rise above your peak up to that
            moment, and nothing if you are below it.
          </p>
          <form action={leaveAction}>
            <button type="submit" className="inline-flex h-10 items-center rounded-lg border border-line2 px-4 text-[13.5px] font-semibold text-ink hover:bg-surfaceh">
              Leave membership
            </button>
          </form>
        </>
      ) : (
        <Card>
          <CardHead
            title="Performance-fee membership"
            sub={`${DEFAULT_FEE_PCT}% of profit above your high-water mark · ${DEFAULT_PERIOD_DAYS}-day periods`}
          />
          <ul className="mb-5 space-y-2 text-[13.5px] text-ink2">
            <li>• Suggested capital to make it worthwhile: <strong>{inr(SUGGESTED_MIN_CAPITAL)}+</strong> — kept in <strong>your own</strong> Groww account.</li>
            <li>• Fee of <strong>{DEFAULT_FEE_PCT}%</strong> applies only to profit above your previous peak. No profit, no fee.</li>
            <li>• A loss is entirely yours — there is no guarantee and no loss cover.</li>
            <li>• Leave any time; your account is always yours.</li>
          </ul>
          {navInfo ? (
            <>
              <p className="mb-3 text-[12.5px] text-ink3">
                Your account value now: <strong className="text-ink">{inr(navInfo.nav)}</strong>
                {membership && membership.highWaterMark > navInfo.nav
                  ? <> — your earlier peak of <strong className="text-ink">{inr(membership.highWaterMark)}</strong> is kept, so a fee applies only above it.</>
                  : " — this becomes your starting mark."}
              </p>
              <EnrollButton />
            </>
          ) : (
            <p className="text-[13px] text-ink3">Connect your broker first — we need to read your account value to set your starting mark.</p>
          )}
        </Card>
      )}

      {(active || bills.length > 0) && (
        <Card pad={false} className="mt-5">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Your bills ({bills.length})</h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink3">
              One line per closed period. No fee on a loss, and a fee only on profit above your previous peak. Bills are
              collected separately — nothing is ever auto-debited from your account. If a gain came from money you
              added rather than from trading, tell us and the fee is waived.
            </p>
          </div>
          {bills.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-ink3">
              No bills yet.{membership?.status === "active" ? ` Your current period closes on ${fmtDay(membership.periodEndsAt)}.` : ""}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line text-[12px] text-ink3">
                    <th className="px-5 py-3 font-semibold">Period</th>
                    <th className="px-5 py-3 text-right font-semibold">Profit above peak</th>
                    <th className="px-5 py-3 text-right font-semibold">Fee</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b.id} className="border-b border-line/60">
                      <td className="tnum px-5 py-3 text-[12.5px] whitespace-nowrap text-ink2">{fmtDay(b.periodStart)} → {fmtDay(b.periodEnd)}</td>
                      <td className={`tnum px-5 py-3 text-right text-[12.5px] ${b.profitAboveHwm > 0 ? "text-up" : "text-ink3"}`}>{inr(b.profitAboveHwm)}</td>
                      <td className="tnum px-5 py-3 text-right text-[12.5px] font-semibold text-ink">
                        {inr2(b.feeDue)}
                        <span className="ml-1 text-[10.5px] font-normal text-ink3">{b.feePct}%</span>
                      </td>
                      <td className="px-5 py-3">
                        <Pill tone={BILL[b.status].tone}>{b.status === "waived" && b.feeDue === 0 ? "No fee" : BILL[b.status].label}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <p className="mt-4 text-[11.5px] leading-relaxed text-ink3">
        A performance-fee service requires the operator&apos;s SEBI registration; MNHA does not manage or hold your
        money. Account value shown is an estimate (cash + holdings) and excludes open F&amp;O positions.
      </p>
    </div>
  );
}
