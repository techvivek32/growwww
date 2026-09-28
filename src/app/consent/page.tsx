import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { hasConsented, AGREEMENT_TITLE, AGREEMENT_VERSION, AGREEMENT_SECTIONS } from "@/lib/consent";
import { hasBroker } from "@/lib/users";
import ConsentFlow from "./ConsentFlow";

export const metadata: Metadata = { title: "User agreement · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  if (uid === OWNER_ID) redirect("/admin");

  // Already accepted the current version → move them along.
  if (await hasConsented(uid)) redirect((await hasBroker(uid)) ? "/stocks/alerts" : "/connect-broker");

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-5 py-10">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "linear-gradient(135deg, #00d09c 0%, #00a3ff 100%)" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16.5 9.5 11l3.5 3.5L20 7" /></svg>
        </span>
        <span className="leading-none">
          <span className="block text-[15px] font-bold tracking-tight text-ink">MNHA</span>
          <span className="block text-[9px] font-semibold tracking-[0.16em] text-ink3">FINANCIALS</span>
        </span>
      </div>

      <h1 className="text-[24px] leading-tight font-bold tracking-tight text-ink">Before you begin</h1>
      <p className="mt-1.5 mb-5 text-[13.5px] leading-relaxed text-ink3">
        Please read this agreement in full and sign it. It sets out what MNHA is and is not, that trading is risky
        with no guaranteed returns, and how your data is handled. You accept it once per version.
      </p>

      <ConsentFlow title={AGREEMENT_TITLE} version={AGREEMENT_VERSION} sections={AGREEMENT_SECTIONS} />
    </div>
  );
}
