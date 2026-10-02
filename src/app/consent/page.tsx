import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { isReservedId } from "@/lib/auth";
import { homeFor } from "@/lib/access";
import { hasConsented, CONTRACT } from "@/lib/consent";
import { hasBroker } from "@/lib/users";
import { logout } from "@/app/login/actions";
import AuthShell from "@/components/public/AuthShell";
import ConsentFlow from "./ConsentFlow";
import { MEMBER_HOME } from "@/lib/routes";

export const metadata: Metadata = { title: "User agreement · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  // The env logins have no agreement, KYC or membership — send them home.
  if (isReservedId(uid)) redirect(homeFor(uid));
  if (await hasConsented(uid)) redirect((await hasBroker(uid)) ? MEMBER_HOME : "/connect-broker");

  return (
    <AuthShell
      step={2}
      wide
      headerRight={
        <form action={logout}>
          <button type="submit" className="text-[14px] font-medium text-pub-muted hover:text-pub-cream">
            Sign out
          </button>
        </form>
      }
    >
      <p className="font-plex text-[11px] tracking-[0.12em] text-pub-coral uppercase">Step 02 · Agreement</p>
      <h1 className="pub-display mt-4 text-[clamp(2.4rem,4.5vw,3.4rem)] leading-[1.0] text-pub-cream">{CONTRACT.en.ui.before}</h1>
      <p className="mt-3 mb-8 text-[15.5px] leading-relaxed text-pub-muted">{CONTRACT.en.ui.subtitle}</p>
      <ConsentFlow contract={CONTRACT} />
    </AuthShell>
  );
}
