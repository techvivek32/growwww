import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { getNav } from "@/lib/api/broker";
import { getMembership, updateNav, accrual, DEFAULT_FEE_PCT, DEFAULT_PERIOD_DAYS, SUGGESTED_MIN_CAPITAL } from "@/lib/membership";
import { PageHead, Card, CardHead, Pill } from "@/components/ui";
import EnrollButton from "./EnrollButton";
import { leaveAction } from "./actions";

export const metadata: Metadata = { title: "Membership · MNHA Financials" };
export const dynamic = "force-dynamic";

const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

export default async function MembershipPage() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  if (uid === OWNER_ID) redirect("/admin");

  const [membership, navInfo] = await Promise.all([getMembership(uid), getNav()]);
  const active = membership?.status === "active";
  // Keep the last-known NAV fresh for the admin view (member's own context).
  if (active && navInfo) await updateNav(uid, navInfo.nav);
  const acc = active && navInfo ? accrual(membership!, navInfo.nav) : null;

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

      {active && membership && acc ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card><p className="text-[11px] text-ink3 uppercase">Start value</p><p className="tnum mt-1 text-[18px] font-semibold text-ink">{inr(membership.startNav)}</p></Card>
            <Card><p className="text-[11px] text-ink3 uppercase">Current value</p><p className="tnum mt-1 text-[18px] font-semibold text-ink">{navInfo ? inr(navInfo.nav) : "—"}</p></Card>
            <Card><p className="text-[11px] text-ink3 uppercase">High-water mark</p><p className="tnum mt-1 text-[18px] font-semibold text-ink">{inr(membership.highWaterMark)}</p></Card>
            <Card><p className="text-[11px] text-ink3 uppercase">Profit this period</p><p className={`tnum mt-1 text-[18px] font-semibold ${acc.profit >= 0 ? "text-up" : "text-down"}`}>{acc.profit >= 0 ? "+" : ""}{inr(acc.profit)}</p></Card>
            <Card><p className="text-[11px] text-ink3 uppercase">Fee ({membership.feePct}%) — est.</p><p className="tnum mt-1 text-[18px] font-semibold text-ink">{inr(acc.feeEstimate)}</p><p className="text-[10.5px] text-ink3">on profit only</p></Card>
            <Card><p className="text-[11px] text-ink3 uppercase">Days left</p><p className="tnum mt-1 text-[18px] font-semibold text-ink">{acc.daysLeft}</p></Card>
          </div>

          <Card className="mb-5">
            <CardHead title="How your fee is worked out" />
            <p className="text-[13.5px] leading-relaxed text-ink2">
              You keep <strong>{inr(acc.userKeeps >= 0 ? acc.userKeeps : acc.profit)}</strong> of this period&apos;s
              move; the platform&apos;s share is <strong>{inr(acc.feeEstimate)}</strong>{acc.aboveHWM ? "" : " (no fee — you are not above your peak)"}.
              The fee is an estimate shown here; it is not deducted from your account and there is no auto-charge —
              settlement is handled separately. Your capital and trades remain fully your own.
            </p>
          </Card>

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
              <p className="mb-3 text-[12.5px] text-ink3">Your account value now: <strong className="text-ink">{inr(navInfo.nav)}</strong> — this becomes your starting mark.</p>
              <EnrollButton />
            </>
          ) : (
            <p className="text-[13px] text-ink3">Connect your broker first — we need to read your account value to set your starting mark.</p>
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
