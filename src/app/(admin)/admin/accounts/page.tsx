import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { PageHead, Pill } from "@/components/ui";
import { loadAdmin, AccountsSection } from "../sections";

export const metadata: Metadata = { title: "Accounts · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdminPage();
  const d = await loadAdmin();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHead title="Accounts" sub="One row per user, with the admin actions." right={<Pill tone="violet">Admin</Pill>} />
      <AccountsSection d={d} />
      <p className="mt-4 text-[11.5px] leading-relaxed text-ink3">
        Deleting a user removes their MNHA account, encrypted broker credentials, KYC record + files, consent records,
        their order log, notifications and membership record; membership invoices are kept as billing records. Their money and positions stay with Groww and
        are unaffected. Broker keys are never decrypted or displayed here; KYC files open only through an admin-gated
        route.
      </p>
    </div>
  );
}
