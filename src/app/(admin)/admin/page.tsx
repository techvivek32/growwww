import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { PageHead, Pill } from "@/components/ui";
import { loadAdmin, OverviewSection, SignalsSection } from "./sections";

export const metadata: Metadata = { title: "Admin · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdminPage();
  const d = await loadAdmin();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHead title="Admin" sub="Platform overview: onboarding, fees billed and orders sent through MNHA. Groww stays the source of truth for fills and money." right={<Pill tone="violet">Admin</Pill>} />
      <OverviewSection d={d} />
      <SignalsSection d={d} />
    </div>
  );
}
