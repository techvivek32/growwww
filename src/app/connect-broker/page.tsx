import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { hasConsented } from "@/lib/consent";
import { hasBroker } from "@/lib/users";
import { registeredIp } from "@/lib/api/groww";
import { logout } from "@/app/login/actions";
import AuthShell from "@/components/public/AuthShell";
import ConnectWizard from "./ConnectWizard";

export const metadata: Metadata = { title: "Connect Groww · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function ConnectBrokerPage({ searchParams }: { searchParams: Promise<{ reconnect?: string }> }) {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  // The owner uses the env house account and never connects here.
  if (uid === OWNER_ID) redirect("/stocks/alerts");
  // Must accept the agreement before connecting a broker.
  if (!(await hasConsented(uid))) redirect("/consent");
  // Already connected: straight to the desk, unless re-connecting on purpose.
  const { reconnect } = await searchParams;
  if (!reconnect && (await hasBroker(uid))) redirect("/stocks/alerts");

  return (
    <AuthShell
      step={3}
      wide
      headerRight={
        <form action={logout}>
          <button type="submit" className="text-[14px] font-medium text-pub-muted hover:text-pub-cream">
            Sign out
          </button>
        </form>
      }
    >
      <ConnectWizard ip={registeredIp()} />
    </AuthShell>
  );
}
