import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { PageHead, Pill } from "@/components/ui";
import { loadAdmin, KycSection } from "../sections";

export const metadata: Metadata = { title: "Identity verification · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdminPage();
  const d = await loadAdmin();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHead title="Identity verification" sub="Review the selfie + document, do the live call, then approve or reject." right={<Pill tone="violet">Admin</Pill>} />
      <KycSection d={d} />
    </div>
  );
}
