import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { PageHead, Pill } from "@/components/ui";
import { loadAdmin, AddressesSection } from "../sections";

export const metadata: Metadata = { title: "Order addresses · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdminPage();
  const d = await loadAdmin();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHead title="Order addresses" sub="The registered addresses orders are sent from, and who holds each." right={<Pill tone="violet">Admin</Pill>} />
      <AddressesSection d={d} />
    </div>
  );
}
