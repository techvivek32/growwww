import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { PageHead, Pill } from "@/components/ui";
import { loadAdmin, FeesSection } from "../sections";

export const metadata: Metadata = { title: "Fee ledger · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdminPage();
  const d = await loadAdmin();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHead title="Fee ledger" sub="Settled performance periods, and settling the current ones." right={<Pill tone="violet">Admin</Pill>} />
      <FeesSection d={d} />
    </div>
  );
}
