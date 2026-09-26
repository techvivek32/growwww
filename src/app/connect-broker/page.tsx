import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import ConnectForm from "./ConnectForm";

export const metadata: Metadata = { title: "Connect your broker · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function ConnectBrokerPage() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  // The owner uses the env house account and never connects here.
  if (uid === OWNER_ID) redirect("/stocks/alerts");

  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center px-5 py-12">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "linear-gradient(135deg, #00d09c 0%, #00a3ff 100%)" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16.5 9.5 11l3.5 3.5L20 7" /></svg>
        </span>
        <span className="leading-none">
          <span className="block text-[15px] font-bold tracking-tight text-ink">MNHA</span>
          <span className="block text-[9px] font-semibold tracking-[0.16em] text-ink3">FINANCIALS</span>
        </span>
      </div>

      <h1 className="text-[24px] leading-tight font-bold tracking-tight text-ink">Connect your Groww account</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">
        The terminal reads your account and places the orders you confirm through Groww&apos;s official trading API.
        Create an API key in Groww (Profile → Trading APIs), then paste it below with its TOTP secret.
      </p>

      <div className="mt-5 rounded-xl border border-line bg-surface p-4" style={{ boxShadow: "var(--shadow-card)" }}>
        <ConnectForm />
      </div>

      <div className="mt-5 rounded-lg border border-line bg-surface2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
        <p><strong className="text-ink2">Your keys, encrypted.</strong> They are stored AES-256 encrypted at rest and used only for your account. We verify them with a live read before saving, so a typo is caught now.</p>
        <p className="mt-2">Nothing is placed without your two-step confirmation. This is decision-support tooling, not investment advice — you own every trade.</p>
      </div>

      <form action={logout} className="mt-6 text-center">
        <button type="submit" className="text-[12.5px] font-medium text-ink3 hover:text-ink">Sign out</button>
      </form>
    </div>
  );
}
