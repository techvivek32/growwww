import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { hasConsented, CONTRACT } from "@/lib/consent";
import { hasBroker } from "@/lib/users";
import ConsentFlow from "./ConsentFlow";

export const metadata: Metadata = { title: "User agreement · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  if (uid === OWNER_ID) redirect("/admin");
  if (await hasConsented(uid)) redirect((await hasBroker(uid)) ? "/stocks/alerts" : "/connect-broker");

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-8 sm:px-5">
      <h1 className="text-[22px] leading-tight font-bold tracking-tight text-ink sm:text-[24px]">
        {CONTRACT.en.ui.before}
      </h1>
      <p className="mt-1.5 mb-4 text-[13px] leading-relaxed text-ink3">{CONTRACT.en.ui.subtitle}</p>
      <ConsentFlow contract={CONTRACT} />
    </div>
  );
}
