import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { getKycView } from "@/lib/kyc";
import { PageHead, Card, CardHead, Pill } from "@/components/ui";
import KycForm from "./KycForm";

export const metadata: Metadata = { title: "Identity verification · MNHA Financials" };
export const dynamic = "force-dynamic";

const fmt = (ms: number) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));

export default async function KycPage() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  if (uid === OWNER_ID) redirect("/admin");

  const kyc = await getKycView(uid);

  const badge =
    kyc.status === "approved" ? <Pill tone="up">Verified</Pill> :
    kyc.status === "rejected" ? <Pill tone="down">Rejected</Pill> :
    kyc.status === "submitted" ? <Pill tone="warn">In review</Pill> :
    <Pill tone="neutral">Not started</Pill>;

  return (
    <div className="mx-auto max-w-xl">
      <PageHead title="Identity verification" sub="A quick check so we know who's on the platform." right={badge} />

      <div className="mb-6 border-l-2 border-mark bg-surface px-5 py-4">
        <p className="text-[13px] leading-relaxed text-ink2">
          This is <strong className="text-ink">MNHA&apos;s own</strong> verification — a form, a selfie, and a short live
          video call — not a government or SEBI KYC, and it doesn&apos;t touch your money or positions (those stay with
          Groww). Your PAN and date of birth are stored <strong className="text-ink">encrypted</strong>; you can delete
          everything from Settings at any time.
        </p>
      </div>

      {kyc.status === "none" && (
        <Card>
          <CardHead title="Submit your details" sub="Takes a minute. A live call is scheduled after you submit." />
          <KycForm />
        </Card>
      )}

      {kyc.status === "submitted" && (
        <Card>
          <CardHead title="In review" sub={`Submitted ${fmt(kyc.submittedAt)}`} />
          <p className="text-[13.5px] leading-relaxed text-ink2">
            Thanks, {kyc.fullName}. Your details ({kyc.panMasked}) are being reviewed. We&apos;ll confirm your identity
            on a short live video call.
          </p>
          {kyc.callAt || kyc.callLink ? (
            <div className="mt-5 border-y border-line py-4">
              <p className="font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">Your verification call</p>
              {kyc.callAt && <p className="pub-display tnum mt-1.5 text-[24px] leading-tight text-ink">{fmt(kyc.callAt)}</p>}
              {kyc.callLink && (
                <a href={kyc.callLink} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[13px] font-semibold break-all text-brandtext hover:underline">
                  Join the call <span className="pub-arrow">→</span>
                </a>
              )}
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] text-ink3">We&apos;ll post your call time here and notify you.</p>
          )}
        </Card>
      )}

      {kyc.status === "approved" && (
        <Card>
          <CardHead title="Verified" sub="Your identity is confirmed." />
          <p className="text-[13.5px] leading-relaxed text-ink2">You&apos;re all set, {kyc.fullName}. Thanks for verifying.</p>
        </Card>
      )}

      {kyc.status === "rejected" && (
        <Card>
          <CardHead title="Not verified" sub="We couldn't confirm your details." />
          {kyc.review?.notes && <p className="mb-4 border-l-2 border-down bg-downsoft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">{kyc.review.notes}</p>}
          <p className="mb-4 text-[13px] text-ink3">You can correct the details and submit again.</p>
          <KycForm />
        </Card>
      )}
    </div>
  );
}
