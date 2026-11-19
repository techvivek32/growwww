import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { isReservedId } from "@/lib/auth";
import { homeFor } from "@/lib/access";
import { currentConsent, hasSignedCurrent, CONTRACT } from "@/lib/consent";
import { hasBroker } from "@/lib/users";
import { logout } from "@/app/login/actions";
import AuthShell from "@/components/public/AuthShell";
import AdminViewBanner from "@/components/AdminViewBanner";
import ConsentFlow from "./ConsentFlow";
import { MEMBER_HOME } from "@/lib/routes";

export const metadata: Metadata = { title: "User agreement · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  // The env logins have no agreement, KYC or membership — send them home.
  if (isReservedId(uid)) redirect(homeFor(uid));
  // Someone on an earlier, still-accepted version may come here to sign this one.
  if (await hasSignedCurrent(uid)) redirect((await hasBroker(uid)) ? MEMBER_HOME : "/connect-broker");

  // Anyone here with a record in force signed an earlier version that still counts.
  const earlier = await currentConsent(uid);

  return (
    <>
    <AdminViewBanner />
    <AuthShell
      step={2}
      wide
      headerRight={
        <span className="flex items-center gap-5">
          {earlier && (
            <Link href={MEMBER_HOME} className="text-[14px] font-medium text-pub-muted hover:text-pub-cream">
              Back to your desk
            </Link>
          )}
          <form action={logout}>
            <button type="submit" className="text-[14px] font-medium text-pub-muted hover:text-pub-cream">
              Sign out
            </button>
          </form>
        </span>
      }
    >
      {earlier && (
        <p className="mb-6 border border-pub-hair px-4 py-3 text-[14px] leading-snug text-pub-cream">
          You signed version {earlier.agreementVersion.split(" ")[0]}, which still applies. Signing this version is optional — your
          access stays the same either way. Signing needs a new selfie and ID photo.
        </p>
      )}
      <ConsentFlow contract={CONTRACT} />
    </AuthShell>
    </>
  );
}
