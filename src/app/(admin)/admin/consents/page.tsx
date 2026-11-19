import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { PageHead, Pill } from "@/components/ui";
import { loadAdmin, ConsentsSection } from "../sections";

export const metadata: Metadata = { title: "Consent audit · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdminPage();
  const d = await loadAdmin();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHead title="Consent audit" sub="Who accepted which agreement version, when, and from where." right={<Pill tone="violet">Admin</Pill>} />
      <ConsentsSection d={d} />
    </div>
  );
}
